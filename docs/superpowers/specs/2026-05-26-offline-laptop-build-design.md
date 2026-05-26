# Taniman — Offline Laptop Build (Native Desktop App): Design Spec

**Date:** 2026-05-26
**Scope:** Windows laptop only. iPad / macOS / Linux are out of scope for v1.
**Goal:** Ship Taniman as a standalone native `.exe` that runs without any internet — ever. Field data lives next to the .exe so the folder is the unit of distribution and the unit of data.

---

## 1. Overview

The current Taniman app is a static site deployed to Vercel. It works offline once loaded in a browser and syncs to Supabase when online. That model has two real gaps for field research in Ambassador:

1. **First-load dependency.** A laptop that has never visited the Vercel URL cannot run the app at all.
2. **Browser dependency.** "Open this URL in Chrome" is fragile distribution for a researcher in the field. There is no installable artifact.

This spec defines a parallel **native desktop build** that addresses both gaps without disturbing the Vercel deployment. The native build wraps the existing HTML/JS/CSS in **Tauri v2**, producing a single `Taniman.exe` (~18–22 MB) that opens in its own native window, stores data on the local filesystem next to the executable, and never touches the network.

The Vercel deployment continues to exist and continues to use Supabase exactly as today. The native build is generated from the same source tree.

**Tauri version: pin to v2** (the current stable line). All config, permission, and API references below assume v2.

---

## 2. Architecture

```
                          Source tree (one repo)
                                  │
                  ┌───────────────┴───────────────┐
                  │                               │
            Vercel build                     Tauri build
        (existing — unchanged)              (new — this spec)
                  │                               │
   Static site served from vercel.app    Taniman.exe (native window)
                  │                               │
   localStorage  +  Supabase sync         localStorage  +  disk mirror
   (online; supabase-sync.js active)      (offline; offline-storage.js active)
                                                  │
                                          data/ folder next to .exe
                                          (state.json + photos/*.jpg)
```

Both builds load the same `taniman.html`. A small runtime check (`window.__TAURI_INTERNALS__` exists?) determines whether `supabase-sync.js` or `offline-storage.js` activates. No build-time HTML rewriting is required.

```
Taniman.exe (Tauri v2 shell)
  ├── Edge WebView2 (system runtime, pre-installed on Win10 1803+/Win11)
  │     └── Loads bundled taniman.html + app.js + data.js + assets
  │           │
  │           ├── If window.__TAURI_INTERNALS__ present:
  │           │     offline-storage.js activates → uses window.__TAURI__.fs
  │           └── Else (Vercel):
  │                 supabase-sync.js activates → uses Supabase JS SDK
  │
  └── Rust core (src-tauri/src/main.rs)
        ├── On startup: resolves <exe_dir>/data, creates it if missing
        ├── Adds <exe_dir>/data to fs scope at runtime
        └── Exposes Tauri command get_data_dir() to JS
```

---

## 3. Distribution Model

### What ships
A folder, distributable as a ZIP:

```
Taniman-Offline/
├── Taniman.exe         (~18–22 MB; bundles HTML/JS/CSS/tiles/fonts/vendor inside)
└── data/               (auto-created next to the .exe on first run)
    ├── state.json
    ├── state.json.bak  (rolling backup written before each save)
    └── photos/
        └── plot_XX_<timestamp>_<n>.jpg
```

The user copies `Taniman-Offline/` to anywhere on their laptop (Desktop, USB stick, network share), double-clicks `Taniman.exe`, and the app opens in a native window. Closing the window closes the app. There is no installer, no admin rights required, no browser involvement.

### Data lives in the folder, not the browser
The Rust core resolves `std::env::current_exe()` at startup, computes `<exe_dir>/data`, creates it if absent, and registers that directory with Tauri's filesystem scope at runtime so the JS side can read and write inside it. Because data lives next to the .exe rather than in a browser profile:

- Copying `Taniman-Offline/` (including `data/`) to a different laptop preserves all field data.
- The user has full visibility into what was collected — `data/state.json` is human-readable JSON.
- Manual backup is just copying the folder.
- No browser cache clearing, profile reset, or "clear site data" can destroy field work.

The choice of "next to the .exe" rather than `%APPDATA%` is deliberate: the goal is portability and visibility. If `data/` cannot be written (e.g., the .exe is run from a read-only volume), Rust startup fails fast with a clear error dialog and the app refuses to launch.

### Required runtime on the laptop
- **Windows 10 (1803+) or Windows 11.**
- **Edge WebView2 runtime** — pre-installed on all qualifying Windows versions. If absent on a very old/clean install, the user installs it once from Microsoft's standalone bootstrapper. No Python, no Node, no browser choice, no internet, no admin rights for the app itself.

---

## 4. Source Tree Layout

Everything below sits in the existing `thesis-digimap/` repo. Items marked **NEW** are added by this spec.

```
thesis-digimap/
├── taniman.html                     (edited — 2 small changes; §5)
├── app.js                           (edited — ~6 lines; §6.4)
├── data.js                          (unchanged)
├── styles.css                       (unchanged)
├── config.js                        (unchanged)
├── supabase-sync.js                 (edited — 1-line Tauri guard; §5b)
├── offline-storage.js               NEW — Tauri-fs-backed storage module (§6)
├── month-view-utils.js              (unchanged)
├── calendar.js                      (unchanged)
├── vendor/                          (unchanged)
├── fonts/                           (unchanged; fonts.css already exists)
├── tiles/                           (unchanged; ~13 MB)
├── docs/                            (specs and plans)
│
├── src-tauri/                       NEW — Tauri Rust shell
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── package.json                 (declares @tauri-apps/cli devDependency)
│   ├── build.rs
│   ├── icons/                       (.ico + standard PNGs)
│   ├── capabilities/
│   │   └── default.json             (v2 capability file)
│   └── src/
│       └── main.rs                  (~60 LOC: resolve data dir, register fs scope, expose get_data_dir command)
│
├── vercel.json                      EDITED — add framework:null + null install/build commands
└── .gitignore                       EDITED — add src-tauri/target/, src-tauri/node_modules/
```

**`package.json` lives inside `src-tauri/`, not at repo root.** This is deliberate: Vercel auto-detects `package.json` at the repo root and may attempt `npm install`. Keeping it under `src-tauri/` makes it invisible to Vercel and clearly scoped to the desktop-build pipeline.

---

## 5. Changes to `taniman.html` and `supabase-sync.js`

### 5a. Google Fonts CSS → local
Line ~9 today:
```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:...">
```
becomes:
```html
<link rel="stylesheet" href="fonts/fonts.css">
```
`fonts/fonts.css` and the woff2 files already exist in the repo. Applies to Vercel too (one fewer third-party request, faster paint).

### 5b. Conditional sync-layer loading
Today the bottom of `<body>` loads (in order): `data.js → config.js → month-view-utils.js → Supabase SDK (CDN) → supabase-sync.js → app.js → calendar.js`.

Insert `offline-storage.js` **between `supabase-sync.js` and `app.js`** so the offline sync globals (`window.syncInit`, `window.syncPlots`, `window.uploadPhoto`, plus `window.persistState`, `window.loadPersisted`) are defined before `app.js` runs:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="supabase-sync.js"></script>
<script src="offline-storage.js"></script>      <!-- NEW; offline-only IIFE -->
<script src="app.js"></script>
<script src="calendar.js"></script>
```

Each module self-checks the environment and no-ops in the wrong mode:

- `supabase-sync.js`: add `if (window.__TAURI_INTERNALS__) return;` at the top of its IIFE. (`window.__TAURI_INTERNALS__` is injected by Tauri v2 before any page script runs.)
- `offline-storage.js`: starts with `if (!window.__TAURI_INTERNALS__) return;`.

The Supabase CDN `<script>` tag stays. In Tauri mode the script still loads (WebView2 has no internet, so the request fails silently); `supabase-sync.js`'s IIFE returns early before it would try to use the Supabase global, so the failed CDN fetch is harmless. (For belt-and-suspenders, future revision could move Supabase to a local vendor copy — out of scope here.)

---

## 6. `offline-storage.js` — New Module

### 6.1 External shape (same as `supabase-sync.js` where it overlaps)

`app.js` already routes persistence and sync through five global hooks: `window.syncInit`, `window.syncPlots`, `window.syncOnNavigate`, `window.uploadPhoto`, and the `hasSync*()` feature-detection checks. `offline-storage.js` exposes:

| Global | Behaviour in offline mode |
|---|---|
| `window.syncInit(state, afterRemoteMerge, mayMergeRemote)` | No-op. Returns immediately; there is no remote to merge from. |
| `window.syncPlots(list, state, deviceId)` | No-op. Returns `true`. Persistence is handled via `persistState` instead. |
| `window.syncOnNavigate(idx, state, afterRemoteMerge, mayMergeRemote)` | No-op. Returns immediately. |
| `window.uploadPhoto(idx, dataUrl, suffix)` | Decodes the data URL, writes a JPEG to `data/photos/plot_XX_<suffix>.jpg`, returns the **relative path** (`photos/plot_XX_<suffix>.jpg`). |
| `window.persistState(stateBlob)` (NEW hook) | Atomically writes the serialized state blob to `data/state.json`. Called from `app.js`'s `saveState()`. |
| `window.loadPersisted()` (NEW hook) | Reads `data/state.json` and returns the parsed object (or `null` if absent / unreadable). Called from `app.js`'s `loadState()` before falling back to localStorage. |

Note that `syncPlots` is intentionally a no-op: in offline mode there is no separate "cloud save" step — the single `saveState()` debounced write is the source of truth. Keeping `syncPlots` defined (even as a no-op) means `app.js`'s existing `hasSyncPlots()` returns true and its cloud-dirty bookkeeping continues to function harmlessly. Alternatively, leaving `syncPlots` undefined would also work — `hasSyncPlots()` would return false and `markCloudDirty()` would still queue indices without ever flushing. Either way is consistent with current behavior; the spec picks "define as no-op returning true" because it is the smaller behavioral surface.

### 6.2 Implementation surface

Tauri v2 with `withGlobalTauri: true` exposes the filesystem API on `window.__TAURI__.fs`. No npm import, no bundler. Functions used:

- `writeTextFile(path, contents)` — write `state.json.tmp` then rename to `state.json` for atomicity (see 6.3).
- `writeFile(path, Uint8Array)` — write photo bytes.
- `readTextFile(path)` — load `state.json`.
- `exists(path)` — check before reading.
- `rename(oldPath, newPath)` — atomic swap.
- `mkdir(path, { recursive: true })` — ensure `photos/` exists.

The data directory's absolute path is fetched once at startup via `await window.__TAURI__.core.invoke('get_data_dir')`, which the Rust core implements. All subsequent `fs` calls use absolute paths built from that.

### 6.3 Atomic state writes

`saveState()` fires on a 400 ms debounce and may run dozens of times per painting session. To avoid leaving a truncated `state.json` after a crash or yank:

1. Read current `state.json` once at startup; cache it for the session.
2. On each persist: write to `state.json.tmp`, then `rename(state.json.tmp, state.json)`. Rename is atomic on NTFS.
3. Keep one rolling backup: before the rename, copy the previous `state.json` to `state.json.bak`. If a load ever fails parse, fall back to `state.json.bak` (then log a warning).

### 6.4 On-disk schema — `state.json`

`state.json` is the **exact serialization** of the in-memory `state` object that `app.js`'s `saveState()` currently writes to `localStorage` under key `taniman_v3`. We do not invent a separate per-plot file format. The whole point is that disk is a mirror of state — one file, human-readable, lossless. Shape (truncated for clarity):

```json
{
  "version": 3,
  "plotIdx": 3,
  "lang": "en",
  "theme": "dark",
  "brush": "M",
  "crop": 0,
  "paintMonths": 4095,
  "paintStart": null,
  "paintEnd": null,
  "viewMonth": null,
  "viewMonths": 4095,
  "mixedStyle": "blend",
  "showTweaks": false,
  "plots": {
    "0":  { "cells": [ [u16,u16,... 2500 entries], ... CROPS.length entries ],
            "farmerId": "uuid-or-empty",
            "farmer": "Juan Dela Cruz",
            "note": "Mostly cabbage; carrots in NE corner.",
            "photos": [
              { "url": "photos/plot_00_1716700000000_0.jpg", "captured_at": "2026-05-26T09:14:00+08:00" }
            ],
            "_dirty_at": null
          },
    "...": { ... }
  }
}
```

Key shape note: `plots[k].cells` is **one Uint16Array (length 2500) per crop**, not per row. The outer array length equals `CROPS.length` (4 today). Each inner entry is a 12-bit month mask. On the wire (JSON) the inner arrays serialize as plain number arrays via `Array.from(uint16)`, and `loadState()` rehydrates them with `new Uint16Array(a)`. This matches the existing format exactly — no migration needed when a researcher already has localStorage data.

`_dirty_at` is unused in offline mode (no cloud sync) but preserved in the blob to keep round-tripping byte-stable for users who might also run the Vercel build against the same browser.

### 6.5 Photos

Captured photos are routed through `window.uploadPhoto`. The offline implementation:

1. Receive `(idx, dataUrl, suffix)` where `suffix` is `${Date.now()}_${i}` from `app.js:202`.
2. Decode the data URL prefix → raw bytes (Uint8Array).
3. Ensure `data/photos/` exists.
4. Write `data/photos/plot_${padIdx(idx)}_${suffix}.jpg`.
5. Return the relative path `photos/plot_${padIdx(idx)}_${suffix}.jpg`.

`app.js`'s existing logic then stores `{ url: <returned path>, captured_at, dataUrl }` in `plot.photos`. On display, the renderer checks `ph.url` (offline path) before falling back to `ph.dataUrl` (in-memory base64). Existing rendering code at `app.js:202–208` already handles this — no change needed.

Filenames include the millisecond timestamp from `Date.now()` plus an index suffix, so deleting and re-capturing produces a different filename and never overwrites a prior photo.

**No live camera in WebView2 on Windows.** `taniman.html`'s `<input type="file" accept="image/*" capture="environment">` is a hint that mobile browsers honor; desktop Chromium / WebView2 ignores `capture` and shows the standard file picker. Field workflow is therefore: take photos on a phone or camera, copy to the laptop, attach via the file picker. This matches today's behavior — no regression and no new APIs required.

### 6.6 Changes to `app.js`

`app.js` writes to `localStorage` directly in two places that bypass the sync interface. Both need a small persistence hook:

- **`loadState()` (around line 126):** try `window.loadPersisted?.()` first; if it returns a usable object, use that instead of `localStorage.getItem(STORAGE_KEY)`.
  ```js
  function loadState(){
    try {
      const fromDisk = (typeof window.loadPersisted === 'function') ? window.loadPersisted() : null;
      const raw = fromDisk ? JSON.stringify(fromDisk) : localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      for (const k of Object.keys(s.plots||{})) {
        const p = s.plots[k];
        if (p.cells) p.cells = p.cells.map(a => new Uint16Array(a));
      }
      return s;
    } catch(e){ console.warn('load failed', e); return null; }
  }
  ```
  Note `loadPersisted` is **synchronous** in this design — see 6.7 for how `offline-storage.js` makes that work.

- **`saveState()` (around line 138):** after the existing `localStorage.setItem(...)`, also call `window.persistState?.(out)`.
  ```js
  function saveState(){
    try {
      const out = { ...state, plots:{} };
      for (const k of Object.keys(state.plots)) {
        const p = state.plots[k];
        out.plots[k] = { ...p, cells: p.cells ? p.cells.map(a => Array.from(a)) : null };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
      if (typeof window.persistState === 'function') window.persistState(out);
      lastSaveAt = Date.now();
      updateAutosave();
    } catch(e){ console.warn('save failed', e); }
  }
  ```

`getDeviceId()` (around line 102) is left as-is. It still writes/reads `taniman_device_id` to localStorage; in offline mode this is orphaned but harmless — `flushCloudSync` never runs to consume it.

Total `app.js` change: roughly 6 lines added / 2 modified.

### 6.7 Sync vs async — the boot sequence

`window.loadPersisted()` is called from `app.js`'s synchronous `loadState()`. Tauri's `fs.readTextFile` is asynchronous (Promise-based). We can't block `loadState`.

Solution: `offline-storage.js` performs an **async preload** before `app.js` is allowed to run.

The cleanest implementation defers `app.js` execution itself. `offline-storage.js` is loaded synchronously (script tag), and in its IIFE it:

1. If `window.__TAURI_INTERNALS__` is absent → return immediately, do nothing. Vercel build path.
2. Otherwise, hold a Promise resolved when the data dir is fetched and `state.json` is read into a module-level variable `cachedState`.
3. Block `app.js` from starting until the preload is done.

"Block `app.js`" is achieved by **moving the `<script src="app.js">` tag's execution behind a Promise**:

```html
<script src="offline-storage.js"></script>
<script>if (window.__TANIMAN_OFFLINE_READY) window.__TANIMAN_OFFLINE_READY.then(() => {
  const s = document.createElement('script'); s.src = 'app.js'; document.body.appendChild(s);
}); else { const s = document.createElement('script'); s.src = 'app.js'; document.body.appendChild(s); }</script>
```

In offline mode `offline-storage.js` sets `window.__TANIMAN_OFFLINE_READY = <preload promise>`. The inline glue waits on it. In Vercel mode the global is undefined and `app.js` loads immediately as today.

This is slightly more involved than the previous design draft assumed, but it's the only way to keep `loadState()` synchronous (and therefore keep `app.js` unchanged in its async-control structure). The alternative — making `loadState` async — would require revisiting every initialization site in `app.js`, which is exactly the surface we want to avoid.

`window.loadPersisted()` then returns the cached object synchronously.
`window.persistState(out)` returns immediately (fire-and-forget); the disk write proceeds in the background.

### 6.8 ZIP export — keep FileSaver

The existing ZIP export uses JSZip + FileSaver, which fires a download. WebView2 honors the download via its built-in handler — the ZIP lands in the user's Downloads folder via a normal save dialog. No replacement needed. The spec previously proposed swapping to Tauri's `dialog.save()`; that adds complexity (Tauri scope rules forbid writing outside `data/` without extra config) for no benefit. **Drop the replacement.** Out of scope for v1.

---

## 7. Rust Core — `src-tauri/src/main.rs`

About 60 lines. Responsibilities:

1. On startup, resolve `data_dir = current_exe().parent().join("data")`.
2. Create `data_dir` and `data_dir/photos` if missing. If creation fails, show a Tauri error dialog ("Cannot write to <path>. Please move Taniman.exe to a writable folder.") and exit.
3. Register `data_dir` with the v2 filesystem scope:
   ```rust
   app.fs_scope().allow_directory(&data_dir, true)?;
   ```
4. Expose a `#[tauri::command] fn get_data_dir() -> String` returning the absolute path of `data_dir` as a UTF-8 string.
5. Register the WebView window. Title, dimensions per §8.

No other custom commands. The whole JS-facing API is `fs.*` (writes inside scope) plus `core.invoke('get_data_dir')`.

---

## 8. `src-tauri/tauri.conf.json` — Key Settings (v2)

```jsonc
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Taniman",
  "version": "1.0.0",
  "identifier": "ph.cordillera.taniman",
  "build": {
    "devUrl": "http://localhost:5173",          // unused — see frontendDist
    "frontendDist": "../"                       // serve the repo root as the webview's content root
  },
  "app": {
    "windows": [{
      "title": "Taniman — Ambassador Crop Map",
      "width": 1280, "height": 800,
      "minWidth": 1024, "minHeight": 700,
      "resizable": true, "fullscreen": false
    }],
    "withGlobalTauri": true                     // expose window.__TAURI__.* for vanilla <script>
  },
  "bundle": {
    "active": true,
    "targets": ["app"],                          // raw .exe only for v1; no MSI/NSIS
    "icon": ["icons/icon.ico", "icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.png"]
  }
}
```

Capabilities file `src-tauri/capabilities/default.json`:

```jsonc
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Permissions for the Taniman offline app",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:webview:default",
    "core:window:default",
    "fs:default",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "fs:allow-read-file",
    "fs:allow-write-file",
    "fs:allow-exists",
    "fs:allow-mkdir",
    "fs:allow-rename"
  ]
}
```

The actual directory scope is **registered at runtime in `main.rs`** (§7 step 3) rather than declared statically with a `$APP` or `$APPDATA` token, because we want the directory next to the .exe, not the OS app-data directory. v2's `allow_directory` API supports this cleanly.

---

## 9. `vercel.json` Update

To prevent Vercel from auto-detecting `package.json` (none at root, but defensive) and to make the static-only intent explicit:

```jsonc
{
  "cleanUrls": true,
  "trailingSlash": false,
  "framework": null,                            // NEW
  "buildCommand": null,                         // NEW
  "installCommand": null,                       // NEW
  "headers": [ ... existing headers unchanged ... ]
}
```

Combined with keeping `package.json` inside `src-tauri/`, Vercel runs zero install/build steps and serves the static files as before.

---

## 10. Build Pipeline

### One-time dev-machine setup
1. Install Rust via `rustup`.
2. Inside `src-tauri/`: `npm install` (picks up `@tauri-apps/cli` as a devDependency).
3. WebView2 SDK is fetched automatically by Tauri's build.

### Day-to-day commands (run from `src-tauri/`)
```
npm run tauri dev        # hot-reload dev mode (opens a Tauri window pointed at ../)
npm run tauri build      # produces target/release/Taniman.exe
```

Build output:
- `src-tauri/target/release/Taniman.exe` — raw .exe, ~18–22 MB (Tauri shell ~5 MB + repo content baked in via `frontendDist: "../"` ≈ 13 MB tiles + 460 KB fonts + 273 KB vendor + small JS/CSS).

For v1 distribution: copy the raw .exe into a fresh `Taniman-Offline/` folder, ZIP, hand off.

### Vercel build is untouched
Vercel runs no Tauri commands. It serves the static files (`taniman.html`, `app.js`, `data.js`, `vendor/`, `fonts/`, `tiles/`, etc.) exactly as today.

---

## 11. What Stays The Same

- `app.js` painting logic, brush sizes, bitmask cell model, undo/redo stack (in-memory; same as today).
- All CSS and HTML structure beyond the two small tweaks in §5.
- The 64-plot grid definition and crop palette in `data.js`.
- Metadata drawer (farmer name, note, photos).
- Language switcher (EN / TL / IL).
- Theme switcher (dark / light / contrast).
- Map composition legend.
- Map month range scrubber.
- Plot details manual save.
- ZIP export (JSZip + FileSaver — works in WebView2).
- Progress bar and autosave indicator.

---

## 12. What Is Explicitly Out Of Scope

- iPad / iPadOS / Safari.
- macOS or Linux builds. (Tauri supports them; cross-compile or build on those platforms is a follow-up.)
- Auto-update channel. The app is shipped as a standalone artifact and re-shipped manually when source changes.
- Two-way sync between offline data and Supabase. Offline-collected data is moved off the laptop via ZIP export and re-imported into the analysis pipeline by hand.
- Code signing the `.exe`. SmartScreen will warn on first launch ("unrecognized app"); the user clicks "More info → Run anyway." Acceptable for thesis-scale distribution.
- Bundled WebView2 runtime installer. We rely on the system runtime, universal on Win10 1803+/Win11.
- Live in-app camera capture. Continues to use the system file picker.
- Two-process safety: running two `Taniman.exe` instances pointing at the same `data/` is unsupported. README notes this.
- Native save dialog for ZIP export. FileSaver via WebView2's built-in download handler is enough.

---

## 13. Testing Strategy

### 13a. Vercel build regression
1. Push a preview branch. Open the preview URL in Chrome and Edge.
2. Verify the app loads exactly as before. Google Fonts now come from local `fonts/`. Supabase SDK still loads from CDN. Sync still works end-to-end.
3. Verify `window.__TAURI_INTERNALS__` is `undefined` → `offline-storage.js` is a no-op, `supabase-sync.js` is active.
4. Confirm `window.persistState` and `window.loadPersisted` are undefined → `app.js`'s `?.()` calls fall back to localStorage as today.

### 13b. Tauri build (offline) end-to-end
On a Windows laptop with **wifi disconnected**:
1. Copy `Taniman-Offline/Taniman.exe` to an arbitrary folder. Double-click.
2. Native window opens; map renders; tiles load; UI works.
3. Paint cells on plot 0, attach a photo (via file picker), set farmer name, set note.
4. Inspect `data/state.json` on disk — verify content matches in-memory state. Inspect `data/photos/plot_00_*.jpg`.
5. Close the window. Reopen `Taniman.exe`. Verify everything is restored.
6. Copy the whole `Taniman-Offline/` folder (including `data/`) to a second laptop. Run on the second laptop. Verify all field data is present.
7. Trigger ZIP export. Save via WebView2's download handler. Open the ZIP; verify contents (labels PNG + CSV + metadata JSON + photos).
8. Throughout: confirm no outbound network requests with Windows Resource Monitor.

### 13c. Edge cases
- Launch with `data/state.json` corrupted → app falls back to `state.json.bak`; if both fail, starts empty and logs a warning.
- Launch from a read-only volume → Rust startup detects write failure on `data/` creation and shows the error dialog described in §7 step 2.
- USB stick yanked mid-session → next debounced save throws; autosave indicator goes red. Acceptable; in-memory state is intact and the user can re-attach the drive or quit and copy elsewhere.
- Two `Taniman.exe` instances against the same `data/` folder → undefined; documented as not supported.
- `data/photos/` filling the drive → write fails; surfaced via autosave indicator. Out of scope to manage proactively.
- Existing localStorage data on a laptop that also browsed the Vercel build → on first offline launch, `loadPersisted()` returns null (no `state.json` yet), `loadState()` falls back to `localStorage.getItem(STORAGE_KEY)`, picks up the existing browser-side data, and the next save mirrors it to disk. Smooth migration.

---

## 14. Files Added or Edited

| File | Status | Notes |
|---|---|---|
| `taniman.html` | edited | Google Fonts → local; insert `<script src="offline-storage.js">` between supabase-sync.js and app.js; tiny inline glue to defer app.js until offline preload resolves. |
| `supabase-sync.js` | edited | Add `if (window.__TAURI_INTERNALS__) return;` guard at top of IIFE. |
| `app.js` | edited | ~6 lines — wire `loadPersisted` / `persistState` hooks into `loadState` / `saveState`. |
| `offline-storage.js` | **new** | ~200 LOC. Tauri-fs-backed state + photo persistence. IIFE no-ops when not in Tauri. |
| `src-tauri/Cargo.toml` | **new** | Standard Tauri v2 scaffold. |
| `src-tauri/tauri.conf.json` | **new** | Config from §8. |
| `src-tauri/build.rs` | **new** | Standard Tauri v2 `build.rs`. |
| `src-tauri/src/main.rs` | **new** | ~60 LOC; data-dir resolution + scope registration + `get_data_dir` command. |
| `src-tauri/capabilities/default.json` | **new** | v2 capability declarations from §8. |
| `src-tauri/icons/*` | **new** | App icons (icon.ico + standard PNGs), generated via `npm run tauri icon <source.png>`. |
| `src-tauri/package.json` | **new** | Declares `@tauri-apps/cli` devDependency; scripts: `tauri`, `tauri dev`, `tauri build`. |
| `vercel.json` | edited | Add `framework: null`, null `buildCommand`/`installCommand`. |
| `.gitignore` | edited | Add `src-tauri/target/`, `src-tauri/node_modules/`. |
| `README.md` (if present) | edited or new | Short "How to build the offline desktop app" section. |

No changes to: `data.js`, `styles.css`, `config.js`, `vendor/`, `fonts/`, `tiles/`, `month-view-utils.js`, `calendar.js`, `generate_tiles.py`.

---

## 15. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Rust toolchain install on dev machine is the largest one-time setup cost. | Well-documented on Windows. One-time only. |
| WebView2 missing on a very old laptop. | Universal on Win10 1803+/Win11. If absent, install once via Microsoft's bootstrapper. README documents. |
| SmartScreen "unrecognized app" warning on first launch. | Acceptable for thesis-scale distribution. User clicks "Run anyway." Code signing deferred. |
| Atomic write claim must hold. | Write-temp-then-rename, plus a rolling `.bak`. On parse failure at load, fall back to `.bak` (§6.3). |
| Disk write performance during heavy painting. | Saves are debounced (400 ms); each `state.json` write is <1 MB → completes in single-digit ms on any modern SSD. |
| User edits `data/state.json` by hand and corrupts it. | Parse failure on load → falls back to `.bak` → if that also fails, starts empty with a warning. |
| Two `Taniman.exe` instances racing on the same `data/`. | Documented as unsupported. No lockfile in v1. |
| `data/` on a USB stick ejected mid-session. | Saves throw; autosave indicator goes red; in-memory state preserved; user can re-attach or quit + relocate. |
| `app.js` async boot sequence (loadPersisted must be sync). | Preload promise gates `app.js` from loading until `state.json` is in memory (§6.7). |
| Vercel drift from desktop build. | Both builds load the same `taniman.html` + the same source files. The branch point is a single runtime check on `window.__TAURI_INTERNALS__`. Drift is structurally hard. |
| Bundle size. | ~18–22 MB (5 MB Tauri shell + 13 MB tiles + small misc). Acceptable. |
| Tauri v2 API surface changes. | Pin to a specific v2 minor in `Cargo.toml` and `@tauri-apps/cli` (e.g., `2.x.y`). Document the pinned version in README. |
