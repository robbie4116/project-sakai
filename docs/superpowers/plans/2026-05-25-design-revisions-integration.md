# Design Revisions Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate five files from a claude.ai/design redesign into the Taniman thesis digimap project, upgrading the data model from v2 (per-cell crop bitmask) to v3 (per-cell per-crop 12-bit month mask), preserving the offline tile stack, and updating Supabase sync.

**Architecture:** The new design files are copied directly from `C:\Users\Robbie Pineda\Downloads\revise\` and patched in-place: four CDN script/link tags are swapped for local `vendor/` paths, the new `app.js`'s minimal `initMap()` is replaced with the current offline-tile implementation, and `supabase-sync.js` is rewritten for the new `cells`/`farmerId` data model.

**Tech Stack:** Vanilla JS, Leaflet 1.9.4 (local vendor), JSZip + FileSaver (local vendor), Supabase JS SDK, localStorage (key `taniman_v3`).

**Spec:** `docs/superpowers/specs/2026-05-25-design-revisions-integration-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `taniman.html` | Replace + patch | App shell, vendor refs, script load order |
| `app.js` | Replace + patch initMap + patch applyTheme | v3 state, cells model, calendar, roster, ZIP export |
| `data.js` | Replace | CROPS (hex/emoji), STRINGS (v3 keys + legacy merge) |
| `calendar.js` | New | Schedule picker + map month scrubber widgets |
| `styles.css` | New | Full theme CSS (dark/light, all components) |
| `supabase-sync.js` | Rewrite plotToRow/rowToPlot | Cloud sync for v3 data model |
| `docs/supabase-setup.sql` | Update | Schema of record (already applied in console) |

---

## Chunk 1: File Copy, HTML Patches, app.js Tile Patch

### Task 1: Copy source files and patch `taniman.html`

**Files:**
- Replace: `taniman.html`
- Replace: `app.js`
- Replace: `data.js`
- Create: `calendar.js`
- Create: `styles.css`

- [ ] **Step 1.1: Copy all five design files into the project root**

  Run in PowerShell from `D:\Repositories\thesis-digimap`:
  ```powershell
  Copy-Item "C:\Users\Robbie Pineda\Downloads\revise\Taniman.html" "taniman.html" -Force
  Copy-Item "C:\Users\Robbie Pineda\Downloads\revise\app.js"       "app.js"       -Force
  Copy-Item "C:\Users\Robbie Pineda\Downloads\revise\data.js"      "data.js"      -Force
  Copy-Item "C:\Users\Robbie Pineda\Downloads\revise\calendar.js"  "calendar.js"  -Force
  Copy-Item "C:\Users\Robbie Pineda\Downloads\revise\styles.css"   "styles.css"   -Force
  ```

  Verify all five files exist:
  ```powershell
  Get-Item taniman.html, app.js, data.js, calendar.js, styles.css | Select-Object Name, LastWriteTime
  ```
  Expected: all five files with today's timestamp.

- [ ] **Step 1.2: Patch `taniman.html` — swap CDN Leaflet CSS → vendor**

  In `taniman.html`, find and replace:
  ```html
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  ```
  With:
  ```html
  <link rel="stylesheet" href="vendor/leaflet.css">
  ```

- [ ] **Step 1.3: Patch `taniman.html` — strip cache buster on styles.css**

  Find and replace:
  ```html
  <link rel="stylesheet" href="styles.css?v=8">
  ```
  With:
  ```html
  <link rel="stylesheet" href="styles.css">
  ```

- [ ] **Step 1.4: Patch `taniman.html` — swap CDN Leaflet JS → vendor**

  Find and replace:
  ```html
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  ```
  With:
  ```html
  <script src="vendor/leaflet.js"></script>
  ```

- [ ] **Step 1.5: Patch `taniman.html` — swap CDN JSZip → vendor**

  Find and replace:
  ```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  ```
  With:
  ```html
  <script src="vendor/jszip.min.js"></script>
  ```

- [ ] **Step 1.6: Patch `taniman.html` — swap CDN FileSaver → vendor**

  Find and replace:
  ```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"></script>
  ```
  With:
  ```html
  <script src="vendor/FileSaver.min.js"></script>
  ```

- [ ] **Step 1.7: Patch `taniman.html` — replace app script block with full load order**

  The new `Taniman.html` is missing `config.js`, the Supabase SDK, and `supabase-sync.js`. Fix all of this in one step by replacing the bottom script block.

  Find (these three consecutive lines near the end of the file):
  ```html
  <script src="data.js"></script>
  <script src="app.js?v=7"></script>
  <script src="calendar.js?v=7"></script>
  ```
  With:
  ```html
  <script src="data.js"></script>
  <script src="config.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script src="supabase-sync.js"></script>
  <script src="app.js"></script>
  <script src="calendar.js"></script>
  ```

  Load order matters: `data.js` (CROPS/STRINGS) → `config.js` (Supabase keys) → SDK → `supabase-sync.js` (exposes `syncInit`/`syncPlots` on `window`) → `app.js` (calls them on init) → `calendar.js` (consumes `window.TANIMAN`).

- [ ] **Step 1.8: Verify script tags are correct**

  Run:
  ```powershell
  Select-String -Path taniman.html -Pattern "unpkg|cdnjs"
  ```
  Expected: **no output** (zero matches — CDN Leaflet/JSZip/FileSaver are gone).

  Run:
  ```powershell
  Select-String -Path taniman.html -Pattern "config\.js|supabase|supabase-sync"
  ```
  Expected: three matches (config.js, the CDN SDK line, supabase-sync.js).

- [ ] **Step 1.9: Commit (taniman.html, data.js, calendar.js, styles.css only — app.js committed after Task 2)**

  ```powershell
  git add taniman.html data.js calendar.js styles.css
  git commit -m "feat: copy v3 design files and patch vendor/supabase refs"
  ```

---

### Task 2: Patch `app.js` — restore offline tile stack

**Files:**
- Modify: `app.js` (lines 309–331 replacement + applyTheme patch)

**Context:** The new `app.js` ships with a minimal `initMap()` that only loads ESRI from CDN (lines 309–331). We replace that block with the full offline-first tile stack from the prior implementation. `applyTheme()` in the new file (find it with `// ── THEME ──`) also needs a tile re-layer block.

- [ ] **Step 2.1: Replace the MAP section header and `initMap()` in `app.js`**

  In `app.js`, find this entire block (lines ~309–331 after copy — the `// ── MAP ──` header through the closing `}` of `initMap`):

  ```js
  // ── MAP ───────────────────────────────────────────────────────────
  function initMap(){
    map = L.map('map', {
      center:[16.482,120.640],
      zoom:14,
      minZoom:11, maxZoom:18,
      zoomControl:false,
      attributionControl:false,
      fadeAnimation: false,
      zoomAnimation: false,
    });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: '', updateWhenIdle: false, keepBuffer: 4
    }).addTo(map);
    L.polygon(POLY, {
      color:'#F2C84B', weight:2.5, dashArray:'7,5',
      fillColor:'#F2C84B', fillOpacity:0.04, interactive:false
    }).addTo(map);
    drawPlotsOnMap();
    map.fitBounds(L.polygon(POLY).getBounds().pad(0.10));
    document.getElementById('zoom-in').onclick = ()=>map.zoomIn();
    document.getElementById('zoom-out').onclick = ()=>map.zoomOut();
  }
  ```

  Replace with this full block:

  ```js
  // ── MAP ───────────────────────────────────────────────────────────
  let contextTileLayerRef = null;
  let esriTileLayerRef = null;
  let detailTileLayerRef = null;
  const MAP_TILE_VERSION = '20260524-esri';
  const MAP_CONTEXT_MIN_ZOOM = 10;
  const MAP_CONTEXT_MAX_ZOOM = 13;
  const MAP_DETAIL_MIN_ZOOM = 12;
  const MAP_DETAIL_MAX_ZOOM = 16;
  const MAP_APP_MIN_ZOOM = 10;
  const MAP_APP_MAX_ZOOM = 16;
  const MAP_CONTEXT_BOUNDS = L.latLngBounds(
    [16.1724728083975, 120.43212890625],
    [16.93070509876553, 120.9375]
  );
  const MAP_DETAIL_BOUNDS = L.latLngBounds(
    [16.46141, 120.62388],
    [16.49551, 120.65667]
  );

  function makeContextTileLayer() {
    return L.tileLayer(`tiles/context/{z}/{x}/{y}.jpg?v=${MAP_TILE_VERSION}`, {
      minZoom: MAP_APP_MIN_ZOOM,
      maxZoom: MAP_APP_MAX_ZOOM,
      minNativeZoom: MAP_CONTEXT_MIN_ZOOM,
      maxNativeZoom: MAP_CONTEXT_MAX_ZOOM,
      bounds: MAP_CONTEXT_BOUNDS,
      noWrap: true,
      errorTileUrl: 'tiles/context/empty.jpg',
      attribution: '',
    });
  }

  function makeEsriTileLayer() {
    return L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        noWrap: true,
        errorTileUrl: '',
        attribution: '',
      }
    );
  }

  function makeDetailTileLayer() {
    return L.tileLayer(`tiles/map/{z}/{x}/{y}.jpg?v=${MAP_TILE_VERSION}`, {
      minZoom: MAP_DETAIL_MIN_ZOOM,
      maxZoom: MAP_APP_MAX_ZOOM,
      minNativeZoom: MAP_DETAIL_MIN_ZOOM,
      maxNativeZoom: MAP_DETAIL_MAX_ZOOM,
      bounds: MAP_DETAIL_BOUNDS,
      noWrap: true,
      errorTileUrl: 'tiles/map/empty.jpg',
      attribution: '',
    });
  }

  function initMap(){
    map = L.map('map', {
      center:[16.482,120.640],
      zoom:14,
      minZoom: MAP_APP_MIN_ZOOM,
      maxZoom: MAP_APP_MAX_ZOOM,
      maxBounds: MAP_CONTEXT_BOUNDS,
      maxBoundsViscosity: 0.85,
      zoomControl:false,
      attributionControl:false,
      zoomAnimation:false,
    });
    contextTileLayerRef = makeContextTileLayer().addTo(map);
    detailTileLayerRef  = makeDetailTileLayer().addTo(map);
    esriTileLayerRef    = makeEsriTileLayer().addTo(map);
    L.polygon(POLY, {
      color:'#F2C84B', weight:2.5, dashArray:'7,5',
      fillColor:'#F2C84B', fillOpacity:0.04, interactive:false
    }).addTo(map);
    drawPlotsOnMap();
    map.fitBounds(L.polygon(POLY).getBounds().pad(0.10));
    document.getElementById('zoom-in').onclick = ()=>map.zoomIn();
    document.getElementById('zoom-out').onclick = ()=>map.zoomOut();
  }
  ```

  The line immediately following the replacement block should be `function plotStyle(idx){` — confirm this is untouched.

- [ ] **Step 2.2: Patch `applyTheme()` in `app.js` — add tile re-layer block**

  In `app.js`, find the `// ── THEME ──` section. The `applyTheme()` function looks like:

  ```js
  function applyTheme(){
    document.documentElement.setAttribute('data-theme', state.theme);
    document.querySelectorAll('.theme-btn').forEach(b=>b.classList.toggle('on', b.dataset.theme===state.theme));
    // re-render dependent visuals
    renderCanvas();
    if (map) {
      drawPlotsOnMap();
    }
  }
  ```

  Add the tile re-layer block **before** the `renderCanvas()` call:

  ```js
  function applyTheme(){
    document.documentElement.setAttribute('data-theme', state.theme);
    document.querySelectorAll('.theme-btn').forEach(b=>b.classList.toggle('on', b.dataset.theme===state.theme));
    if (map && contextTileLayerRef && esriTileLayerRef && detailTileLayerRef) {
      map.removeLayer(esriTileLayerRef);
      map.removeLayer(detailTileLayerRef);
      map.removeLayer(contextTileLayerRef);
      contextTileLayerRef = makeContextTileLayer().addTo(map);
      detailTileLayerRef  = makeDetailTileLayer().addTo(map);
      esriTileLayerRef    = makeEsriTileLayer().addTo(map);
    }
    // re-render dependent visuals
    renderCanvas();
    if (map) {
      drawPlotsOnMap();
    }
  }
  ```

- [ ] **Step 2.3: Verify `app.js` has no remaining reference to the old single ESRI tileLayer call**

  Run:
  ```powershell
  Select-String -Path app.js -Pattern "updateWhenIdle|keepBuffer"
  ```
  Expected: **no output**.

- [ ] **Step 2.4: Open the app in a browser and verify the map loads**

  Open `taniman.html` directly in Chrome (or via a local server). Check all of:
  - [ ] Map renders without a blank white screen or JS errors in the console
  - [ ] Satellite tiles visible at zoom 14 (detail tiles over Ambassador, Tublay)
  - [ ] Plot rectangles rendered on the map
  - [ ] Zoom in/out buttons work
  - [ ] Toggling theme (dark/light) re-renders without the map going blank

- [ ] **Step 2.5: Commit**

  ```powershell
  git add app.js
  git commit -m "feat: restore offline tile stack and applyTheme re-layer in v3 app"
  ```

---

## Chunk 2: Supabase Sync Rewrite + Schema File Update

### Task 3: Rewrite `supabase-sync.js` for v3 data model

**Files:**
- Modify: `supabase-sync.js` (plotToRow and rowToPlot functions only)

**Context:** The `plots` table now has `cells jsonb` (4 arrays of 2500 uint16 values, one per crop) and `farmer_id text` instead of `labels integer[]`. All other sync logic (conflict resolution, upsert strategy, photo upload) is unchanged.

- [ ] **Step 3.1: Replace `plotToRow` in `supabase-sync.js`**

  Find the existing function:
  ```js
  function plotToRow(idx, plotData, deviceId) {
    return {
      plot_idx: idx,
      labels: plotData.labels ? Array.from(plotData.labels) : [],
      farmer: plotData.farmer || '',
      note: plotData.note || '',
      photo_url: encodePhotos(plotData.photos) ?? (plotData.photo_url || null),
      device_id: deviceId,
      updated_at: new Date().toISOString(),
    };
  }
  ```

  Replace with:
  ```js
  function plotToRow(idx, plotData, deviceId) {
    return {
      plot_idx: idx,
      cells: plotData.cells ? plotData.cells.map(a => Array.from(a)) : [],
      farmer_id: plotData.farmerId || '',
      farmer: plotData.farmer || '',
      note: plotData.note || '',
      photo_url: encodePhotos(plotData.photos) ?? (plotData.photo_url || null),
      device_id: deviceId,
      updated_at: new Date().toISOString(),
    };
  }
  ```

- [ ] **Step 3.2: Replace `rowToPlot` in `supabase-sync.js`**

  Find the existing function:
  ```js
  function rowToPlot(row) {
    return {
      labels: new Uint8Array(row.labels || []),
      farmer: row.farmer || '',
      note: row.note || '',
      photos: decodePhotos(row.photo_url), photo_url: null, photo: null,
      _synced_at: row.updated_at,
    };
  }
  ```

  Replace with:
  ```js
  function rowToPlot(row) {
    return {
      cells: Array.isArray(row.cells) ? row.cells.map(a => new Uint16Array(a)) : [],
      farmerId: row.farmer_id || '',
      farmer: row.farmer || '',
      note: row.note || '',
      photos: decodePhotos(row.photo_url), photo_url: null, photo: null,
      _synced_at: row.updated_at,
    };
  }
  ```

- [ ] **Step 3.3: Verify no remaining `labels` references in `supabase-sync.js`**

  Run:
  ```powershell
  Select-String -Path supabase-sync.js -Pattern "\blabels\b"
  ```
  Expected: **no output**.

- [ ] **Step 3.4: Verify the sync works end-to-end**

  1. Open `taniman.html` in Chrome with DevTools Network tab open.
  2. Paint some cells on Plot 1 (pick a crop, drag on the canvas).
  3. Wait ~3 seconds for autosave, or click the save button.
  4. In the Supabase dashboard → Table Editor → `plots` table, confirm:
     - A row appears with `plot_idx = 0`
     - The `cells` column contains a JSON array (not null, not `[]`)
     - `farmer_id` column is present (empty string is fine)
     - No `labels` column exists
  5. Reload the page — the painted cells should reload from localStorage (`taniman_v3`).

- [ ] **Step 3.5: Commit**

  ```powershell
  git add supabase-sync.js
  git commit -m "feat: rewrite supabase-sync for v3 cells/farmerId data model"
  ```

---

### Task 4: Update `supabase-setup.sql` to match applied schema

**Files:**
- Modify: `docs/supabase-setup.sql`

**Context:** The new schema was already applied in the Supabase console on 2026-05-25. This task just updates the file on disk so it matches production.

- [ ] **Step 4.1: Replace `docs/supabase-setup.sql` with the new schema**

  Full contents of `docs/supabase-setup.sql`:
  ```sql
  create table public.plots (
    plot_idx   integer      primary key,
    cells      jsonb        not null default '[]',
    farmer_id  text         not null default '',
    farmer     text         not null default '',
    note       text         not null default '',
    photo_url  text,
    device_id  text         not null default '',
    updated_at timestamptz  not null default now()
  );

  alter table public.plots enable row level security;

  create policy "public_read_write" on public.plots
    for all
    using (true)
    with check (true);

  insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
  on conflict do nothing;

  create policy "public_photo_upload" on storage.objects
    for insert with check (bucket_id = 'photos');

  create policy "public_photo_read" on storage.objects
    for select using (bucket_id = 'photos');
  ```

  Note: The `drop table if exists` line used during the 2026-05-25 migration is intentionally omitted here — this file is the schema of record for fresh installs only. Running this on a non-empty database will error on primary-key conflicts; prepend `drop table if exists public.plots;` manually if you need a clean reset.

- [ ] **Step 4.2: Commit**

  ```powershell
  git add docs/supabase-setup.sql
  git commit -m "docs: update supabase schema for v3 cells/farmer_id model"
  ```

---

## Done

All four tasks complete. The app is running v3 with:
- New design (CSS, HTML shell, calendar picker, month scrubber, roster, farmer ID)
- Offline tile stack preserved (context + detail + ESRI hybrid)
- Supabase sync updated for `cells` jsonb + `farmer_id`
- Schema file matches production
