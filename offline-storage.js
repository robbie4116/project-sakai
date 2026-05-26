// offline-storage.js
// Active only inside the Tauri v2 native build (window.__TAURI__ present).
// In Vercel/browser builds this file's IIFE no-ops on the first check.
//
// Exposes globals matching supabase-sync.js's contract plus two new hooks:
//   window.syncInit, window.syncPlots, window.syncOnNavigate, window.uploadPhoto
//   window.persistState(stateBlob)      - fire-and-forget disk write
//   window.loadPersisted()              - sync; returns cached state object or null
// Also sets:
//   window.__TANIMAN_OFFLINE_READY = Promise   - boot glue waits on this
(function () {
  'use strict';
  if (!window.__TAURI__) return;

  let cachedState = null;
  let dataDir = null;

  // Synchronously install the preload promise so the boot glue (taniman.html)
  // can find it immediately after this script finishes parsing.
  window.__TANIMAN_OFFLINE_READY = (async function preload() {
    try {
      dataDir = await window.__TAURI__.core.invoke('get_data_dir');
      const fs = window.__TAURI__.fs;
      const stateFile = `${dataDir}\\state.json`;
      const bakFile = `${dataDir}\\state.json.bak`;
      if (await fs.exists(stateFile)) {
        try {
          cachedState = JSON.parse(await fs.readTextFile(stateFile));
        } catch (e) {
          console.warn('state.json parse failed; trying .bak', e);
          if (await fs.exists(bakFile)) {
            cachedState = JSON.parse(await fs.readTextFile(bakFile));
          }
        }
      }
    } catch (e) {
      console.warn('offline preload failed', e);
      cachedState = null;
    }
  })();

  // -- public hooks ------------------------------------------------
  window.loadPersisted = function () { return cachedState; };

  window.persistState = function (stateBlob) {
    // Fire-and-forget. Errors surface via console; UI continues.
    void (async function () {
      try {
        const fs = window.__TAURI__.fs;
        const stateFile = `${dataDir}\\state.json`;
        const tmpFile   = `${dataDir}\\state.json.tmp`;
        const bakFile   = `${dataDir}\\state.json.bak`;
        const text = JSON.stringify(stateBlob);
        await fs.writeTextFile(tmpFile, text);
        if (await fs.exists(stateFile)) {
          if (await fs.exists(bakFile)) await fs.remove(bakFile);
          await fs.rename(stateFile, bakFile);
        }
        await fs.rename(tmpFile, stateFile);
      } catch (e) {
        console.warn('persistState failed', e);
      }
    })();
  };

  // -- sync-layer no-ops (offline mode has no remote) --------------
  window.syncInit = async function () { /* no-op */ };
  window.syncPlots = async function () { return true; };
  window.syncOnNavigate = async function () { /* no-op */ };

  // -- photo upload writes a JPEG to data/photos/ ------------------
  window.uploadPhoto = async function (idx, dataUrl, suffix) {
    try {
      const fs = window.__TAURI__.fs;
      const photosDir = `${dataDir}\\photos`;
      if (!(await fs.exists(photosDir))) await fs.mkdir(photosDir, { recursive: true });
      const pad = String(idx).padStart(2, '0');
      const relPath = `photos/plot_${pad}_${suffix}.jpg`;
      const absPath = `${dataDir}\\${relPath.replace(/\//g, '\\')}`;
      const comma = dataUrl.indexOf(',');
      const b64 = dataUrl.slice(comma + 1);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await fs.writeFile(absPath, bytes);
      return relPath;
    } catch (e) {
      console.warn('uploadPhoto failed', e);
      return null;
    }
  };
})();
