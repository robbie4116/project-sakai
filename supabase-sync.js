// supabase-sync.js
// Handles all Supabase read/write. Exposes: syncInit, syncPlots, syncOnNavigate, uploadPhoto.
// Loaded before app.js. Falls back silently if Supabase SDK is unavailable (offline).

(function () {
  'use strict';

  let db = null;

  function isOnline() {
    return navigator.onLine && typeof supabase !== 'undefined';
  }

  function initClient() {
    if (db) return db;
    if (typeof supabase === 'undefined') return null;
    db = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return db;
  }

  // Convert app state plot object -> Supabase row
  function plotToRow(idx, plotData, deviceId) {
    return {
      plot_idx: idx,
      labels: plotData.labels ? Array.from(plotData.labels) : [],
      farmer: plotData.farmer || '',
      note: plotData.note || '',
      photo_url: plotData.photo_url || null,
      device_id: deviceId,
      updated_at: new Date().toISOString(),
    };
  }

  // Convert Supabase row -> app state plot object
  function rowToPlot(row) {
    return {
      labels: new Uint8Array(row.labels || []),
      farmer: row.farmer || '',
      note: row.note || '',
      photo_url: row.photo_url || null,
      photo: null,
      _synced_at: row.updated_at,
    };
  }

  window.syncInit = async function (state, onMerge) {
    if (!isOnline()) return;
    const client = initClient();
    if (!client) return;
    try {
      const { data, error } = await client.from('plots').select('*');
      if (error) { console.warn('syncInit fetch error:', error.message); return; }
      for (const row of data) {
        const local = state.plots[row.plot_idx];
        const localTs = local && local._synced_at ? new Date(local._synced_at) : new Date(0);
        const remoteTs = new Date(row.updated_at);
        if (remoteTs > localTs) {
          state.plots[row.plot_idx] = rowToPlot(row);
          onMerge(row.plot_idx);
        }
      }
    } catch (e) {
      console.warn('syncInit error:', e);
    }
  };

  window.syncPlots = async function (indices, state, deviceId) {
    if (!isOnline()) return;
    const client = initClient();
    if (!client) return;
    const rows = indices
      .filter(idx => state.plots[idx])
      .map(idx => plotToRow(idx, state.plots[idx], deviceId));
    if (!rows.length) return;
    try {
      const { error } = await client
        .from('plots')
        .upsert(rows, { onConflict: 'plot_idx' });
      if (error) console.warn('syncPlots error:', error.message);
      else {
        for (const row of rows) {
          if (state.plots[row.plot_idx]) {
            state.plots[row.plot_idx]._synced_at = row.updated_at;
          }
        }
      }
    } catch (e) {
      console.warn('syncPlots error:', e);
    }
  };

  window.syncOnNavigate = async function (idx, state, onMerge) {
    if (!isOnline()) return;
    const client = initClient();
    if (!client) return;
    try {
      const { data, error } = await client
        .from('plots')
        .select('*')
        .eq('plot_idx', idx)
        .maybeSingle();
      if (error || !data) return;
      const local = state.plots[idx];
      const localTs = local && local._synced_at ? new Date(local._synced_at) : new Date(0);
      const remoteTs = new Date(data.updated_at);
      if (remoteTs > localTs) {
        state.plots[idx] = rowToPlot(data);
        onMerge(idx);
      }
    } catch (e) {
      // silently ignore - keep local state
    }
  };

  window.uploadPhoto = async function (plotIdx, dataUrl) {
    if (!isOnline()) return null;
    const client = initClient();
    if (!client) return null;
    try {
      const base64 = dataUrl.split(',')[1];
      const byteStr = atob(base64);
      const ab = new ArrayBuffer(byteStr.length);
      const ua = new Uint8Array(ab);
      for (let i = 0; i < byteStr.length; i++) ua[i] = byteStr.charCodeAt(i);
      const blob = new Blob([ab], { type: 'image/jpeg' });
      const path = `plot_${String(plotIdx).padStart(3, '0')}.jpg`;
      const { error } = await client.storage.from('photos').upload(path, blob, {
        upsert: true,
        contentType: 'image/jpeg',
      });
      if (error) { console.warn('uploadPhoto error:', error.message); return null; }
      const { data } = client.storage.from('photos').getPublicUrl(path);
      return data.publicUrl;
    } catch (e) {
      console.warn('uploadPhoto error:', e);
      return null;
    }
  };
})();
