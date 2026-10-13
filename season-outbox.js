// Per-season delta queue for Supabase sync (spec section 8, "Client sync").
// Each entry holds at most one {add, remove} pair per season id; the latest
// action on a cell wins, so the two sets never overlap.
(function (root) {
  'use strict';

  function cycleMetaFromId(id) {
    if (typeof id !== 'string' || !id.startsWith('cycle-v1|')) return {};
    const cycle = root.TANIMAN_CYCLE_META || (typeof require === 'function' ? require('./cycle-metadata.js') : null);
    return cycle ? cycle.decodeId(id) : {};
  }
  const byNumber = (a, b) => a - b;

  function metaOf(source) {
    return {
      id: source.id,
      plotIdx: source.plotIdx,
      classId: source.classId == null ? null : source.classId,
      cropId: source.cropId || null,
      remark: source.remark || '',
      start: source.start,
      end: source.end,
      ...(source.referenceYear === undefined ? {} : { referenceYear: source.referenceYear }),
      ...(source.fieldId === undefined ? {} : { fieldId: source.fieldId }),
    };
  }

  function metaFromSeason(plotIdx, season) {
    return metaOf({ ...season, plotIdx });
  }

  function seasonFromRow(row) {
    return {
      id: row.id,
      classId: row.class_id == null ? null : row.class_id,
      cropId: row.crop_id || null,
      remark: row.remark || '',
      start: row.start_mmdd,
      end: row.end_mmdd,
      ...cycleMetaFromId(row.id),
      cells: Array.isArray(row.cells) ? [...row.cells].sort(byNumber) : [],
    };
  }

  function create(serialized) {
    const entries = new Map();   // pending, not yet sent
    const sending = new Map();   // drained by begin(), awaiting ack/fail

    function entryFor(source) {
      let entry = entries.get(source.id);
      if (!entry) {
        entry = { meta: metaOf(source), add: new Set(), remove: new Set() };
        entries.set(source.id, entry);
      }
      return entry;
    }

    function record(meta, add = [], remove = []) {
      const entry = entryFor(meta);
      for (const cell of add) { entry.remove.delete(cell); entry.add.add(cell); }
      for (const cell of remove) { entry.add.delete(cell); entry.remove.add(cell); }
    }

    // Put a failed delta back underneath any edits made since it was drained.
    function requeue(delta) {
      const entry = entryFor(delta);
      for (const cell of delta.add || []) if (!entry.remove.has(cell)) entry.add.add(cell);
      for (const cell of delta.remove || []) if (!entry.add.has(cell)) entry.remove.add(cell);
    }

    function toDelta(entry) {
      return { ...entry.meta, add: [...entry.add].sort(byNumber), remove: [...entry.remove].sort(byNumber) };
    }

    function drain() {
      const out = [...entries.values()].map(toDelta).filter(d => d.add.length || d.remove.length);
      entries.clear();
      return out;
    }

    // Move every pending delta into "sending"; they stay pending (has() is
    // true) and are still persisted by toJSON() until ack() or fail().
    function begin() {
      const out = drain();
      for (const delta of out) sending.set(delta.id, delta);
      return out;
    }

    function ack(id) {
      sending.delete(id);
    }

    function fail(delta) {
      if (!sending.has(delta.id)) return;   // dropped while in flight
      sending.delete(delta.id);
      requeue(delta);
    }

    function dropWhere(predicate) {
      for (const [id, entry] of entries) if (predicate(entry.meta)) entries.delete(id);
      for (const [id, delta] of sending) if (predicate(delta)) sending.delete(id);
    }

    function toJSON() {
      const merged = create();
      for (const delta of sending.values()) merged.record(delta, delta.add, delta.remove);
      for (const entry of entries.values()) merged.record(entry.meta, [...entry.add], [...entry.remove]);
      return merged.pendingDeltas();
    }

    const box = {
      record,
      requeue,
      drain,
      begin,
      ack,
      fail,
      has: id => entries.has(id) || sending.has(id),
      hasQueued: id => entries.has(id),
      isSending: id => sending.has(id),
      size: () => entries.size,
      dropPlot: plotIdx => dropWhere(m => m.plotIdx === plotIdx),
      dropCrop: cropId => dropWhere(m => m.cropId === cropId),
      pendingDeltas: () => [...entries.values()].map(toDelta),
      toJSON,
    };

    for (const delta of Array.isArray(serialized) ? serialized : []) {
      if (delta && typeof delta.id === 'string') record(delta, delta.add || [], delta.remove || []);
    }
    return box;
  }

  function diffSeasons(plotIdx, current, target) {
    const cur = new Map((current || []).map(s => [s.id, s]));
    const tgt = new Map((target || []).map(s => [s.id, s]));
    const out = [];
    for (const id of new Set([...cur.keys(), ...tgt.keys()])) {
      const before = new Set((cur.get(id) || {}).cells || []);
      const after = new Set((tgt.get(id) || {}).cells || []);
      const add = [...after].filter(c => !before.has(c)).sort(byNumber);
      const remove = [...before].filter(c => !after.has(c)).sort(byNumber);
      if (add.length || remove.length) {
        out.push({ meta: metaFromSeason(plotIdx, tgt.get(id) || cur.get(id)), add, remove });
      }
    }
    return out.sort((a, b) => (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0));
  }

  function mergeRemoteSeasons(local, remote, isPending) {
    const pending = (local || []).filter(season => isPending(season.id));
    const pendingIds = new Set(pending.map(season => season.id));
    return [...pending, ...(remote || []).filter(season => !pendingIds.has(season.id))];
  }

  function classifySyncError(error) {
    if (!error) return 'retry';
    const code = String(error.code || '');
    if (/^2[23][0-9A-Z]{3}$/.test(code)) return 'permanent';
    const status = Number(error.status);
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return 'permanent';
    return 'retry';
  }

  // Send every pending delta once. Network failures are requeued (newer
  // edits win); permanent failures are dropped and reported. A row is only
  // reported when the delta was not dropped mid-flight and no newer edit
  // for the same season is queued.
  async function flush(box, { send, onRow = () => {}, onPermanent = () => {} }) {
    let retry = false;
    for (const delta of box.begin()) {
      try {
        const row = await send(delta);
        const stillWanted = box.isSending(delta.id);
        box.ack(delta.id);
        if (stillWanted && !box.hasQueued(delta.id)) await onRow(delta, row);
      } catch (error) {
        if (classifySyncError(error) === 'permanent') {
          const stillWanted = box.isSending(delta.id);
          box.ack(delta.id);
          if (stillWanted) await onPermanent(delta, error);
        } else {
          box.fail(delta);
          retry = true;
        }
      }
    }
    return { retry };
  }

  const api = { create, flush, metaFromSeason, seasonFromRow, diffSeasons, mergeRemoteSeasons, classifySyncError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_OUTBOX = api;
})(typeof window !== 'undefined' ? window : globalThis);
