# Taniman — Ambassador Crop Map: Design Spec
**Date:** 2026-05-24  
**Study area:** Ambassador barangay, Tublay, Benguet, Philippines  
**Purpose:** Ground-truth crop data collection for satellite image classification research

---

## 1. Overview

Taniman is a fully offline-capable web app used by researchers visiting farmers in the field. Researchers open the app on an iPad, select one of 64 grid plots covering the Ambassador area, and paint cells on a satellite-backed canvas to mark which crops are present. Data auto-saves locally and syncs to Supabase when a connection is available. The app is deployed as a static site on Vercel.

The existing `taniman.html` + `app.js` + `data.js` codebase is ~95% complete and is used as the base — no rebuild. Four targeted changes bring it to production.

---

## 2. Architecture

```
iPad Safari (browser)
  ├── taniman.html          UI shell (HTML + CSS — unchanged)
  ├── data.js               Plot grid, crop definitions, i18n strings (unchanged)
  ├── app.js                App logic (targeted edits only)
  ├── vendor/               Leaflet, JSZip, FileSaver (local copies — offline)
  ├── fonts/                IBM Plex Sans/Mono, Fraunces (local — offline)
  ├── tiles/plots/          64 satellite JPEGs, one per plot (generated)
  └── tiles/map/{z}/{x}/{y}.jpg  Leaflet offline base tiles, zoom 12–16 (generated)
        │
        │  Supabase JS SDK (loaded from CDN when online; gracefully absent offline)
        ▼
    Supabase (cloud)
        ├── Table: plots
        └── Storage bucket: photos
```

Vercel serves the static files. No server-side code. All Supabase calls are made directly from the browser.

---

## 3. Asset Pipeline (one-time, run before first deploy)

Script: `generate_tiles.py`  
Input: `tublay_satellite.tif` (365 MB, ~1.15 m/px, 3-band RGB — **not committed to git**)  
Requires: `pip install rasterio Pillow`

### 3a. Plot crops (canvas backgrounds)
- For each of the 64 plots in `AMBASSADOR_PLOTS`, crop the TIF to the plot's lat/lng bounds
- Output: `tiles/plots/plot_000.jpg` … `plot_063.jpg`
- Size: 512 × 512 px JPEG quality 85 (~40–60 KB each → ~3.5 MB total)
- Resolution: ~0.85 m/px at 512 px for a ~440 m × 475 m plot — individual terraces clearly visible

### 3b. Leaflet base tiles (overview map)
- Reproject TIF to EPSG:3857, generate XYZ tile pyramid at zoom 12–16
- Clip to bounding box of Ambassador area + 20% padding
- Output: `tiles/map/{z}/{x}/{y}.jpg` (~350 tiles, JPEG quality 80, ~5 MB total)
- Zoom 12–13: context / municipality overview  
- Zoom 14–15: plot-level navigation (default working zoom)  
- Zoom 16: close-up detail (optional max zoom)

### 3c. What goes in git
```
tiles/plots/   ← committed (~3.5 MB)
tiles/map/     ← committed (~5 MB)
vendor/        ← committed (~350 KB)
fonts/         ← committed (~300 KB)
tublay_satellite.tif   ← .gitignored (365 MB)
benguet_satellite.tif  ← .gitignored (168 MB)
```
Total repo additions: ~9–10 MB, well within GitHub limits.

---

## 4. Changes to `app.js`

### 4a. Local tile loading (replaces procedural generator)
`getTile(idx)` currently calls `makeProceduralTile(idx)`. Replace with:
```js
function getTile(idx) {
  if (!imgCache[idx]) {
    const img = new Image();
    img.src = `tiles/plots/plot_${String(idx).padStart(3,'0')}.jpg`;
    img.onload = () => { imgCache[idx] = img; renderCanvas(); };
    imgCache[idx] = img; // store immediately; renderCanvas re-fires on load
  }
  return imgCache[idx];
}
```
`renderCanvas()` already guards against a missing/incomplete image.

### 4b. Leaflet tile URL
In `makeTileLayer()`, replace the ESRI CDN layer with:
```js
L.tileLayer('tiles/map/{z}/{x}/{y}.jpg', {
  minZoom: 12, maxZoom: 16,
  errorTileUrl: 'tiles/map/empty.jpg',  // 1×1 grey JPEG at tiles/map/empty.jpg
  attribution: 'Imagery © Map Tiles API'
})
```
A 1×1 grey `empty.jpg` is provided as a fallback for missing tiles.

### 4c. Vendor + font bundling
- Download Leaflet 1.9.4 CSS+JS, JSZip 3.10.1, FileSaver 2.0.5 into `vendor/`
- Download Google Font files into `fonts/`, add a `fonts/fonts.css` with `@font-face` declarations
- Update `<head>` in `taniman.html` to reference local paths instead of CDN URLs
- Supabase JS SDK stays on CDN (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`) — it is only needed when online, so graceful degradation is acceptable

### 4d. Redo implementation
Add a `redoStack` array alongside `undoStack`. When `snapshotForUndo()` is called, clear the redo stack. `undo()` pushes the current state onto `redoStack` before restoring. New `redo()` function pops from `redoStack`, mirrors the undo logic. Wire to `btn-redo` and `Ctrl+Shift+Z` / `Ctrl+Y`.

---

## 5. Supabase Integration

### 5a. Schema
```sql
create table plots (
  plot_idx   integer primary key,       -- 0–63
  labels     integer[] not null,        -- length 2500, bitmask per cell
  farmer     text not null default '',
  note       text not null default '',
  photo_url  text,                      -- Supabase Storage path, nullable
  device_id  text not null,             -- UUID from localStorage
  updated_at timestamptz not null default now()
);

-- Allow public read/write (no auth — field research app, no sensitive data)
alter table plots enable row level security;
create policy "public access" on plots for all using (true) with check (true);
```

Storage bucket: `photos` (public read, authenticated write via anon key).

### 5b. Device identity
On first launch, generate a UUID and persist to `localStorage` under `taniman_device_id`. This travels with all upserts as `device_id` — useful for debugging which device saved what, but has no access-control role.

### 5c. Sync module (`supabase-sync.js`)
A new 100-line module, loaded after `app.js`. Exposes:

| function | behaviour |
|---|---|
| `syncInit()` | Called on app start. Fetches all rows from `plots`, merges with localStorage state (newer `updated_at` wins per plot), updates in-memory state + re-renders map. |
| `syncPlots(indices)` | Batch-upserts the given plot indices to Supabase. Called by the save scheduler. |
| `syncOnNavigate(idx)` | Fetches the single row for `plot_idx = idx` from Supabase before displaying it. Picks up work done by another device. Runs only if online; any network failure is silently swallowed — local state is kept unchanged. |
| `uploadPhoto(idx, dataUrl)` | Uploads JPEG to `photos/plot_XXX.jpg` in Storage, returns public URL. Called from the photo capture handler. |

### 5d. Save scheduler (changes to `schedSave`)
Two tiers:
1. **Local save** (existing): debounced 400 ms after any change → `localStorage`
2. **Cloud save** (new): 5 s after last change, batch-upserts only plots modified since last cloud sync

```js
const dirtyPlots = new Set();   // plots modified since last cloud sync
let cloudSaveTimer = null;

function schedSave(idx) {
  // tier 1 — unchanged
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);

  // tier 2
  dirtyPlots.add(idx);
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    if (dirtyPlots.size) syncPlots([...dirtyPlots]);
    dirtyPlots.clear();
  }, 5000);
}
```

### 5e. Conflict resolution
Last-write-wins per plot, determined by `updated_at`. On `syncInit()`:
```
for each plot p from Supabase:
  if p.updated_at > localStorage[p.plot_idx].updated_at (or localStorage has no record):
    overwrite local with remote
  else:
    keep local (will be pushed on next cloud save)
```

### 5f. Photo migration
Existing code stores photos as base64 data URLs in localStorage. New behaviour:
- On photo capture: upload to Supabase Storage → store URL in `plot.photo_url`
- `photo_url` is also saved to localStorage (just the URL string, not the base64)
- Keeps localStorage well under Safari's 5 MB limit
- **Legacy entries**: Any existing localStorage entries that contain a base64 `photo` field are left as-is; the app detects whether `plot.photo` (base64) or `plot.photo_url` (Storage URL) is present and renders whichever exists. On next re-capture, the base64 is replaced by the Storage URL.

---

## 6. Deployment

- **Vercel**: Connect GitHub repo → auto-deploy on push. No build step (pure static). `config.js` holds the Supabase URL and anon key and **is committed to the repo**. The Supabase anon key is designed to be public-facing (access is controlled by RLS policies, not by key secrecy), so committing it is intentional and safe for this use case.
- **.gitignore additions**: `tublay_satellite.tif`, `benguet_satellite.tif`, `Benguet_Sentinel2_Median.tif`

---

## 7. What Is Not Changing

- All CSS and HTML structure in `taniman.html`
- The 64-plot grid definition and crop palette in `data.js`
- Painting logic, brush sizes, bitmask cell model
- Undo stack implementation
- Metadata drawer (farmer name, note)
- ZIP export (labels PNG + CSV + metadata JSON)
- Language switcher (EN / TL / IB / IL)
- Theme switcher (dark / light / contrast)
- Progress bar and autosave indicator

---

## 8. File Tree After Implementation

```
thesis-digimap/
├── taniman.html
├── app.js                        (edited)
├── data.js
├── supabase-sync.js              (new)
├── config.js                     (new — Supabase URL + anon key)
├── generate_tiles.py             (new — run once, not deployed)
├── vendor/
│   ├── leaflet.css
│   ├── leaflet.js
│   ├── jszip.min.js
│   └── FileSaver.min.js
├── fonts/
│   ├── fonts.css
│   └── *.woff2
├── tiles/
│   ├── plots/
│   │   └── plot_000.jpg … plot_063.jpg
│   └── map/
│       ├── empty.jpg
│       └── {12..16}/
│           └── {x}/{y}.jpg
├── docs/
│   └── superpowers/specs/
│       └── 2026-05-24-taniman-digimap-design.md
├── .gitignore
└── README.md
```

---

## 9. Out of Scope

- Real-time collaborative painting (two devices painting the same plot cell simultaneously)
- User authentication / login
- Admin dashboard for viewing all collected data
- Mobile-native app (stays as web app, tested on iPad Safari)
- Grid resolution changes (50 × 50 cells per plot is fixed)
- Adding or removing crops beyond the fixed four
