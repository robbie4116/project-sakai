# Taniman — Offline Laptop Build (Native Desktop App): Design Spec

**Date:** 2026-05-26
**Scope:** Windows laptop only. iPad and other platforms are explicitly out of scope.
**Goal:** Ship Taniman as a standalone native `.exe` that runs without any internet connection — ever. Field data lives inside the app's own folder so the folder is the unit of distribution and the unit of data.

---

## 1. Overview

The current Taniman app is a static site deployed to Vercel. It is "offline-capable" in the sense that, once loaded in a browser, it can keep working without network and syncs to Supabase when online. That model has two real gaps for field research in Ambassador:

1. **First-load dependency.** A laptop that has never visited the Vercel URL cannot run the app at all.
2. **Browser dependency.** "Open this URL in Chrome" is a fragile distribution story for researchers in the field. There is no installable artifact.

This spec defines a parallel **native desktop build** that addresses both gaps without disturbing the Vercel deployment. The native build wraps the existing HTML/JS/CSS in **Tauri**, producing a single `Taniman.exe` (~10–15 MB) that opens in its own native window, stores data on the local filesystem, and never touches the network.

The Vercel deployment continues to exist and continues to use Supabase exactly as today. The native build is generated from the same source tree.

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
   localStorage  +  Supabase sync         Tauri fs API → ./data/
   (online; uses supabase-sync.js)        (offline; uses offline-storage.js)
```

Both builds load the same `taniman.html`. A small runtime check (`window.__TAURI__` exists?) determines whether the page initializes the Supabase sync layer or the offline-storage layer. No build-time HTML rewriting is required.

```
Taniman.exe (Tauri shell)
  ├── Edge WebView2 (system runtime, pre-installed on Win10/11)
  │     └── Loads bundled taniman.html + app.js + data.js + assets
  │           │
  │           ├── If window.__TAURI__ present:
  │           │     load offline-storage.js → uses Tauri fs API
  │           └── Else (Vercel):
  │                 load supabase-sync.js → uses Supabase JS SDK
  │
  └── Rust core (tauri.conf.json grants fs scope = "$APPCONFIG/data" or sibling "./data")
```

---

## 3. Distribution Model

### What ships
A single executable, optionally accompanied by a `data/` folder on first launch:

```
Taniman-Offline/
├── Taniman.exe         (~10–15 MB; bundles app HTML/JS/CSS/tiles/fonts/vendor)
└── data/               (auto-created next to the .exe on first run)
    ├── plots/plot_00.json … plot_63.json
    ├── photos/plot_XX_<n>.jpg
    ├── farmers.json
    └── state.json
```

The user copies `Taniman-Offline/` to anywhere on their laptop (Desktop, USB stick, network share), double-clicks `Taniman.exe`, and the app opens in a native window. Closing the window closes the app. There is no installer, no admin rights required, no browser involvement.

### Data lives in the folder, not the browser
On first launch, the app creates `./data/` next to the executable and stores all field data as plain JSON and JPEG files there. Because data lives in the folder rather than in a browser profile:

- Copying `Taniman-Offline/` (including `data/`) to a different laptop preserves all field data.
- The user has full visibility into what was collected — `data/plots/plot_03.json` is human-readable.
- Manual backup is just copying the folder.
- No browser cache clearing, profile reset, or "clear site data" can destroy field work.

### Required runtime on the laptop
- **Windows 10 or 11.**
- **Edge WebView2 runtime** — pre-installed on Win10 1803+ and all Win11. Distribution risk is negligible. If absent on a very old machine, Tauri's installer or a bundled bootstrapper can install it (out of scope for v1; we will rely on the system runtime).

No Python, no Node, no browser choice, no internet, no admin rights.

---

## 4. Source Tree Layout

Everything below sits in the existing `thesis-digimap/` repo. Items marked **NEW** are added by this spec. Vercel-relevant files are unchanged.

```
thesis-digimap/
├── taniman.html                    (edited — 2 small changes; see §5)
├── app.js                          (no changes expected)
├── data.js                         (no changes)
├── styles.css                      (no changes)
├── config.js                       (no changes)
├── supabase-sync.js                (no changes — only loaded in Vercel build)
├── offline-storage.js              NEW — Tauri-fs-backed storage module (§6)
├── month-view-utils.js             (no changes)
├── calendar.js                     (no changes)
├── vendor/                         (existing — leaflet, jszip, FileSaver)
├── fonts/                          (existing — IBM Plex, Fraunces, fonts.css)
├── tiles/                          (existing — plots + map XYZ tiles)
├── docs/                           (existing specs and plans)
│
├── src-tauri/                      NEW — Tauri Rust shell
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── icons/                      (.ico, .png — generated from a single source PNG)
│   └── src/
│       └── main.rs                 (~30 lines — boilerplate plus an fs scope check)
│
├── package.json                    NEW — declares `tauri` CLI as a devDependency; npm scripts (§7)
└── .gitignore                      EDITED — add `src-tauri/target/`, `node_modules/`, `dist/`
```

**Why a `package.json` if the app is vanilla HTML/JS?** Tauri's CLI is distributed via npm; using it through npm scripts keeps the build invocation simple (`npm run tauri build`) and avoids requiring a global install. `package.json` declares only the Tauri CLI as a devDependency — the runtime app itself remains pure vanilla JS with no npm runtime dependencies.

---

## 5. Changes to `taniman.html`

Two changes, both small and both safe for the Vercel build:

### 5a. Google Fonts CSS → local
Line ~9 today:
```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:...">
```
becomes:
```html
<link rel="stylesheet" href="fonts/fonts.css">
```
The local `fonts/fonts.css` and woff2 files already exist in the repo. This benefits Vercel too (one fewer third-party request).

### 5b. Conditional sync-layer loading
At the bottom of `<body>`, where the page currently loads `supabase-sync.js` and the Supabase SDK from CDN:

```html
<!-- Existing CDN line — kept for Vercel build -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="supabase-sync.js"></script>

<!-- NEW: offline storage module (only activates inside Tauri) -->
<script src="offline-storage.js"></script>
```

Both scripts are present in both builds. Each one self-checks `window.__TAURI__`:

- `supabase-sync.js` is modified by **one line** at the top: `if (window.__TAURI__) return;` — when running inside Tauri, the IIFE no-ops itself.
- `offline-storage.js` does the inverse: `if (!window.__TAURI__) return;`

This avoids any build-time HTML rewriting and keeps a single canonical `taniman.html`.

---

## 6. `offline-storage.js` — New Module

Same external shape as `supabase-sync.js` so `app.js` does not need to know which is active. The module exposes the global functions/hooks already wired into `app.js`:

| Function | Behaviour (offline mode) |
|---|---|
| `syncInit()` | Reads every `data/plots/*.json` into in-memory state. Reads `data/farmers.json` and `data/state.json`. Re-renders. |
| `syncPlots(indices)` | For each index, writes `data/plots/plot_XX.json` with the plot's labels, farmer, note, photo references, timestamps. Atomic per file. |
| `syncOnNavigate(idx)` | No-op (no remote to fetch from). |
| `uploadPhoto(idx, dataUrl)` | Decodes the data URL, writes `data/photos/plot_XX_<n>.jpg`, returns the relative path. |

Implementation uses `@tauri-apps/api/fs` (`writeTextFile`, `writeBinaryFile`, `readTextFile`, `readDir`, `createDir`, `BaseDirectory.Resource` or app-local equivalent). The `fs` scope is declared in `tauri.conf.json` and limited to `data/**` relative to the app directory.

### Data formats (on disk)

**`data/plots/plot_XX.json`** — one file per plot:
```json
{
  "plot_idx": 3,
  "cells": [[...bitmask row 0...], ...],
  "farmer_id": "uuid-or-empty",
  "farmer": "Juan Dela Cruz",
  "note": "Mostly cabbage; carrots in NE corner.",
  "photos": [
    { "path": "photos/plot_03_0.jpg", "captured_at": "2026-05-26T09:14:00+08:00" }
  ],
  "updated_at": "2026-05-26T09:14:32+08:00"
}
```

**`data/photos/plot_03_0.jpg`** — JPEG blob, written from the camera-capture data URL.

**`data/farmers.json`** — the farmer roster as a JSON array. Same schema as today's localStorage entry.

**`data/state.json`** — small UI state file: last-selected plot index, language, theme. Optional; defaults if absent.

### Save discipline
- Same debounced 400 ms save that today fires `saveState()`. In offline mode the debounced callback writes the affected plot file(s) instead of localStorage.
- Writes are per-plot, never one giant blob — keeps each save fast and the disk format diff-friendly.
- Photo writes happen immediately on capture (one file per photo, no batching).

### Why not IndexedDB?
IndexedDB would also survive across sessions, but it lives inside the WebView2 user-data directory — invisible to the user, not portable, not human-readable. The whole reason for going native is to put data into the folder.

---

## 7. Build Pipeline

### One-time dev-machine setup
1. Install Rust (`rustup`).
2. Install Tauri CLI: `npm install` from the repo root (picks up `package.json` devDependencies). No global installs.
3. WebView2 SDK is pulled automatically by Tauri's build.

### Day-to-day build commands
```
npm run tauri dev        # Hot-reload dev mode (opens a window, watches files)
npm run tauri build      # Produces src-tauri/target/release/bundle/...
```

`npm run tauri build` outputs:
- `src-tauri/target/release/Taniman.exe` (raw .exe, ~12 MB)
- `src-tauri/target/release/bundle/msi/Taniman_x64_en-US.msi` (optional MSI installer; we ignore for v1)
- `src-tauri/target/release/bundle/nsis/Taniman-Setup.exe` (optional NSIS installer; ignore for v1)

For v1, we ship the raw `Taniman.exe` only — copy it into a fresh `Taniman-Offline/` folder, ZIP, distribute.

### Vercel build is untouched
Vercel runs no Tauri commands. It serves the static files (`taniman.html`, `app.js`, `data.js`, `vendor/`, `fonts/`, `tiles/`, etc.) exactly as today. The presence of `src-tauri/` and `package.json` does not affect Vercel because there is no build step configured (`vercel.json` declares it static).

---

## 8. `src-tauri/tauri.conf.json` — Key Settings

```jsonc
{
  "build": {
    "distDir": "../",                 // serve the repo root as the webview's content root
    "devPath": "../"                  // dev mode loads from the repo root
  },
  "package": {
    "productName": "Taniman",
    "version": "1.0.0"
  },
  "tauri": {
    "windows": [{
      "title": "Taniman — Ambassador Crop Map",
      "width": 1280,
      "height": 800,
      "minWidth": 1024,
      "minHeight": 700,
      "resizable": true,
      "fullscreen": false
    }],
    "bundle": {
      "active": true,
      "targets": ["nsis", "msi"],     // also produces raw .exe in target/release/
      "identifier": "ph.cordillera.taniman",
      "icon": ["src-tauri/icons/icon.ico"]
    },
    "allowlist": {
      "fs": {
        "all": false,
        "readFile": true,
        "writeFile": true,
        "readDir": true,
        "createDir": true,
        "removeFile": true,
        "scope": ["$APP/data/**", "$APP/data"]
      },
      "path": { "all": true },
      "dialog": { "open": true, "save": true }
    }
  }
}
```

The `$APP` scope means "the directory next to `Taniman.exe`" — exactly the `data/` sibling described in §3.

`dialog.open`/`dialog.save` are exposed for the existing ZIP export flow (JSZip + FileSaver). Tauri's dialog API replaces FileSaver's browser-download behaviour: on save, the user picks where to drop the ZIP via a native file-save dialog.

---

## 9. ZIP Export Behaviour

The existing ZIP export uses JSZip in-memory and FileSaver to trigger a browser download. In a Tauri window, browser downloads still work (WebView2 supports them), but a native save dialog is nicer and more reliable.

**Plan:** in offline-mode (`window.__TAURI__` present), the export handler builds the ZIP with JSZip exactly as today, converts to a Blob → Uint8Array, then calls Tauri's `dialog.save()` + `fs.writeBinaryFile()` instead of FileSaver. Two extra lines in `app.js` (or a small wrapper in `offline-storage.js` that intercepts the existing export path). Online mode keeps using FileSaver.

---

## 10. What Stays The Same

- `app.js` painting logic, brush sizes, bitmask cell model, undo/redo stack.
- All CSS and HTML structure (other than the two `<link>`/`<script>` tweaks in §5).
- The 64-plot grid definition and crop palette in `data.js`.
- Metadata drawer (farmer name, note, photos).
- Language switcher (EN / TL / IL).
- Theme switcher (dark / light / contrast).
- Map composition legend (recent feature; unchanged).
- Map month range scrubber (recent feature; unchanged).
- Plot details manual save (recent feature; unchanged).
- Progress bar and autosave indicator.

---

## 11. What Is Explicitly Out Of Scope

- iPad / iPadOS / Safari support.
- macOS or Linux builds. (Tauri supports both; we just are not targeting them for v1. The same source can produce them later with `cargo tauri build` on those platforms.)
- Auto-update / online update channel. The app is shipped as a standalone artifact and re-shipped manually when the source changes.
- Two-way sync between offline data and Supabase. Data captured offline stays offline; it is moved off the laptop via the existing ZIP export, which the researcher imports into their analysis pipeline separately.
- Code signing the `.exe`. Windows SmartScreen will warn on first launch ("unrecognized app"); the user clicks "Run anyway." Acceptable for a thesis-scale distribution. Signing requires a $200–400/yr code-signing certificate and is deferred.
- Bundled WebView2 runtime installer. We rely on the system runtime (universal on Win10 1803+ / Win11). If a target machine lacks it, the user installs it once via the standalone Microsoft installer.

---

## 12. Testing Strategy

### 12a. Online build (Vercel)
Regression-test that nothing broke for the existing deployment:
1. Deploy a preview branch to Vercel.
2. Open in Chrome/Edge. Verify the app loads exactly as before — Google Fonts now come from local `fonts/`, Supabase SDK still loads from CDN, sync still works end-to-end.
3. Verify `window.__TAURI__` is undefined so `offline-storage.js` no-ops and `supabase-sync.js` activates.

### 12b. Offline build (Tauri)
On a Windows laptop with **wifi disconnected**:
1. Copy `Taniman-Offline/Taniman.exe` to an arbitrary folder. Double-click.
2. Window opens; map renders; tiles load; UI works.
3. Paint a few cells on plot 0, attach a photo, set farmer name, set a note. Verify `data/plots/plot_00.json` and `data/photos/plot_00_0.jpg` appear on disk with the expected contents.
4. Close the window. Reopen `Taniman.exe`. Verify all field data is restored exactly.
5. Copy the whole `Taniman-Offline/` folder (including `data/`) to a second laptop. Run on the second laptop. Verify the field data is present.
6. Trigger ZIP export. Native save dialog appears. Save the ZIP. Open it; verify contents (labels PNG + CSV + metadata JSON + photos).
7. Wifi off the entire time. No outbound network requests should occur. Verify with Windows Resource Monitor.

### 12c. Edge cases
- Launching with `data/` already populated from a previous session (already covered by 12b step 4).
- Launching with `data/` populated by a *different* device's export (cross-laptop portability) — covered by 12b step 5.
- Launching with a corrupted `data/plots/plot_XX.json` — log the error, skip that plot, keep the rest.
- WebView2 runtime missing — Tauri shows a clear error dialog with a link to install it.

---

## 13. Files Added or Edited

| File | Status | Notes |
|---|---|---|
| `taniman.html` | edited | 2 lines: local fonts CSS link; add `<script src="offline-storage.js">` after existing scripts. |
| `supabase-sync.js` | edited | Add `if (window.__TAURI__) return;` guard at top of IIFE. |
| `offline-storage.js` | **new** | ~150 LOC; mirrors `supabase-sync.js` interface; uses Tauri `fs` + `dialog` APIs. |
| `src-tauri/Cargo.toml` | **new** | Standard Tauri scaffold. |
| `src-tauri/tauri.conf.json` | **new** | Config from §8. |
| `src-tauri/build.rs` | **new** | Standard Tauri build.rs. |
| `src-tauri/src/main.rs` | **new** | ~30 LOC boilerplate. |
| `src-tauri/icons/*` | **new** | App icons (icon.ico + PNGs at standard sizes), generated from a single source PNG via Tauri CLI. |
| `package.json` | **new** | Declares `@tauri-apps/cli` devDependency and npm scripts (`dev`, `tauri`, `tauri build`). |
| `.gitignore` | edited | Add `src-tauri/target/`, `node_modules/`, `dist/`. |
| `README.md` (project root, if any) | edited or new | A short "How to build the offline desktop app" section. |

No changes to: `app.js`, `data.js`, `styles.css`, `config.js`, `vendor/`, `fonts/`, `tiles/`, `month-view-utils.js`, `calendar.js`, `generate_tiles.py`, `vercel.json`.

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Rust toolchain install on dev machine is the largest one-time setup cost. | One-time only; Rust install is well-documented and reliable on Windows. Acceptable. |
| WebView2 missing on a very old laptop. | Universal on Win10 1803+/Win11. If absent, install once via Microsoft's bootstrapper. Documented in README. |
| SmartScreen "unrecognized app" warning on first launch. | Acceptable for thesis-scale distribution. User clicks "Run anyway." Code signing deferred. |
| Disk write performance during heavy painting could feel sluggish. | Saves are debounced (400 ms) and per-plot. Each plot JSON is <100 KB — writes complete in single-digit ms on any modern SSD/HDD. |
| User edits `data/*.json` by hand and corrupts a file. | Files are independent. Corrupted plot is skipped on load with a console warning; rest of the data loads fine. |
| Build pipeline drifts from Vercel (subtle differences accumulate). | Both builds load the same `taniman.html` from the same source tree. The branch point is a single runtime check on `window.__TAURI__`. Drift is structurally hard. |
