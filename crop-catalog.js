// Shared crop lookup with synchronous browser-cache hydration.
(function () {
  'use strict';

  const CACHE_KEY = 'taniman_custom_crops_v1';
  const UNKNOWN_HEX = '#9CA3AF';
  const isTauri = Boolean(window.__TAURI__);
  const crops = Array.isArray(window.CROPS) ? window.CROPS : [];
  const targets = crops.map(crop => ({ ...crop, isTarget: true, isResolved: true }));
  const targetById = new Map(targets.map(crop => [crop.id, crop]));
  const targetNames = new Set();
  const customById = new Map();
  const placeholdersById = new Map();
  const referencedIds = new Set();
  const listeners = new Set();
  const pendingRefreshes = new Set();
  const refreshDetails = new WeakMap();
  let refreshGeneration = 0;
  let mutationGeneration = 0;
  let duplicateRecoveryPromise = null;

  function normalizeName(name) {
    return String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
  }

  function nameKey(name) {
    return normalizeName(name).toLowerCase();
  }

  function cropIdentity(cropId) {
    if (cropId == null) return null;
    const id = String(cropId);
    return id.trim() ? id : null;
  }

  function isUuid(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  }

  function isHex(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  }

  function displayNameFromRow(row) {
    return normalizeName(row && row.name);
  }

  function cropFromRow(row) {
    if (!row || !isUuid(row.id) || !isHex(row.hex)) return null;
    const displayName = displayNameFromRow(row);
    if (!displayName || [...displayName].length > 80) return null;
    return {
      id: `crop_${row.id}`,
      hex: row.hex,
      name: { en: displayName },
      isTarget: false,
      isResolved: true,
    };
  }

  function rawRows() {
    return Array.from(customById.values(), crop => ({
      id: crop.id.slice('crop_'.length),
      name: crop.name.en,
      hex: crop.hex,
    }));
  }

  function persistCache() {
    if (isTauri || !window.localStorage) return;
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, rows: rawRows() }));
    } catch (_) {
      // The in-memory catalog remains usable when browser storage is unavailable.
    }
  }

  function readCache() {
    if (isTauri || !window.localStorage) return [];
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.rows)) return [];
      return parsed.rows;
    } catch (_) {
      return [];
    }
  }

  function notify() {
    for (const listener of Array.from(listeners)) {
      try { listener(crops); } catch (_) { /* A subscriber cannot block catalog updates. */ }
    }
  }

  function placeholderFor(id) {
    if (!placeholdersById.has(id)) {
      placeholdersById.set(id, {
        id,
        hex: UNKNOWN_HEX,
        name: { en: `Unknown crop (${id})` },
        isTarget: false,
        isResolved: false,
      });
    }
    return placeholdersById.get(id);
  }

  function sortedCustom() {
    return Array.from(customById.values()).sort((a, b) =>
      a.name.en.localeCompare(b.name.en, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  }

  function rebuild() {
    const next = [...targets, ...sortedCustom()];
    for (const id of referencedIds) {
      if (!targetById.has(id) && !customById.has(id)) next.push(placeholderFor(id));
    }
    crops.length = 0;
    for (const crop of next) crops.push(crop);
    if (!Array.isArray(window.CROPS)) window.CROPS = crops;
  }

  function findCustomByName(name) {
    const key = nameKey(name);
    for (const crop of customById.values()) {
      if (nameKey(crop.name.en) === key) return crop;
    }
    return null;
  }

  function setCustomRows(rows) {
    const next = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const crop = cropFromRow(row);
      if (crop && !targetNames.has(nameKey(crop.name.en))) next.set(crop.id, crop);
    }
    customById.clear();
    for (const [id, crop] of next) customById.set(id, crop);
    rebuild();
  }

  function validateNewCrop(name, hex) {
    const displayName = normalizeName(name);
    if (!displayName) throw new Error('Crop name is required.');
    if ([...displayName].length > 80) throw new Error('Crop name must be 80 characters or fewer.');
    if (!isHex(hex)) throw new Error('Crop color must be a six-digit hex value such as #258C55.');
    if (targetNames.has(nameKey(displayName))) throw new Error('Target crop names cannot be added as custom crops.');
    return displayName;
  }

  for (const target of targets) {
    for (const value of Object.values(target.name || {})) {
      if (normalizeName(value)) targetNames.add(nameKey(value));
    }
  }

  // Hydrate the stable shared array before app.js and calendar.js retain it.
  setCustomRows(readCache());
  window.CROPS = crops;

  function all() {
    return crops;
  }

  function byId(cropId) {
    const id = cropIdentity(cropId);
    if (id == null) return null;
    const known = targetById.get(id) || customById.get(id);
    return known || placeholderFor(id);
  }

  function isResolved(cropId) {
    const id = cropIdentity(cropId);
    const crop = id == null ? null : targetById.get(id) || customById.get(id);
    return Boolean(crop);
  }

  function isTarget(cropId) {
    const id = cropIdentity(cropId);
    return id != null && targetById.has(id);
  }

  function registerReferences(plots) {
    const source = plots && Object.prototype.hasOwnProperty.call(plots, 'plots') ? plots.plots : plots;
    const plotList = Array.isArray(source)
      ? source
      : source && typeof source === 'object' && Array.isArray(source.seasons)
        ? [source]
        : source && typeof source === 'object'
          ? Object.values(source)
          : [];
    const found = new Set();
    for (const plot of plotList) {
      if (!plot || !Array.isArray(plot.seasons)) continue;
      for (const season of plot.seasons) {
        const id = season && season.cropId != null ? String(season.cropId) : '';
        if (id.trim()) found.add(id);
      }
    }
    const unknown = new Set(Array.from(found).filter(id => !targetById.has(id) && !customById.has(id)));
    const changed = unknown.size !== referencedIds.size || Array.from(unknown).some(id => !referencedIds.has(id));
    if (changed) {
      referencedIds.clear();
      for (const id of unknown) referencedIds.add(id);
      rebuild();
      notify();
    }
    return crops;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Catalog subscriber must be a function.');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function refresh(options) {
    if (isTauri) return Promise.resolve(crops);
    const force = Boolean(options && options.force);
    if (!force) {
      const active = Array.from(pendingRefreshes).reverse().find(promise => {
        const details = refreshDetails.get(promise);
        return details && details.mutation === mutationGeneration && details.generation === refreshGeneration;
      });
      if (active) return active;
    }
    if (typeof window.fetchCustomCrops !== 'function') return Promise.reject(new Error('Custom crop catalog is unavailable.'));

    const generation = ++refreshGeneration;
    const mutation = mutationGeneration;
    let request;
    request = Promise.resolve()
      .then(() => window.fetchCustomCrops())
      .then(rows => {
        if (generation === refreshGeneration && mutation === mutationGeneration) {
          setCustomRows(rows);
          persistCache();
          notify();
        }
        return crops;
      })
      .finally(() => { pendingRefreshes.delete(request); });
    refreshDetails.set(request, { generation, mutation });
    pendingRefreshes.add(request);
    return request;
  }

  function refreshAfterDuplicate() {
    if (duplicateRecoveryPromise) return duplicateRecoveryPromise;
    const olderRequests = Array.from(pendingRefreshes);
    let recovery;
    recovery = Promise.allSettled(olderRequests)
      .then(() => refresh({ force: true }))
      .finally(() => {
        if (duplicateRecoveryPromise === recovery) duplicateRecoveryPromise = null;
      });
    duplicateRecoveryPromise = recovery;
    return recovery;
  }

  async function create(name, hex) {
    if (isTauri) throw new Error('Custom crops are unavailable in the offline app.');
    const displayName = validateNewCrop(name, hex);
    const localMatch = findCustomByName(displayName);
    if (localMatch) return { status: 'duplicate', crop: localMatch };
    if (typeof window.insertCustomCrop !== 'function') throw new Error('Custom crop catalog is unavailable.');

    try {
      const row = await window.insertCustomCrop(displayName, hex);
      const crop = cropFromRow(row);
      if (!crop) throw new Error('The saved crop returned invalid catalog data.');
      mutationGeneration++;
      customById.set(crop.id, crop);
      rebuild();
      persistCache();
      notify();
      return { status: 'created', crop };
    } catch (error) {
      if (!error || error.code !== '23505') throw error;
      await refreshAfterDuplicate();
      const duplicate = findCustomByName(displayName);
      if (duplicate) return { status: 'duplicate', crop: duplicate };
      throw new Error('A crop with a matching name already exists. Search the crop list to find it.');
    }
  }

  /**
   * Public catalog API.
   * all() returns the live, stable CROPS array; each crop has id, hex, name,
   * isTarget, and isResolved fields. byId() returns a crop/placeholder or null
   * for a blank ID. isResolved()/isTarget() return booleans. registerReferences()
   * and subscribe() return the live crop array and an unsubscribe function.
   * refresh() resolves to that array. create() resolves to
   * {status:'created'|'duplicate', crop}; failures reject with an Error.
   * normalizeName() returns trimmed text with internal whitespace collapsed.
   */
  window.TANIMAN_CROP_CATALOG = {
    all,
    byId,
    isResolved,
    isTarget,
    registerReferences,
    subscribe,
    refresh,
    create,
    normalizeName,
  };
})();
