# Tublay Zone Extension Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Taniman's plotting coverage from Ambassador Area to the full Tublay municipality, with high-res offline satellite tiles for all of Tublay and internet-required ESRI fallback for areas outside Tublay.

**Architecture:** Three-zone point-in-polygon classification (`ambassador` / `tublay` / `outside`) using the existing `pointInPolygon` and `pointInRect` functions. Pre-generated 512×512 JPEG tiles from `tublay_satellite-highres.tif` for offline Tublay coverage. For outside-Tublay areas: connectivity-checked ESRI XYZ compositing in the canvas renderer. Two new Leaflet boundary layers on the map (Tublay bounding rect + municipality polygon outline).

**Tech Stack:** Vanilla JS, Leaflet.js, HTML5 Canvas API, Python 3 + rasterio + Pillow (tile generation), Tauri v2 (desktop build).

**Spec:** `docs/superpowers/specs/2026-06-02-tublay-zone-extension-design.md`

> **Line number note:** Line numbers in this plan reflect the codebase at the time of writing. If a change is not found at the stated line, search by the code content shown — the structure is stable even if lines shift.

---

## Chunk 1: Foundation

### Task 1: Gitignore and TUBLAY_POLY

**Files:**
- Modify: `.gitignore`
- Modify: `data.js` (new first line)

- [ ] **Step 1: Add high-res source TIF to .gitignore**

In `.gitignore`, add after `tublay_satellite.tif`:

```
tublay_satellite-highres.tif
```

- [ ] **Step 2: Extract Tublay polygon from GeoJSON**

From the project root, run:

```bash
python -c "
import json
d = json.load(open('boundaries/Benguet_Tublay_boundary.geojson'))
if d['type'] == 'FeatureCollection':
    coords = d['features'][0]['geometry']['coordinates'][0]
elif d['type'] == 'Feature':
    coords = d['geometry']['coordinates'][0]
else:
    coords = d['coordinates'][0]
pairs = [[round(c[1],7), round(c[0],7)] for c in coords]
print('window.TUBLAY_POLY = ' + json.dumps(pairs) + ';')
print('// ' + str(len(pairs)) + ' vertices')
"
```

Expected: output begins with `window.TUBLAY_POLY = [[16.` and ends with `// 282 vertices`. If vertex count differs, stop and check the GeoJSON structure.

- [ ] **Step 3: Add TUBLAY_POLY to data.js**

In `data.js`, insert the `window.TUBLAY_POLY = ...;` line as the **first line**, before `window.AMBASSADOR_POLY`:

```javascript
window.TUBLAY_POLY = [[...paste python output here...]];
window.AMBASSADOR_POLY = [[16.47974,120.62619],...]; // existing — do not change
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore data.js
git commit -m "feat: add TUBLAY_POLY from Benguet boundary GeoJSON; gitignore high-res source TIF"
```

---

### Task 2: Update constants in app.js

**Files:**
- Modify: `app.js` lines 13-18 and after line 33

- [ ] **Step 1: Update TUBLAY_DETAIL_BOUNDS**

Replace lines 13-18 in `app.js`:

```javascript
// REPLACE THIS:
const TUBLAY_DETAIL_BOUNDS = {
  n: 16.562492508374877,
  s: 16.45452471866254,
  e: 120.706787109375,
  w: 120.58868408203125,
};

// WITH THIS (authoritative values from Benguet_Tublay_boundary.geojson):
const TUBLAY_DETAIL_BOUNDS = {
  n: 16.5514979,
  s: 16.4547903,
  e: 120.7004932,
  w: 120.5665814,
};
```

- [ ] **Step 2: Add TUBLAY_POLY, TUBLAY_BBOX, and ESRI_TILE_TEMPLATE constants**

After `const GEOMETRY_EPSILON = 1e-12;` (line 33), insert:

```javascript
const TUBLAY_POLY = window.TUBLAY_POLY;
const TUBLAY_BBOX = {
  latS: TUBLAY_DETAIL_BOUNDS.s,
  latN: TUBLAY_DETAIL_BOUNDS.n,
  lngW: TUBLAY_DETAIL_BOUNDS.w,
  lngE: TUBLAY_DETAIL_BOUNDS.e,
};
// ESRI uses {z}/{y}/{x} order (y before x) — different from local tiles {z}/{x}/{y}
const ESRI_TILE_TEMPLATE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
```

- [ ] **Step 3: Verify no syntax errors**

Start a local HTTP server from the project root:

```bash
python -m http.server 8080
```

Open `http://localhost:8080/taniman.html` in a browser. Open DevTools console. Confirm no errors appear on load. The app should behave exactly as before.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: update TUBLAY_DETAIL_BOUNDS to GeoJSON extents; add TUBLAY_BBOX, TUBLAY_POLY, ESRI_TILE_TEMPLATE constants"
```

---

## Chunk 2: Naming Refactor

### Task 3: Rename outside_tublay identifiers

**Files:**
- Modify: `app.js` — rename throughout the file

The existing `outside_tublay` / `OUTSIDE_PLOTS` / `isOutsidePlot` naming predates the three-zone model and now conflicts with the new `outside` zone (outside Tublay entirely). Rename to `tublay` / `TUBLAY_PLOTS` / `isTublayPlot`.

- [ ] **Step 1: Rename area tag in buildOutsidePlots**

Find this line in `buildOutsidePlots` (around line 134):

```javascript
area: 'outside_tublay',
```

Change to:

```javascript
area: 'tublay',
```

- [ ] **Step 2: Rename OUTSIDE_PLOTS to TUBLAY_PLOTS**

Find (around line 143):

```javascript
const OUTSIDE_PLOTS = buildOutsidePlots();
const PLOTS = AMBASSADOR_PLOTS
  .map(plot => ({
    ...plot,
    area: 'ambassador',
    source: 'field_grid',
    tilePath: `tiles/plots/plot_${String(plot.idx).padStart(3, '0')}.jpg`,
  }))
  .concat(OUTSIDE_PLOTS);
```

Change to:

```javascript
const TUBLAY_PLOTS = buildOutsidePlots();
const PLOTS = AMBASSADOR_PLOTS
  .map(plot => ({
    ...plot,
    area: 'ambassador',
    source: 'field_grid',
    tilePath: `tiles/plots/plot_${String(plot.idx).padStart(3, '0')}.jpg`,
  }))
  .concat(TUBLAY_PLOTS);
```

- [ ] **Step 3: Rename isOutsidePlot to isTublayPlot**

Find (around line 279):

```javascript
function isOutsidePlot(plotOrIdx) {
  const idx = typeof plotOrIdx === 'number' ? plotOrIdx : plotOrIdx && plotOrIdx.idx;
  return Number.isInteger(idx) && idx >= CORE_PLOT_COUNT;
}
```

Change to:

```javascript
function isTublayPlot(plotOrIdx) {
  const idx = typeof plotOrIdx === 'number' ? plotOrIdx : plotOrIdx && plotOrIdx.idx;
  return Number.isInteger(idx) && idx >= CORE_PLOT_COUNT;
}
```

- [ ] **Step 4: Update all remaining references**

Do a find-and-replace across `app.js` for any remaining uses of `isOutsidePlot`:

```bash
grep -n "isOutsidePlot" app.js
```

Rename every hit to `isTublayPlot`. Common call sites include `isPlotEnabled`, `plotStyle`, `plotDisplayLabel`, and `drawPlotsOnMap`.

Also rename the `area: 'outside_tublay'` occurrence inside `normalizeCustomOutsidePlot` (around line 437). This function deserializes persisted custom plot state — if left unrenamed, restored custom outside plots will have the old tag while newly created ones have the new tag, causing silent failures in zone-based canvas logic. Verify with:

```bash
grep -n "outside_tublay" app.js
```

Expected: no output.

Then verify nothing is left overall:

```bash
grep -n "isOutsidePlot\|outside_tublay\|OUTSIDE_PLOTS" app.js
```

Expected: no output. If any remain, rename them.

- [ ] **Step 5: Verify app still works**

Reload `http://localhost:8080/taniman.html`. Check console for errors. Select a few Ambassador plots and Tublay outside plots — both should open normally with canvas backgrounds.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "refactor: rename OUTSIDE_PLOTS→TUBLAY_PLOTS, isOutsidePlot→isTublayPlot, area tag outside_tublay→tublay"
```

---

## Chunk 3: Zone System + Map Layers

### Task 4: Add classifyZone function

**Files:**
- Modify: `app.js` — insert after `pointInRect` (around line 48)

- [ ] **Step 1: Add classifyZone after pointInRect**

Find the `pointInRect` function (lines 46-48):

```javascript
function pointInRect(lat, lng, rect) {
  return lat >= rect.latS && lat <= rect.latN && lng >= rect.lngW && lng <= rect.lngE;
}
```

Insert immediately after it:

```javascript
function classifyZone(lat, lng) {
  if (pointInRect(lat, lng, AMBASSADOR_GRID_BOUNDS)) return 'ambassador';
  if (!pointInRect(lat, lng, TUBLAY_BBOX)) return 'outside';
  if (pointInPolygon(lat, lng, TUBLAY_POLY)) return 'tublay';
  return 'outside';
}
```

The bbox pre-filter (`!pointInRect(..., TUBLAY_BBOX)`) short-circuits before the 282-vertex polygon check when the point is clearly outside Tublay — keeps map clicks snappy.

Note on `AMBASSADOR_GRID_BOUNDS`: this is the tight AABB computed directly from the 64 Ambassador plot edges (no padding), so every point inside it lands in a real plot cell — there are no dead zones that would cause a Tublay-area point to be misclassified as `ambassador`.

- [ ] **Step 2: Verify in browser console**

Open DevTools console on the running app and test:

```javascript
classifyZone(16.478, 120.640)   // inside Ambassador grid → should log 'ambassador'
classifyZone(16.53, 120.65)     // inside Tublay, north of Ambassador → should log 'tublay'
classifyZone(16.60, 120.70)     // north of Tublay → should log 'outside'
classifyZone(16.46, 120.56)     // west of Tublay → should log 'outside'
```

All four should return the expected zone string.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add classifyZone(lat, lng) with ambassador/tublay/outside three-zone classification"
```

---

### Task 5: Add Tublay boundary layers to map

**Files:**
- Modify: `app.js` — within `initMap()` (around lines 944-949)

- [ ] **Step 1: Add Tublay rectangle and polygon layers in initMap**

Find this block inside `initMap()` (around line 944):

```javascript
L.polygon(POLY, {
  color:'#F2C84B', weight:2.5, dashArray:'7,5',
  fillColor:'#F2C84B', fillOpacity:0.04, interactive:false
}).addTo(map);
```

Insert the two new layers **before** that line:

```javascript
// Tublay outer bounding rectangle — thin white border, no fill
L.rectangle(
  [[TUBLAY_DETAIL_BOUNDS.s, TUBLAY_DETAIL_BOUNDS.w],
   [TUBLAY_DETAIL_BOUNDS.n, TUBLAY_DETAIL_BOUNDS.e]],
  { color: '#FFFFFF', weight: 1.5, fill: false, interactive: false }
).addTo(map);

// Tublay municipality polygon — dashed light-blue, no fill
L.polygon(TUBLAY_POLY, {
  color: '#64B5F6', weight: 2, dashArray: '6,4',
  fill: false, interactive: false
}).addTo(map);

// Ambassador polygon — unchanged, renders on top of Tublay layers
L.polygon(POLY, {
  color:'#F2C84B', weight:2.5, dashArray:'7,5',
  fillColor:'#F2C84B', fillOpacity:0.04, interactive:false
}).addTo(map);
```

Remove the original `L.polygon(POLY, ...)` block that was there — it is now included above in the correct draw order.

- [ ] **Step 2: Update initial map fit to show all of Tublay**

Find (around line 949):

```javascript
map.fitBounds(L.polygon(POLY).getBounds().pad(0.10));
```

Replace with:

```javascript
map.fitBounds([
  [TUBLAY_DETAIL_BOUNDS.s, TUBLAY_DETAIL_BOUNDS.w],
  [TUBLAY_DETAIL_BOUNDS.n, TUBLAY_DETAIL_BOUNDS.e]
]);
```

- [ ] **Step 3: Verify in browser**

Reload the app. The map should show:
- A thin **white rectangle** enclosing all of Tublay (outermost boundary)
- A dashed **light-blue irregular polygon** following the municipality boundary
- The existing dashed **yellow polygon** for Ambassador inside both

All three are outlines only — no fill — satellite imagery is visible underneath. Map fits to full Tublay on load rather than zooming to just Ambassador.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: add Tublay bounding rectangle and polygon outline to map; fit initial view to Tublay"
```

---

## Chunk 4: Canvas + Connectivity

### Task 6: Refactor getMapTileImage and drawMapTileBackground

**Files:**
- Modify: `app.js` lines 1105-1170

- [ ] **Step 1: Replace getMapTileImage with urlTemplate-aware version**

Find and replace the entire `getMapTileImage` function (around lines 1105-1118):

```javascript
// REPLACE THIS:
function getMapTileImage(z, x, y, idx) {
  const key = `${z}/${x}/${y}`;
  if (!mapTileCache[key]) {
    const img = new Image();
    img.onload = () => {
      if (idx === state.plotIdx) renderCanvas();
    };
    img.onerror = () => {
      img.failed = true;
    };
    img.src = `tiles/map/${z}/${x}/${y}.jpg?v=${MAP_TILE_VERSION}`;
    mapTileCache[key] = img;
  }
  return mapTileCache[key];
}

// WITH THIS:
function getMapTileImage(z, x, y, idx, urlTemplate = 'tiles/map/{z}/{x}/{y}.jpg') {
  const key = `${urlTemplate}:${z}/${x}/${y}`;
  if (!mapTileCache[key]) {
    const img = new Image();
    img.onload = () => {
      if (idx === state.plotIdx) renderCanvas();
    };
    img.onerror = () => {
      img.failed = true;
    };
    const url = urlTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const isExternal = urlTemplate.startsWith('http');
    img.src = isExternal ? url : `${url}?v=${MAP_TILE_VERSION}`;
    mapTileCache[key] = img;
  }
  return mapTileCache[key];
}
```

Key changes: cache key now includes the template (prevents cache collisions between local and ESRI tiles); URL is built by template substitution; external URLs skip the cache-busting version parameter.

- [ ] **Step 2: Update drawMapTileBackground signature and internal call**

Find the `drawMapTileBackground` function signature (around line 1120):

```javascript
function drawMapTileBackground(plot, w, h) {
```

Change to:

```javascript
function drawMapTileBackground(plot, w, h, urlTemplate = 'tiles/map/{z}/{x}/{y}.jpg') {
```

Then find the `getMapTileImage` call inside it (around line 1137):

```javascript
const img = getMapTileImage(zoom, tx, ty, plot.idx);
```

Change to:

```javascript
const img = getMapTileImage(zoom, tx, ty, plot.idx, urlTemplate);
```

These are the only two lines that change inside `drawMapTileBackground`. Everything else stays identical.

- [ ] **Step 3: Verify canvas still works for ambassador and tublay plots**

Reload the app. Select an Ambassador plot (01-64) — canvas background should load the pre-cut satellite JPEG as before. Select a Tublay outside plot (O01, O02, etc.) — canvas should also work. No console errors.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "refactor: add urlTemplate parameter to getMapTileImage and drawMapTileBackground for ESRI canvas support"
```

---

### Task 7: Outside zone — connectivity check and offline message

**Files:**
- Modify: `app.js` — add `checkConnectivity`, update `handleOutsideMapClick`, update `renderCanvas`
- Modify: `taniman.html` — add offline message element

- [ ] **Step 1: Add checkConnectivity function**

After the `ESRI_TILE_TEMPLATE` constant (added in Task 2), insert:

```javascript
async function checkConnectivity(timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    // Probe a known ESRI tile. mode:'no-cors' means we can't read the response,
    // but a resolved promise (vs. AbortError) confirms the network is reachable.
    await fetch(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/7/57/119',
      { signal: controller.signal, mode: 'no-cors' }
    );
    clearTimeout(id);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Add offline message element to taniman.html**

In `taniman.html`, check whether there is already a toast or notification element. If yes, use it. If not, add this element inside the `<body>`, near other overlay elements:

```html
<div id="outside-zone-msg" role="alert" style="
  display:none; position:fixed; bottom:1.5rem; left:50%; transform:translateX(-50%);
  background:rgba(0,0,0,0.82); color:#fff; padding:0.75rem 1.25rem;
  border-radius:8px; font-size:0.875rem; text-align:center;
  max-width:320px; z-index:9999; pointer-events:none;">
  This area is outside Tublay.<br>An internet connection is required to view satellite imagery here.
</div>
```

- [ ] **Step 3: Add showOutsideZoneMessage helper in app.js**

Near the other UI helper functions in `app.js`, add:

```javascript
function showOutsideZoneMessage() {
  const el = document.getElementById('outside-zone-msg');
  if (!el) return;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4500);
}
```

- [ ] **Step 4: Add forceCreate parameter to createOutsidePlotAt**

The existing `createOutsidePlotAt` (or `outsidePlotFromCenter`) calls `plotFitsDetailBounds`, which gates plot creation to `TUBLAY_DETAIL_BOUNDS`. Clicks outside Tublay fail this check and return `null` — even after a successful connectivity check. Fix this by adding an optional bypass:

Find `createOutsidePlotAt` (or whichever function calls `plotFitsDetailBounds`) and add an optional `forceCreate = false` parameter:

```javascript
// BEFORE:
function createOutsidePlotAt(lat, lng) {
  if (!plotFitsDetailBounds(lat, lng)) return null;
  // ... rest of construction
}

// AFTER:
function createOutsidePlotAt(lat, lng, forceCreate = false) {
  if (!forceCreate && !plotFitsDetailBounds(lat, lng)) return null;
  // ... rest unchanged
}
```

All existing call sites pass no third argument, so the default `false` preserves their behavior exactly.

- [ ] **Step 5: Update handleOutsideMapClick to check zone**

Find `handleOutsideMapClick` in `app.js`. Make it async and add zone-checking logic at the top:

```javascript
// Change the signature from:
function handleOutsideMapClick(e) {

// To:
async function handleOutsideMapClick(e) {
```

Then, at the very start of the function body (before any other logic), insert:

```javascript
if (!outsideAddMode) return;
const { lat, lng } = e.latlng;
const zone = classifyZone(lat, lng);

if (zone === 'outside') {
  const online = await checkConnectivity();
  if (!online) {
    showOutsideZoneMessage();
    return;
  }
  // Online + outside Tublay: create plot bypassing the detail-bounds gate.
  // renderCanvas will use ESRI tiles for this plot (zone === 'outside').
  const plot = createOutsidePlotAt(lat, lng, true /* forceCreate */);
  if (!plot) return;
  registerCustomOutsidePlot(plot);
  enableOutsidePlot(plot.idx);
  setOutsideAddMode(false);
  return;
}
// zone === 'ambassador' or 'tublay': existing creation path unchanged
```

If the existing function body already has `if (!outsideAddMode) return;` and an `outsidePlotFromCenter` call, replace those with the above block. Do not duplicate the outsideAddMode guard.

- [ ] **Step 6: Update renderCanvas to use ESRI for outside-zone plots**

Find `renderCanvas` in `app.js` (around line 1172). Near the top of the function, after the canvas dimensions are set and before the pre-cut tile is loaded, insert zone detection:

```javascript
const plot = PLOTS[state.plotIdx];
if (!plot) return;
const zone = classifyZone(plot.centerLat, plot.centerLng);
```

Then find where `renderCanvas` decides to load the pre-cut tile (look for `plot.tilePath` or the `tilePath` img load). The pattern is roughly:

```javascript
// existing: try pre-cut tile
const tile = /* load from plot.tilePath */;
if (tile && tile.complete) {
  ctx.drawImage(tile, 0, 0, w, h);
} else {
  drawMapTileBackground(plot, w, h);
}
```

Modify to branch on zone:

```javascript
if (zone === 'outside') {
  // No pre-cut tile for outside-Tublay plots; use ESRI compositing
  drawMapTileBackground(plot, w, h, ESRI_TILE_TEMPLATE);
} else {
  // ambassador and tublay: existing pre-cut tile loading logic unchanged
  const tile = /* load from plot.tilePath */;
  if (tile && tile.complete) {
    ctx.drawImage(tile, 0, 0, w, h);
  } else {
    drawMapTileBackground(plot, w, h);
  }
}
// The crop grid overlay (50×50 cells) continues normally after this block.
```

Read the actual `renderCanvas` code to find the exact tile-loading block and integrate accordingly.

- [ ] **Step 7: Verify outside zone flow**

Test in browser:
1. Enable outside add mode (click the "Outside farm" / add button)
2. Click a location clearly outside the white Tublay bounding rectangle
3. **With internet:** A brief pause (~1-3s for connectivity check), then the plot opens with ESRI satellite imagery composited as the canvas background. Note: if individual ESRI tiles return errors (404 or network hiccup), those tiles render as empty space — the canvas background will be partially or fully blank but the crop grid overlay still works. This is degraded but not crashing behavior.
4. **Simulate offline:** In DevTools → Network tab → set throttling to "Offline", then click outside Tublay again → the canvas does not open, and the toast message appears briefly at the bottom of the screen

- [ ] **Step 8: Commit**

```bash
git add app.js taniman.html
git commit -m "feat: outside-Tublay zone — connectivity check, ESRI canvas background, offline toast message"
```

---

---

## Chunk 5: Tile Generation

### Task 8: Update generate_tiles.py

**Files:**
- Modify: `generate_tiles.py` lines 5, 30, 47-50

- [ ] **Step 1: Update DETAIL_SOURCE_TIF**

Find line 30:

```python
DETAIL_SOURCE_TIF = "tublay_satellite.tif"
```

Change to:

```python
DETAIL_SOURCE_TIF = "tublay_satellite-highres.tif"
```

- [ ] **Step 2: Update TUBLAY_BBOX_* constants to GeoJSON values**

Find lines 47-50:

```python
TUBLAY_BBOX_N = 16.562492508374877
TUBLAY_BBOX_S = 16.45452471866254
TUBLAY_BBOX_E = 120.706787109375
TUBLAY_BBOX_W = 120.58868408203125
```

Replace with:

```python
# Authoritative bounds from Benguet_Tublay_boundary.geojson
TUBLAY_BBOX_N = 16.5514979
TUBLAY_BBOX_S = 16.4547903
TUBLAY_BBOX_E = 120.7004932
TUBLAY_BBOX_W = 120.5665814
```

`TILE_BBOX_*` variables (lines 57-60) alias `TUBLAY_BBOX_*` directly (`TILE_BBOX_N = TUBLAY_BBOX_N` etc.) so they update automatically — no separate change needed.

- [ ] **Step 3: Update the docstring**

At the top of the file (around line 5-6), update the source file description:

```python
# REPLACE:
#   tublay_satellite.tif   - Ambassador/Tublay detail imagery (high resolution)
# WITH:
#   tublay_satellite-highres.tif  - Full Tublay municipality detail imagery (high resolution, complete coverage)
```

- [ ] **Step 4: Commit before running**

```bash
git add generate_tiles.py
git commit -m "feat: update generate_tiles.py to use tublay_satellite-highres.tif and corrected GeoJSON extents"
```

---

### Task 9: Run tile generation and commit output

- [ ] **Step 1: Verify high-res TIF is present**

```bash
ls -lh tublay_satellite-highres.tif
```

Expected: file exists and is approximately 2.7 GB. If missing, source the file before proceeding — do not continue without it.

- [ ] **Step 2: Run tile generation**

From the project root (with the Python environment that has rasterio and Pillow installed):

```bash
python generate_tiles.py
```

This will take **10-40 minutes** depending on hardware. It regenerates all outside plot crops and map detail tiles. Watch for any error output — a rasterio CRS or bounds error means the TIF projection doesn't match. The script should print progress per zoom level and per plot batch.

- [ ] **Step 3: Verify output**

> **Windows note:** The commands below use Unix syntax. Run them in Git Bash or WSL, not PowerShell. PowerShell equivalents: `(Get-ChildItem tiles\plots\outside_*.jpg).Count` and `(Get-ChildItem -Recurse tiles\map -Filter *.jpg).Count`.

Check plot tile counts (Git Bash):

```bash
ls tiles/plots/outside_*.jpg | wc -l
```

Cross-check: open the browser console on the running app and check `TUBLAY_PLOTS.length`. The file count must equal `TUBLAY_PLOTS.length`. If they differ, the Python bounds and JS bounds are out of sync — recheck that both use the same `TUBLAY_BBOX_*` values.

Spot-check tile quality: open `tiles/plots/outside_000.jpg` and a few others in an image viewer. They should show high-resolution satellite imagery, not the older blurry/dark images or solid-color fills.

Also check map tile count grew (Git Bash):

```bash
ls tiles/map/ -R | grep "\.jpg" | wc -l
```

Count should be higher than before the run (more tiles covering the extended Tublay area).

- [ ] **Step 4: Test in browser end-to-end**

Reload `http://localhost:8080/taniman.html`. Verify:
- Map shows white rectangle + blue polygon + yellow Ambassador polygon
- Selecting a Tublay outside plot (O01, O02...) opens canvas with high-res satellite background
- Selecting an Ambassador plot (01-64) still works as before
- Clicking outside the white Tublay rectangle checks connectivity and either opens with ESRI or shows the offline toast

- [ ] **Step 5: Commit regenerated tiles**

```bash
git add tiles/plots/ tiles/map/
git commit -m "feat: regenerate outside-plot tiles and map detail tiles from tublay_satellite-highres.tif (full Tublay coverage)"
```

This commit will be large (tens of MB of JPEG files) — that is expected and correct. Tiles are committed to the repo for Vercel deployment.
