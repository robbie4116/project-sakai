// supabase-sync.js
// Network calls only. Seasons are read from public.seasons and written through
// the apply_season_cells RPC; plot notes/photos live in public.plots.
// Every failing call throws an Error carrying {code, status} so callers can
// classify it with TANIMAN_OUTBOX.classifySyncError.

(function () {
  'use strict';
  if (window.__TAURI__) return;

  let db = null;
  const SEASON_COLUMNS = 'id,plot_idx,class_id,crop_id,remark,start_mmdd,end_mmdd,cells,updated_at';
  const PAGE_SIZE = 1000;

  function isOnline() {
    return navigator.onLine && typeof supabase !== 'undefined';
  }

  function initClient() {
    if (db) return db;
    if (typeof supabase === 'undefined') return null;
    db = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return db;
  }

  function requireClient() {
    const client = isOnline() ? initClient() : null;
    if (!client) throw Object.assign(new Error('offline'), { status: 0 });
    return client;
  }

  function syncError(error, status) {
    return Object.assign(new Error(error.message || 'Supabase request failed'), {
      code: error.code, status, details: error.details,
    });
  }

  function isUuid(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  }

  // ── Crop names (class 4) ─────────────────────────────────────────
  window.fetchCustomCrops = async function () {
    const { data, error, status } = await requireClient().from('crops')
      .select('id,name,hex,created_at').order('name');
    if (error) throw syncError(error, status);
    return data || [];
  };

  window.insertCustomCrop = async function (name, hex) {
    const { data, error, status } = await requireClient().from('crops')
      .insert({ name, hex }).select('id,name,hex,created_at').single();
    if (error) throw syncError(error, status);
    return data;
  };

  window.deleteCustomCrop = async function (id) {
    if (!isUuid(id)) throw new Error('Custom crop ID must be a UUID.');
    const { data, error, status } = await requireClient().rpc('delete_crop', { p_crop_id: id });
    if (error) throw syncError(error, status);
    const count = Number(data);
    return Number.isFinite(count) && count >= 0 ? count : 0;
  };

  // ── Seasons ──────────────────────────────────────────────────────
  window.fetchAllSeasons = async function () {
    const client = requireClient();
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error, status } = await client.from('seasons')
        .select(SEASON_COLUMNS).order('id').range(from, from + PAGE_SIZE - 1);
      if (error) throw syncError(error, status);
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  };

  window.fetchPlotSeasons = async function (plotIdx) {
    const { data, error, status } = await requireClient().from('seasons')
      .select(SEASON_COLUMNS).eq('plot_idx', plotIdx);
    if (error) throw syncError(error, status);
    return data || [];
  };

  // Returns the season row after the change, or null if it no longer exists.
  window.applySeasonCells = async function (delta) {
    const { data, error, status } = await requireClient().rpc('apply_season_cells', {
      p_id: delta.id,
      p_plot_idx: delta.plotIdx,
      p_class_id: delta.classId,
      p_crop_id: delta.cropId,
      p_remark: delta.remark || null,
      p_start: delta.start,
      p_end: delta.end,
      p_add: delta.add,
      p_remove: delta.remove,
    });
    if (error) throw syncError(error, status);
    return data && data.id ? data : null;
  };

  window.clearPlotRemote = async function (plotIdx) {
    const { error, status } = await requireClient().rpc('clear_plot', { p_plot_idx: plotIdx });
    if (error) throw syncError(error, status);
  };

  // ── Plot notes and photos ────────────────────────────────────────
  function encodePhotos(photos) {
    const urls = (photos || []).map(p => p && p.url).filter(u => u != null);
    if (!urls.length) return null;
    return urls.length === 1 ? urls[0] : JSON.stringify(urls);
  }

  function decodePhotos(photoUrl) {
    if (!photoUrl) return [];
    if (photoUrl.startsWith('[')) {
      try {
        return JSON.parse(photoUrl).map(url => ({ url, dataUrl: null }));
      } catch (e) {
        return [{ url: photoUrl, dataUrl: null }];
      }
    }
    return [{ url: photoUrl, dataUrl: null }];
  }
  window.decodePhotos = decodePhotos;

  window.fetchPlotMeta = async function () {
    const { data, error, status } = await requireClient().from('plots')
      .select('plot_idx,note,photo_url,updated_at');
    if (error) throw syncError(error, status);
    return data || [];
  };

  window.upsertPlotMeta = async function (plotIdx, plotData) {
    try {
      const { error } = await requireClient().from('plots').upsert({
        plot_idx: plotIdx,
        note: plotData.note || '',
        photo_url: encodePhotos(plotData.photos),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'plot_idx' });
      if (error) { console.warn('upsertPlotMeta error:', error.message); return false; }
      return true;
    } catch (e) {
      console.warn('upsertPlotMeta error:', e);
      return false;
    }
  };

  window.uploadPhoto = async function (plotIdx, dataUrl, suffix) {
    let client;
    try { client = requireClient(); } catch (e) { return null; }
    try {
      const byteStr = atob(dataUrl.split(',')[1]);
      const bytes = new Uint8Array(byteStr.length);
      for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const path = `plot_${String(plotIdx).padStart(3, '0')}_${suffix || Date.now()}.jpg`;
      const { error } = await client.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) { console.warn('uploadPhoto error:', error.message); return null; }
      return client.storage.from('photos').getPublicUrl(path).data.publicUrl;
    } catch (e) {
      console.warn('uploadPhoto error:', e);
      return null;
    }
  };
})();
