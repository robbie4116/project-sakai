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
  if (!window.__TAURI__) {
    window.__TANIMAN_DEBUG = { tauri: false, reason: 'window.__TAURI__ falsy at offline-storage.js parse time' };
    return;
  }

  // In Tauri mode, localStorage is never the source of truth. Wipe any stale
  // taniman_v3 entry on every launch so it can never leak in via a missed gate.
  try { localStorage.removeItem('taniman_v3'); } catch (e) {}

  let cachedState = null;
  let dataDir = null;
  let writeQueue = Promise.resolve();

  window.__TANIMAN_DEBUG = {
    tauri: true,
    tauriKeys: Object.keys(window.__TAURI__),
    fsAvailable: !!(window.__TAURI__ && window.__TAURI__.fs),
    dataDir: null,
    stateFileExists: null,
    bakFileExists: null,
    cachedStateLoaded: false,
    preloadError: null,
  };

  // Synchronously install the preload promise so the boot glue (taniman.html)
  // can find it immediately after this script finishes parsing.
  window.__TANIMAN_OFFLINE_READY = (async function preload() {
    try {
      dataDir = await window.__TAURI__.core.invoke('get_data_dir');
      window.__TANIMAN_DEBUG.dataDir = dataDir;
      const fs = window.__TAURI__.fs;
      const stateFile = `${dataDir}\\state.json`;
      const bakFile = `${dataDir}\\state.json.bak`;
      const stateExists = await fs.exists(stateFile);
      const bakExists = await fs.exists(bakFile);
      window.__TANIMAN_DEBUG.stateFileExists = stateExists;
      window.__TANIMAN_DEBUG.bakFileExists = bakExists;
      if (stateExists) {
        try {
          cachedState = JSON.parse(await fs.readTextFile(stateFile));
          window.__TANIMAN_DEBUG.cachedStateLoaded = true;
          window.__TANIMAN_DEBUG.cachedSource = 'state.json';
        } catch (e) {
          console.warn('state.json parse failed; trying .bak', e);
          if (bakExists) {
            cachedState = JSON.parse(await fs.readTextFile(bakFile));
            window.__TANIMAN_DEBUG.cachedStateLoaded = true;
            window.__TANIMAN_DEBUG.cachedSource = 'state.json.bak';
          }
        }
      } else if (bakExists) {
        cachedState = JSON.parse(await fs.readTextFile(bakFile));
        window.__TANIMAN_DEBUG.cachedStateLoaded = true;
        window.__TANIMAN_DEBUG.cachedSource = 'state.json.bak';
      }
    } catch (e) {
      console.warn('offline preload failed', e);
      window.__TANIMAN_DEBUG.preloadError = String(e);
      cachedState = null;
    }
  })();

  // -- public hooks ------------------------------------------------
  window.loadPersisted = function () { return cachedState; };

  window.persistState = function (stateBlob) {
    let text;
    try {
      text = JSON.stringify(stateBlob);
    } catch (e) {
      console.warn('persistState failed', e);
      return;
    }

    // Fire-and-forget. Errors surface via console; UI continues.
    writeQueue = writeQueue.catch(function () {
      // Keep later writes moving after an unexpected queue failure.
    }).then(async function () {
      try {
        await window.__TANIMAN_OFFLINE_READY;
        if (!dataDir) throw new Error('offline dataDir unavailable');
        const fs = window.__TAURI__.fs;
        const stateFile = `${dataDir}\\state.json`;
        const tmpFile   = `${dataDir}\\state.json.tmp`;
        const bakFile   = `${dataDir}\\state.json.bak`;
        await fs.writeTextFile(tmpFile, text);
        if (await fs.exists(stateFile)) {
          if (await fs.exists(bakFile)) await fs.remove(bakFile);
          await fs.rename(stateFile, bakFile);
        }
        await fs.rename(tmpFile, stateFile);
      } catch (e) {
        console.warn('persistState failed', e);
      }
    });
  };

  // -- sync-layer no-ops (offline mode has no remote) --------------
  window.syncInit = async function () { /* no-op */ };
  window.syncPlots = async function () { return true; };
  window.syncOnNavigate = async function () { /* no-op */ };

  // -- photo upload writes a JPEG to data/photos/ ------------------
  // Uses the write_photo Rust command instead of fs.writeFile because
  // Uint8Array serialisation over the Tauri global IPC is unreliable;
  // Array.from(bytes) sends a plain JSON number array that Vec<u8> deserialises cleanly.
  window.uploadPhoto = async function (idx, dataUrl, suffix) {
    try {
      await window.__TANIMAN_OFFLINE_READY;
      const comma = dataUrl.indexOf(',');
      const b64 = dataUrl.slice(comma + 1);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const relPath = await window.__TAURI__.core.invoke('write_photo', {
        plotIdx: idx,
        suffix: suffix,
        data: Array.from(bytes),
      });
      return relPath;
    } catch (e) {
      console.warn('uploadPhoto failed', e);
      return null;
    }
  };
})();
