# Offline Laptop Build (Tauri v2 Native App) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Taniman as a standalone Windows `.exe` (Tauri v2 native app) that runs with zero internet and stores field data in a sibling `data/` folder next to the executable. The existing Vercel deployment continues unchanged.

**Architecture:** Wrap the existing vanilla HTML/JS app in Tauri v2. Both Vercel and Tauri builds share the same `taniman.html`. A runtime check on `window.__TAURI__` selects either `supabase-sync.js` (online) or a new `offline-storage.js` (offline). Disk persistence lives in `data/state.json` (mirror of the localStorage blob) plus `data/photos/*.jpg`.

**Tech Stack:** Tauri v2 (Rust + WebView2), `@tauri-apps/cli`, `tauri-plugin-fs`, `tauri-plugin-dialog`, Node 18+ for the prepare-dist staging script. No bundler — `withGlobalTauri: true` exposes the fs API on `window.__TAURI__.fs` for vanilla `<script>` tags.

**Spec:** [docs/superpowers/specs/2026-05-26-offline-laptop-build-design.md](../specs/2026-05-26-offline-laptop-build-design.md)

**Reference invariants from the spec — re-read if confused:**
- Detection global is `window.__TAURI__` (gated on `withGlobalTauri: true`), NOT `window.__TAURI_INTERNALS__`.
- `app.js` and `calendar.js` are dynamically injected after `offline-storage.js`'s preload promise resolves — confirmed to be safe because grep shows neither file uses `DOMContentLoaded`.
- The data folder is **next to the .exe** (`current_exe().parent().join("data")`), NOT in `%APPDATA%`. Scope is added at runtime via `app.fs_scope().allow_directory(...)` inside the `.setup` closure, with `use tauri_plugin_fs::FsExt;` imported and `tauri_plugin_fs::init()` registered as a plugin.
- The capability file MUST include `fs:scope` permission for runtime scope additions to take effect.
- The `prepare-dist` step copies a subset of files into `src-tauri/dist-static/` and strips the Supabase CDN `<script>` tag from the staged `taniman.html`. The repo-root `taniman.html` keeps the CDN tag for Vercel.
- All disk writes are atomic via write-temp + rename, with a rolling `.bak` of the previous good `state.json`.

---

## File Structure (touched by this plan)

```
thesis-digimap/
├── taniman.html                       MODIFIED (§5)
├── app.js                             MODIFIED (~6 lines; §6.6 of spec)
├── supabase-sync.js                   MODIFIED (1-line guard)
├── offline-storage.js                 NEW
├── vercel.json                        MODIFIED
├── .gitignore                         MODIFIED
│
└── src-tauri/                         NEW
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── package.json
    ├── capabilities/
    │   └── default.json
    ├── scripts/
    │   └── prepare-dist.mjs
    ├── icons/                         (generated)
    └── src/
        └── main.rs
```

`dist-static/` and `target/` (both under `src-tauri/`) are gitignored build outputs.

---

## Chunk 1: Shared/Repo Prep (low-risk; benefits Vercel too)

### Task 1.1: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Read current .gitignore**

Run: read `.gitignore`. Confirm it does not already mention `src-tauri`.

- [ ] **Step 2: Append Tauri build artifacts**

Append these lines:
```
# Tauri build artifacts (offline desktop build)
src-tauri/target/
src-tauri/node_modules/
src-tauri/dist-static/
```

- [ ] **Step 3: Verify**

Run: `git status`. Confirm `.gitignore` is the only file in the diff.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore Tauri build artifacts"
```

### Task 1.2: Update vercel.json defensive settings

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Read current vercel.json**

Read the file. Note the existing `cleanUrls`, `trailingSlash`, and `headers` blocks.

- [ ] **Step 2: Add framework/build/install null fields**

Insert at the top level (next to `cleanUrls`):
```jsonc
"framework": null,
"buildCommand": null,
"installCommand": null,
```

- [ ] **Step 3: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "chore(vercel): pin framework:null to prevent autodetect on offline build prep"
```

### Task 1.3: Swap Google Fonts CSS link to local

**Files:**
- Modify: `taniman.html` (line ~9)

- [ ] **Step 1: Locate the Google Fonts link**

Grep `taniman.html` for `fonts.googleapis.com`. Confirm exactly one match around line 9.

- [ ] **Step 2: Replace the link**

Replace the entire `<link rel="stylesheet" href="https://fonts.googleapis.com/...">` line with:
```html
<link rel="stylesheet" href="fonts/fonts.css">
```

- [ ] **Step 3: Verify `fonts/fonts.css` exists and references the local woff2 files**

Read `fonts/fonts.css`. Confirm it contains `@font-face` declarations pointing at the woff2 filenames under `fonts/`.

- [ ] **Step 4: Smoke-test in browser (manual)**

Open `taniman.html` from a local server (any: `python -m http.server`, or VS Code Live Server). Open dev tools → Network tab. Reload. Confirm no requests to `fonts.googleapis.com`. Confirm the Fraunces / IBM Plex fonts render in the header.

- [ ] **Step 5: Commit**

```bash
git add taniman.html
git commit -m "feat(fonts): use local fonts.css instead of Google Fonts CDN"
```

---

## Chunk 2: Add the JS persistence abstraction (still works on Vercel as-is)

This chunk introduces `offline-storage.js`, the boot-gate, and the `app.js` hooks. After this chunk, the Vercel build is functionally identical (no `window.__TAURI__` ⇒ everything no-ops to the existing path). The Tauri build is not yet runnable — that happens in Chunk 3+.

### Task 2.1: Create offline-storage.js skeleton

**Files:**
- Create: `offline-storage.js`

- [ ] **Step 1: Write the skeleton IIFE**

Create `offline-storage.js` with:
```js
// offline-storage.js
// Active only inside the Tauri v2 native build (window.__TAURI__ present).
// In Vercel/browser builds this file's IIFE no-ops on the first check.
//
// Exposes globals matching supabase-sync.js's contract plus two new hooks:
//   window.syncInit, window.syncPlots, window.syncOnNavigate, window.uploadPhoto
//   window.persistState(stateBlob)      — fire-and-forget disk write
//   window.loadPersisted()              — sync; returns cached state object or null
// Also sets:
//   window.__TANIMAN_OFFLINE_READY = Promise   — boot glue waits on this
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

  // ── public hooks ────────────────────────────────────────────────
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

  // ── sync-layer no-ops (offline mode has no remote) ──────────────
  window.syncInit = async function () { /* no-op */ };
  window.syncPlots = async function () { return true; };
  window.syncOnNavigate = async function () { /* no-op */ };

  // ── photo upload writes a JPEG to data/photos/ ──────────────────
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
```

- [ ] **Step 2: Verify syntax**

Run: `node -c offline-storage.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add offline-storage.js
git commit -m "feat(offline): add offline-storage.js with Tauri-fs-backed persistence"
```

### Task 2.2: Add Tauri guard to supabase-sync.js

**Files:**
- Modify: `supabase-sync.js`

- [ ] **Step 1: Read the top of supabase-sync.js**

Confirm it opens with `(function () { 'use strict';`.

- [ ] **Step 2: Insert the guard line**

Immediately after `'use strict';` add:
```js
  if (window.__TAURI__) return;
```

- [ ] **Step 3: Verify the file still parses**

Run: `node -c supabase-sync.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add supabase-sync.js
git commit -m "feat(offline): supabase-sync.js no-ops inside Tauri build"
```

### Task 2.3: Wire offline-storage.js + boot glue into taniman.html

**Files:**
- Modify: `taniman.html` (script block near end of `<body>`)

- [ ] **Step 1: Locate the existing script block**

Grep for `supabase-sync.js` in `taniman.html`. It should appear once, near the closing `</body>`. Identify the current order of `<script>` tags: data.js, config.js, month-view-utils.js, Supabase CDN, supabase-sync.js, app.js, calendar.js.

- [ ] **Step 2: Insert offline-storage.js + remove static app.js/calendar.js tags + add boot glue**

Replace the existing trailing script block with:
```html
<script src="data.js"></script>
<script src="config.js"></script>
<script src="month-view-utils.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="supabase-sync.js"></script>
<script src="offline-storage.js"></script>
<script>
  // Boot sequence: wait for offline preload (no-op in Vercel mode),
  // then inject app.js and calendar.js in order.
  (function () {
    var ready = window.__TANIMAN_OFFLINE_READY || Promise.resolve();
    ready.then(function () {
      var s1 = document.createElement('script');
      s1.src = 'app.js';
      s1.onload = function () {
        var s2 = document.createElement('script');
        s2.src = 'calendar.js';
        document.body.appendChild(s2);
      };
      document.body.appendChild(s1);
    });
  })();
</script>
```

Note: keep the existing tag order for data.js/config.js/month-view-utils.js if they were already in that block; only the trailing app.js + calendar.js convert to dynamic injection.

- [ ] **Step 3: Verify Vercel still loads**

Serve the repo locally (`python -m http.server`) and open `taniman.html`. Open dev tools console. Verify:
- No JS errors.
- App renders normally.
- `window.__TAURI__` is `undefined`.
- `window.__TANIMAN_OFFLINE_READY` is `undefined`.
- `window.syncInit` / `window.syncPlots` come from `supabase-sync.js` (paint a cell, confirm cloud sync still attempts in network tab).

- [ ] **Step 4: Commit**

```bash
git add taniman.html
git commit -m "feat(offline): dynamic app.js/calendar.js injection gated on offline preload"
```

### Task 2.4: Add persistState/loadPersisted hooks to app.js

**Files:**
- Modify: `app.js` (around lines 126 and 138)

- [ ] **Step 1: Modify loadState()**

Find `function loadState(){` (line ~126). Replace its body with:
```js
function loadState(){
  try {
    let s = (typeof window.loadPersisted === 'function') ? window.loadPersisted() : null;
    if (!s) {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      s = JSON.parse(raw);
    }
    for (const k of Object.keys(s.plots||{})) {
      const p = s.plots[k];
      if (p.cells) p.cells = p.cells.map(a => new Uint16Array(a));
    }
    return s;
  } catch(e){ console.warn('load failed', e); return null; }
}
```

- [ ] **Step 2: Modify saveState()**

Find `function saveState(){` (line ~138). After the existing `localStorage.setItem(STORAGE_KEY, JSON.stringify(out));` line, add:
```js
    if (typeof window.persistState === 'function') window.persistState(out);
```

- [ ] **Step 3: Verify Vercel still works**

Reload `taniman.html` in browser. Confirm:
- App boots.
- Painting a cell still saves (check `localStorage.getItem('taniman_v3')` in console).
- No console errors.
- Cloud sync still fires for online build.

- [ ] **Step 4: Verify syntax**

Run: `node -c app.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat(offline): wire loadPersisted/persistState hooks into app.js"
```

---

## Chunk 3: Tauri scaffold

This chunk creates the Rust shell. After this chunk, `npm run dev` from `src-tauri/` should open a window pointing at `dist-static/` (which doesn't exist yet — Chunk 4 fixes that).

### Task 3.1: Document prerequisites in repo README

**Files:**
- Modify (or create): `README.md`

- [ ] **Step 1: Add an "Offline build" section**

Append:
```markdown
## Offline desktop build (Windows)

The repo can be built as a standalone `Taniman.exe` for offline field use.

### One-time setup
1. Install [Rust via rustup](https://rustup.rs/).
2. Install Node 18+ (any LTS).
3. From `src-tauri/`: `npm install`.

### Build
From `src-tauri/`:
- `npm run dev`    — hot-reload dev window
- `npm run build`  — produces `target/release/Taniman.exe`

The Tauri build does not affect the Vercel deployment.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(offline): document offline build prerequisites"
```

### Task 3.2: Create src-tauri directory + Cargo.toml

**Files:**
- Create: `src-tauri/Cargo.toml`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p src-tauri/src src-tauri/capabilities src-tauri/scripts src-tauri/icons`

- [ ] **Step 2: Write Cargo.toml**

Create `src-tauri/Cargo.toml`:
```toml
[package]
name = "taniman"
version = "1.0.0"
description = "Taniman — Ambassador Crop Map (offline desktop build)"
authors = ["Robbie Pineda"]
edition = "2021"

[lib]
name = "taniman_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "feat(tauri): add Cargo.toml for offline desktop shell"
```

### Task 3.3: Write tauri.conf.json

**Files:**
- Create: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Write the config**

Create `src-tauri/tauri.conf.json`:
```jsonc
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Taniman",
  "version": "1.0.0",
  "identifier": "ph.cordillera.taniman",
  "build": {
    "frontendDist": "../dist-static",
    "beforeDevCommand": "npm run prepare-dist",
    "beforeBuildCommand": "npm run prepare-dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Taniman — Ambassador Crop Map",
        "width": 1280,
        "height": 800,
        "minWidth": 1024,
        "minHeight": 700,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "withGlobalTauri": true
  },
  "bundle": {
    "active": true,
    "targets": ["app"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.ico",
      "icons/icon.png"
    ]
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(tauri): add tauri.conf.json"
```

### Task 3.4: Write capabilities/default.json

**Files:**
- Create: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Write the capability file**

Create `src-tauri/capabilities/default.json`:
```jsonc
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Permissions for the Taniman offline desktop app",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:webview:default",
    "core:window:default",
    "fs:default",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "fs:allow-write-file",
    "fs:allow-exists",
    "fs:allow-mkdir",
    "fs:allow-rename",
    "fs:allow-remove",
    "fs:scope",
    "dialog:default"
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "feat(tauri): add capability file with fs:scope and required fs perms"
```

### Task 3.5: Write src/main.rs

**Files:**
- Create: `src-tauri/src/main.rs`

- [ ] **Step 1: Write main.rs**

Create `src-tauri/src/main.rs`:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

struct DataDir(PathBuf);

#[tauri::command]
fn get_data_dir(state: tauri::State<DataDir>) -> String {
    state.0.to_string_lossy().to_string()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_data_dir])
        .setup(|app| {
            // Resolve <exe_dir>/data
            let exe = std::env::current_exe()
                .map_err(|e| format!("cannot resolve current_exe: {e}"))?;
            let exe_dir = exe
                .parent()
                .ok_or("current_exe has no parent")?
                .to_path_buf();
            let data_dir = exe_dir.join("data");
            let photos_dir = data_dir.join("photos");

            // Create dirs (idempotent)
            if let Err(e) = std::fs::create_dir_all(&photos_dir) {
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                let msg = format!(
                    "Cannot create data folder at {:?}.\nPlease move Taniman.exe to a writable location.\n\nDetails: {}",
                    data_dir, e
                );
                let _ = app
                    .dialog()
                    .message(msg)
                    .kind(MessageDialogKind::Error)
                    .title("Taniman — Storage Error")
                    .blocking_show();
                std::process::exit(1);
            }

            // Register data_dir with the fs plugin's runtime scope
            app.fs_scope().allow_directory(&data_dir, true)?;

            // Stash the path for the get_data_dir command
            app.manage(DataDir(data_dir));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(tauri): main.rs resolves data dir, registers scope, exposes get_data_dir"
```

### Task 3.6: Write build.rs

**Files:**
- Create: `src-tauri/build.rs`

- [ ] **Step 1: Write build.rs**

Create `src-tauri/build.rs`:
```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/build.rs
git commit -m "feat(tauri): add build.rs"
```

### Task 3.7: Write package.json with prepare-dist + tauri scripts

**Files:**
- Create: `src-tauri/package.json`

- [ ] **Step 1: Write package.json**

Create `src-tauri/package.json`:
```jsonc
{
  "name": "taniman-tauri",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "prepare-dist": "node scripts/prepare-dist.mjs",
    "tauri": "tauri",
    "dev": "tauri dev",
    "build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run (from `src-tauri/`):
```
npm install
```
Expected: `node_modules/` populated, `package-lock.json` created.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/package.json src-tauri/package-lock.json
git commit -m "feat(tauri): npm scripts wiring prepare-dist into tauri dev/build"
```

### Task 3.8: Generate icons

**Files:**
- Create: `src-tauri/icons/*` (multiple PNG + .ico files)

- [ ] **Step 1: Source a 1024×1024 PNG**

Either:
- Reuse any existing 1024×1024 Taniman logo (check `docs/` or screenshots), OR
- Create a placeholder using ImageMagick: `magick -size 1024x1024 xc:#1a3329 -fill white -gravity center -pointsize 600 -annotate +0+0 T /tmp/icon-source.png`

- [ ] **Step 2: Run Tauri's icon generator**

From `src-tauri/`:
```
npm run tauri icon /tmp/icon-source.png
```
Expected: populates `src-tauri/icons/` with `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.png`, plus mac/linux variants (ignored on Windows).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/icons/
git commit -m "feat(tauri): add app icons"
```

---

## Chunk 4: prepare-dist staging script

After this chunk, `npm run prepare-dist` populates `src-tauri/dist-static/` with a correct subset of files.

### Task 4.1: Write scripts/prepare-dist.mjs

**Files:**
- Create: `src-tauri/scripts/prepare-dist.mjs`

- [ ] **Step 1: Write the script**

Create `src-tauri/scripts/prepare-dist.mjs`:
```js
// Stage the offline build's static content.
// - Wipes src-tauri/dist-static/
// - Copies the runtime files from the repo root
// - Strips the Supabase CDN <script> tag from the staged taniman.html
import { existsSync, rmSync, cpSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const SRC_TAURI = resolve(__dirname, '..');
const DIST = join(SRC_TAURI, 'dist-static');

const FILES = [
  'taniman.html', 'app.js', 'data.js', 'styles.css', 'config.js',
  'supabase-sync.js', 'offline-storage.js',
  'month-view-utils.js', 'calendar.js'
];
const DIRS = ['vendor', 'fonts', 'tiles'];

// 1) Wipe dist
if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });

// 2) Copy files
for (const f of FILES) {
  const src = join(REPO, f);
  if (!existsSync(src)) throw new Error(`Missing source file: ${f}`);
  cpSync(src, join(DIST, f));
}

// 3) Copy directories
for (const d of DIRS) {
  const src = join(REPO, d);
  if (!existsSync(src)) throw new Error(`Missing source directory: ${d}`);
  cpSync(src, join(DIST, d), { recursive: true });
}

// 4) Strip the Supabase CDN <script> tag from the staged taniman.html
const htmlPath = join(DIST, 'taniman.html');
const html = readFileSync(htmlPath, 'utf8');
const CDN_RE = /^\s*<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/[^"]+"\s*>\s*<\/script>\s*$/gm;
const matches = html.match(CDN_RE);
if (!matches || matches.length === 0) {
  throw new Error('prepare-dist: Supabase CDN <script> regex matched zero tags in taniman.html. Verify the tag still exists at repo root or update the regex.');
}
const stripped = html.replace(CDN_RE, '');
writeFileSync(htmlPath, stripped);

// 5) Print summary
function dirSize(p) {
  let total = 0;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const full = join(p, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}
const totalBytes = dirSize(DIST);
console.log(`prepare-dist: staged ${FILES.length} files + ${DIRS.length} dirs into ${DIST}`);
console.log(`prepare-dist: total size ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`prepare-dist: stripped ${matches.length} Supabase CDN <script> tag(s)`);
```

- [ ] **Step 2: Run the script**

From `src-tauri/`:
```
npm run prepare-dist
```
Expected output (similar to):
```
prepare-dist: staged 9 files + 3 dirs into .../src-tauri/dist-static
prepare-dist: total size 13.XX MB
prepare-dist: stripped 1 Supabase CDN <script> tag(s)
```

- [ ] **Step 3: Verify the strip worked**

Run: `grep -c "cdn.jsdelivr.net" src-tauri/dist-static/taniman.html`
Expected: `0`.

Run: `grep -c "fonts.googleapis.com" src-tauri/dist-static/taniman.html`
Expected: `0` (already replaced in Task 1.3).

- [ ] **Step 4: Verify the offline-storage.js is staged**

Run: `ls -l src-tauri/dist-static/offline-storage.js`
Expected: file exists, non-empty.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/scripts/prepare-dist.mjs
git commit -m "feat(tauri): prepare-dist staging script with CDN tag strip"
```

---

## Chunk 5: First build + smoke test

### Task 5.1: Run the first dev build

**Files:** none modified.

- [ ] **Step 1: From src-tauri/ run dev**

Run: `npm run dev`
Expected: Tauri compiles the Rust shell (first build is slow, 2–5 minutes). A native window titled "Taniman — Ambassador Crop Map" opens. The Leaflet map is visible. Console may show JS errors if any wiring is wrong.

- [ ] **Step 2: Open dev tools (right-click → Inspect, if enabled in dev mode)**

In the dev console, run:
```js
window.__TAURI__              // should be an object
window.__TANIMAN_OFFLINE_READY // should be a Promise
typeof window.persistState    // "function"
typeof window.loadPersisted   // "function"
await window.__TAURI__.core.invoke('get_data_dir')  // absolute path string ending in \data
```

If any of those are wrong, halt and fix.

- [ ] **Step 3: Verify data/ folder created on disk**

Look at `src-tauri/target/debug/` (or wherever the dev .exe runs from). A `data/photos/` subfolder should exist.

- [ ] **Step 4: Smoke-test painting**

Click a plot. Paint a cell. Wait ~1 second for the debounced save. Run in console:
```js
const fs = window.__TAURI__.fs;
const dir = await window.__TAURI__.core.invoke('get_data_dir');
await fs.readTextFile(dir + '\\state.json')
```
Expected: non-empty JSON string matching the in-memory state.

- [ ] **Step 5: Verify no outbound network requests**

In dev tools Network tab, refresh. No requests to `cdn.jsdelivr.net`, `fonts.googleapis.com`, or `supabase`. (Leaflet tiles all come from `tiles/*` local paths.)

- [ ] **Step 6: Close the dev window**

### Task 5.2: Build the release .exe

- [ ] **Step 1: Run release build**

From `src-tauri/`:
```
npm run build
```
Expected: completes in 2–5 minutes (longer on first cold compile). Final output line names `Taniman.exe` location.

- [ ] **Step 2: Locate Taniman.exe**

Path: `src-tauri/target/release/Taniman.exe`
Verify size with `ls -lh`. Expected: 15–25 MB.

- [ ] **Step 3: Copy to a fresh test directory**

```
mkdir /tmp/taniman-test
cp src-tauri/target/release/Taniman.exe /tmp/taniman-test/
```

- [ ] **Step 4: Run from the fresh location**

Double-click `Taniman.exe` in `/tmp/taniman-test/`. Verify:
- Window opens.
- Map renders.
- `/tmp/taniman-test/data/` and `/tmp/taniman-test/data/photos/` are created.

- [ ] **Step 5: Commit any small fixes that came out of smoke-testing**

If you had to tweak `main.rs`, `offline-storage.js`, etc., commit them now with descriptive messages.

---

## Chunk 6: End-to-end offline verification

These are manual verification tasks. Document failures as new tasks.

### Task 6.1: Wifi-off field simulation

- [ ] **Step 1: Disable wifi on the test laptop**

- [ ] **Step 2: Launch Taniman.exe from /tmp/taniman-test/**

Window opens; map renders; tiles load from disk.

- [ ] **Step 3: Paint cells on plot 3**

Paint a recognizable shape (e.g., border). Switch crops. Paint more.

- [ ] **Step 4: Attach a photo**

Click the photo button on plot 3. File picker opens. Select any JPEG. Confirm thumbnail appears.

- [ ] **Step 5: Set farmer name and note**

- [ ] **Step 6: Inspect disk**

Outside the app, open `/tmp/taniman-test/data/state.json` in a text editor. Verify:
- Plot 3 has the cells data.
- `farmer` and `note` are populated.
- `photos[0].url` is `photos/plot_03_<timestamp>_0.jpg`.

Open `/tmp/taniman-test/data/photos/`. Verify the JPEG is present and viewable.

- [ ] **Step 7: Close and reopen**

Close `Taniman.exe`. Relaunch. Verify all of plot 3's state restored.

- [ ] **Step 8: Verify .bak rotation**

After at least two save cycles since first launch, `data/state.json.bak` should exist. `ls -l /tmp/taniman-test/data/state.json*`

### Task 6.2: Cross-machine portability

- [ ] **Step 1: Copy /tmp/taniman-test/ (entire folder including data/) to a different machine OR a different folder on the same machine**

Example: `cp -r /tmp/taniman-test /tmp/taniman-test-copy`

- [ ] **Step 2: Launch the copy**

`/tmp/taniman-test-copy/Taniman.exe` opens. Verify all field data from the original test is present. Photos render. Cells render.

### Task 6.3: ZIP export

- [ ] **Step 1: From inside Taniman.exe, trigger ZIP export**

WebView2's built-in download handler should fire. Save the ZIP to Downloads.

- [ ] **Step 2: Inspect ZIP contents**

Open the ZIP. Verify: labels PNG, CSV, metadata JSON, and photos are present.

### Task 6.4: Corruption fallback

- [ ] **Step 1: Close Taniman.exe**

- [ ] **Step 2: Corrupt state.json**

`echo "garbage" > /tmp/taniman-test/data/state.json`

- [ ] **Step 3: Relaunch Taniman.exe**

Expected: the app boots using `state.json.bak`, with the previous-good state. Console should warn "state.json parse failed; trying .bak".

### Task 6.5: Read-only volume rejection

- [ ] **Step 1: Place Taniman.exe in a read-only location**

Either a CD ISO mount, a read-only USB, or `attrib +R` on a Windows folder.

- [ ] **Step 2: Launch**

Expected: Tauri error dialog appears ("Cannot create data folder at ..."). App exits cleanly.

---

## Chunk 7: Vercel regression + ship checklist

### Task 7.1: Vercel preview deploy

- [ ] **Step 1: Push current branch to origin**

```bash
git push origin <branch-name>
```

- [ ] **Step 2: Open the Vercel preview URL**

Vercel auto-deploys preview branches. Find the URL in the Vercel dashboard or PR check.

- [ ] **Step 3: Smoke-test the preview in Chrome AND Edge**

- App loads.
- Fonts render (Fraunces in header, IBM Plex in body).
- No requests to `fonts.googleapis.com` in Network tab.
- Supabase CDN request succeeds.
- `window.__TAURI__` is `undefined`.
- `window.__TANIMAN_OFFLINE_READY` is `undefined`.
- Painting a cell still triggers a Supabase upsert (check Network tab for a request to your Supabase project).

### Task 7.2: Package for distribution

- [ ] **Step 1: Create Taniman-Offline/ folder**

```
mkdir Taniman-Offline
cp src-tauri/target/release/Taniman.exe Taniman-Offline/
```

- [ ] **Step 2: Write a brief README.txt inside**

```
Taniman — Ambassador Crop Map (offline desktop build)

To use:
  Double-click Taniman.exe.

Field data is saved to a "data" folder next to this executable. To
back up or transfer your work, copy the entire Taniman-Offline folder
(including the data subfolder).

Requires Windows 10 (1803+) or Windows 11. The first launch may show
a SmartScreen warning ("Windows protected your PC") — click "More
info" then "Run anyway".

To export your data as a ZIP for analysis, use the Export button
inside the app.
```

- [ ] **Step 3: Zip it**

```
cd Taniman-Offline/.. && zip -r Taniman-Offline.zip Taniman-Offline/
```

- [ ] **Step 4: Test the ZIP on a fresh location**

Extract the ZIP somewhere else. Run `Taniman.exe`. Confirm it works.

### Task 7.3: Final commit + tag

- [ ] **Step 1: Verify clean working tree**

```bash
git status
```

- [ ] **Step 2: Push final branch**

```bash
git push origin <branch>
```

- [ ] **Step 3: Tag v1.0 offline release** (optional)

```bash
git tag -a v1.0-offline -m "Offline desktop build v1.0"
git push origin v1.0-offline
```

---

## Reference: Spec sections to consult during implementation

- **§3** — folder layout shipped to users
- **§5b** — boot glue + detection global + Supabase CDN handling
- **§6.1–6.7** — offline-storage.js contract, atomic writes, async preload sequence
- **§7** — Rust main.rs structure (FsExt trait, plugin registration, setup closure)
- **§8** — tauri.conf.json + capability file (incl. `fs:scope` permission)
- **§10.1** — prepare-dist.mjs behaviour (and the fail-loud regex)
- **§10A** — tile coverage map (zoom-out is covered by `tiles/context/`)
- **§13** — full testing checklist (Chunks 5–7 implement this)
- **§15** — risks and edge-case behaviour
