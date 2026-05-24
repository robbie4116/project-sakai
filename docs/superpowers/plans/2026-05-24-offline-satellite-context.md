# Offline Satellite Context Map Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a wider offline satellite-looking context map so users can zoom out below the current zoom 12 floor while preserving the high-detail Ambassador work area.

**Architecture:** Generate a second local raster tile pyramid from the full `benguet_satellite.tif` bounds into `tiles/context/` for low-zoom context. Render that context layer underneath the existing `tiles/map/` detail layer in Leaflet, expand map bounds to the context extent, and keep Ambassador plot overlays on top.

**Tech Stack:** Vanilla HTML/CSS/JS, Leaflet 1.9.4, Python 3, rasterio, Pillow, NumPy, Node built-in test runner, local static server for browser verification

---

## Chunk 1: Tests and Generator Refactor

### Task 1: Add failing tests for the two-layer map contract

**Files:**
- Modify: `tests/map-zoom-config.test.mjs`

- [ ] **Step 1: Extend the test helpers to read option and constant values**

Add these helpers after `readNumericOption()`:

```js
function readOptionValue(block, optionName) {
  const match = block.match(new RegExp(`${optionName}\\s*:\\s*([^,\\n}]+)`));
  return match ? match[1].trim() : null;
}

function readNumericConstant(source, constantName) {
  const match = source.match(new RegExp(`const\\s+${constantName}\\s*=\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

function resolveNumericValue(source, value) {
  if (/^\\d+$/.test(value)) return Number(value);
  return readNumericConstant(source, value);
}

function readBoundsConstant(source, constantName) {
  const match = source.match(new RegExp(`const\\s+${constantName}\\s*=\\s*L\\.latLngBounds\\s*\\(`));
  return Boolean(match);
}
```

- [ ] **Step 2: Replace the existing zoom-floor test with a two-layer zoom test**

Replace the test named `map can zoom out to the lowest committed native tile zoom` with:

```js
test('map zoom floor follows the offline context tile layer', async () => {
  const contextTilesDir = new URL('../tiles/context', import.meta.url);
  const contextZoomDirs = (await readdir(contextTilesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  const lowestContextZoom = Math.min(...contextZoomDirs);

  const initMapBlock = extractFunctionBlock('initMap');
  const contextLayerBlock = extractFunctionBlock('makeContextTileLayer');
  const detailLayerBlock = extractFunctionBlock('makeDetailTileLayer');

  assert.equal(resolveNumericValue(appSource, readOptionValue(initMapBlock, 'minZoom')), lowestContextZoom);
  assert.equal(resolveNumericValue(appSource, readOptionValue(contextLayerBlock, 'minNativeZoom')), lowestContextZoom);
  assert.equal(
    resolveNumericValue(appSource, readOptionValue(detailLayerBlock, 'minNativeZoom')),
    readNumericConstant(appSource, 'MAP_DETAIL_MIN_ZOOM'),
  );
  assert.match(contextLayerBlock, /tiles\\/context\\/\\{z\\}\\/\\{x\\}\\/\\{y\\}\\.jpg\\?v=/);
  assert.match(detailLayerBlock, /tiles\\/map\\/\\{z\\}\\/\\{x\\}\\/\\{y\\}\\.jpg\\?v=/);
});
```

- [ ] **Step 3: Add a test that verifies separate context and detail bounds**

Append:

```js
test('map uses separate context and detail bounds', () => {
  const initMapBlock = extractFunctionBlock('initMap');
  const contextLayerBlock = extractFunctionBlock('makeContextTileLayer');
  const detailLayerBlock = extractFunctionBlock('makeDetailTileLayer');

  assert.equal(readBoundsConstant(appSource, 'MAP_CONTEXT_BOUNDS'), true);
  assert.equal(readBoundsConstant(appSource, 'MAP_DETAIL_BOUNDS'), true);
  assert.match(initMapBlock, /maxBounds:\\s*MAP_CONTEXT_BOUNDS/);
  assert.match(contextLayerBlock, /bounds:\\s*MAP_CONTEXT_BOUNDS/);
  assert.match(detailLayerBlock, /bounds:\\s*MAP_DETAIL_BOUNDS/);
});
```

- [ ] **Step 4: Add a generator test for context tile outputs**

Append:

```js
test('tile generator defines separate context and detail map outputs', () => {
  assert.match(tileGeneratorSource, /DETAIL_MAP_OUT_DIR\\s*=\\s*Path\\("tiles\\/map"\\)/);
  assert.match(tileGeneratorSource, /CONTEXT_MAP_OUT_DIR\\s*=\\s*Path\\("tiles\\/context"\\)/);
  assert.match(tileGeneratorSource, /CONTEXT_SOURCE_TIF\\s*=\\s*"benguet_satellite\\.tif"/);
  assert.match(tileGeneratorSource, /generate_context_map_tiles/);
  assert.match(tileGeneratorSource, /generate_detail_map_tiles/);
});
```

- [ ] **Step 5: Run the tests and confirm they fail for the expected reason**

Run:

```bash
node --test tests/map-zoom-config.test.mjs
```

Expected: FAIL because `tiles/context/`, `makeContextTileLayer()`, `makeDetailTileLayer()`, and the new generator constants do not exist yet.

- [ ] **Step 6: Commit the failing tests**

```bash
git add tests/map-zoom-config.test.mjs
git commit -m "test: describe offline context map layers"
```

---

### Task 2: Refactor `generate_tiles.py` for detail and context layers

**Files:**
- Modify: `generate_tiles.py`
- Create: `tiles/context/empty.jpg` when the generator runs

- [ ] **Step 1: Rename and add generator configuration constants**

Replace the current map config block:

```python
SOURCE_TIF = "tublay_satellite.tif"
PLOT_OUT_DIR = Path("tiles/plots")
MAP_OUT_DIR = Path("tiles/map")
PLOT_SIZE = 512
MAP_TILE_PX = 256
JPEG_QUALITY = 85
TILE_QUALITY = 80
MIN_ZOOM = 12
MAX_ZOOM = 16
OUTSIDE_TILE_FILL = (14, 26, 14)
```

with:

```python
DETAIL_SOURCE_TIF = "tublay_satellite.tif"
CONTEXT_SOURCE_TIF = "benguet_satellite.tif"
PLOT_OUT_DIR = Path("tiles/plots")
DETAIL_MAP_OUT_DIR = Path("tiles/map")
CONTEXT_MAP_OUT_DIR = Path("tiles/context")
PLOT_SIZE = 512
MAP_TILE_PX = 256
JPEG_QUALITY = 85
DETAIL_TILE_QUALITY = 80
CONTEXT_TILE_QUALITY = 74
DETAIL_MIN_ZOOM = 12
DETAIL_MAX_ZOOM = 16
CONTEXT_MIN_ZOOM = 10
CONTEXT_MAX_ZOOM = 13
OUTSIDE_TILE_FILL = (14, 26, 14)
```

- [ ] **Step 2: Add context bounds constants below the existing detail tile bounds**

Add:

```python
# Wider satellite-looking context bounds from benguet_satellite.tif.
# At zooms 10-13 this is about 346 tiles, which is practical for an
# offline static bundle while giving field users meaningful orientation.
CONTEXT_BBOX_N = 16.93070509876553
CONTEXT_BBOX_S = 16.1724728083975
CONTEXT_BBOX_E = 120.9375
CONTEXT_BBOX_W = 120.43212890625
```

These are the current bounds of `benguet_satellite.tif`, based on raster metadata already inspected in this repo.

- [ ] **Step 3: Make RGB band selection explicit**

Add near `arr_to_pil()`:

```python
RGB_BANDS = [1, 2, 3]
```

In `read_xyz_tile()`, replace:

```python
arr = src.read(
    [1, 2, 3],
```

with:

```python
arr = src.read(
    RGB_BANDS,
```

- [ ] **Step 4: Replace `generate_map_tiles()` with a reusable layer function**

Replace the current `generate_map_tiles(src)` function with:

```python
def generate_map_tiles(src, out_dir, min_zoom, max_zoom, bounds, quality, label):
    out_dir.mkdir(parents=True, exist_ok=True)

    empty = Image.new("RGB", (MAP_TILE_PX, MAP_TILE_PX), color=OUTSIDE_TILE_FILL)
    empty.save(out_dir / "empty.jpg", "JPEG", quality=60)

    lat_n, lat_s, lng_e, lng_w = bounds
    total = 0
    for zoom in range(min_zoom, max_zoom + 1):
        x0, y0 = deg2tile(lat_n, lng_w, zoom)
        x1, y1 = deg2tile(lat_s, lng_e, zoom)
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        count = (x1 - x0 + 1) * (y1 - y0 + 1)
        print(f"{label} zoom {zoom}: x {x0}-{x1}, y {y0}-{y1}  ({count} tiles)")
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                out_path = out_dir / str(zoom) / str(tx) / f"{ty}.jpg"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                tile_lat_n, tile_lat_s, tile_lng_w, tile_lng_e = tile_bounds(tx, ty, zoom)
                arr = read_xyz_tile(src, tile_lat_n, tile_lat_s, tile_lng_w, tile_lng_e)
                img = arr_to_pil(arr)
                img.save(out_path, "JPEG", quality=quality)
                total += 1
    print(f"Done: {total} {label} tiles -> {out_dir}/")


def generate_detail_map_tiles(src):
    generate_map_tiles(
        src,
        DETAIL_MAP_OUT_DIR,
        DETAIL_MIN_ZOOM,
        DETAIL_MAX_ZOOM,
        (TILE_BBOX_N, TILE_BBOX_S, TILE_BBOX_E, TILE_BBOX_W),
        DETAIL_TILE_QUALITY,
        "detail",
    )


def generate_context_map_tiles(src):
    generate_map_tiles(
        src,
        CONTEXT_MAP_OUT_DIR,
        CONTEXT_MIN_ZOOM,
        CONTEXT_MAX_ZOOM,
        (CONTEXT_BBOX_N, CONTEXT_BBOX_S, CONTEXT_BBOX_E, CONTEXT_BBOX_W),
        CONTEXT_TILE_QUALITY,
        "context",
    )
```

- [ ] **Step 5: Update the script entry point to open both rasters**

Replace the current `if __name__ == "__main__":` block with:

```python
if __name__ == "__main__":
    print(f"Opening detail source {DETAIL_SOURCE_TIF}...")
    with rasterio.open(DETAIL_SOURCE_TIF) as detail_src:
        print(f"  {detail_src.width}x{detail_src.height} px, {detail_src.count} bands, CRS={detail_src.crs}")
        print("\n-- Generating plot crops --")
        generate_plot_crops(detail_src)
        print("\n-- Generating detail map tiles --")
        generate_detail_map_tiles(detail_src)

    print(f"\nOpening context source {CONTEXT_SOURCE_TIF}...")
    with rasterio.open(CONTEXT_SOURCE_TIF) as context_src:
        print(f"  {context_src.width}x{context_src.height} px, {context_src.count} bands, CRS={context_src.crs}")
        print("\n-- Generating context map tiles --")
        generate_context_map_tiles(context_src)

    print("\nAll done. Commit the tiles/ directory.")
```

- [ ] **Step 6: Run the focused tests**

Run:

```bash
node --test tests/map-zoom-config.test.mjs
```

Expected: still FAIL because `app.js` has not been updated and `tiles/context/` may not exist yet, but the generator-specific assertions should now pass.

- [ ] **Step 7: Generate the context tiles**

Run:

```bash
python generate_tiles.py
```

Expected:

- Existing `tiles/plots/` are regenerated.
- Existing `tiles/map/` detail tiles are regenerated.
- New `tiles/context/` tiles are created at zooms 10 through 13.

- [ ] **Step 8: Inspect output size**

Run:

```bash
powershell -NoProfile -Command "Get-ChildItem -Recurse -File tiles\\context | Measure-Object Length -Sum"
```

Expected: output size is practical for static deployment. If unexpectedly large, reduce `CONTEXT_MAX_ZOOM` to 12 or lower `CONTEXT_TILE_QUALITY`, then regenerate.

- [ ] **Step 9: Commit the generator and generated context tiles**

```bash
git add generate_tiles.py tiles/context tiles/map tiles/plots
git commit -m "feat: generate offline satellite context tiles"
```

---

## Chunk 2: Leaflet Layer Integration

### Task 3: Update `app.js` to render context and detail tile layers

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace the single tile layer reference**

Replace:

```js
let tileLayerRef = null;
```

with:

```js
let contextTileLayerRef = null;
let detailTileLayerRef = null;
```

- [ ] **Step 2: Replace the map tile constants and layer factory**

Replace the current `MAP_TILE_VERSION`, `MAP_TILE_BOUNDS`, and `makeTileLayer()` block with:

```js
const MAP_TILE_VERSION = '20260524-context';
const MAP_CONTEXT_MIN_ZOOM = 10;
const MAP_CONTEXT_MAX_ZOOM = 13;
const MAP_DETAIL_MIN_ZOOM = 12;
const MAP_DETAIL_MAX_ZOOM = 16;
const MAP_APP_MIN_ZOOM = MAP_CONTEXT_MIN_ZOOM;
const MAP_APP_MAX_ZOOM = MAP_DETAIL_MAX_ZOOM;
const MAP_CONTEXT_BOUNDS = L.latLngBounds(
  [16.1724728083975, 120.43212890625],
  [16.93070509876553, 120.9375]
);
const MAP_DETAIL_BOUNDS = L.latLngBounds(
  [16.45459, 120.617322],
  [16.50233, 120.663228]
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
    attribution: 'Offline satellite context',
  });
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
    attribution: 'Offline Ambassador detail imagery',
  });
}
```

- [ ] **Step 3: Update theme refresh logic**

Find the theme application block that removes `tileLayerRef`. Replace:

```js
if (map && tileLayerRef) {
  map.removeLayer(tileLayerRef);
  tileLayerRef = makeTileLayer().addTo(map);
}
```

with:

```js
if (map && contextTileLayerRef && detailTileLayerRef) {
  map.removeLayer(detailTileLayerRef);
  map.removeLayer(contextTileLayerRef);
  contextTileLayerRef = makeContextTileLayer().addTo(map);
  detailTileLayerRef = makeDetailTileLayer().addTo(map);
}
```

- [ ] **Step 4: Update map initialization options**

Inside `initMap()`, replace:

```js
minZoom: 12,
maxZoom: 16,
maxBounds: MAP_TILE_BOUNDS,
```

with:

```js
minZoom: MAP_APP_MIN_ZOOM,
maxZoom: MAP_APP_MAX_ZOOM,
maxBounds: MAP_CONTEXT_BOUNDS,
```

- [ ] **Step 5: Add the two layers in the correct order**

Replace:

```js
tileLayerRef = makeTileLayer().addTo(map);
```

with:

```js
contextTileLayerRef = makeContextTileLayer().addTo(map);
detailTileLayerRef = makeDetailTileLayer().addTo(map);
```

- [ ] **Step 6: Run the focused tests**

Run:

```bash
node --test tests/map-zoom-config.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the app integration**

```bash
git add app.js tests/map-zoom-config.test.mjs
git commit -m "feat: add offline satellite context layer"
```

---

## Chunk 3: Documentation and Browser Verification

### Task 4: Document the two-tier tile pipeline

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the tile generation setup section**

Replace:

```markdown
Requires `tublay_satellite.tif` in the project root (not committed - ask a team member).
```

with:

```markdown
Requires these source rasters in the project root (not committed - ask a team member):

- `tublay_satellite.tif` - high-detail plot crops and Ambassador/Tublay detail map tiles
- `benguet_satellite.tif` - wider low-zoom satellite context map tiles
```

- [ ] **Step 2: Add a tile outputs note after the setup command**

Add:

```markdown
Tile outputs:

- `tiles/plots/` - plot crop JPEGs used by the labeling canvas
- `tiles/map/` - high-detail offline map tiles for the Ambassador work area
- `tiles/context/` - wider low-zoom offline satellite context tiles for zoomed-out orientation
```

- [ ] **Step 3: Commit documentation**

```bash
git add README.md
git commit -m "docs: document offline context tiles"
```

---

### Task 5: Verify locally in browser

**Files:**
- No source changes expected unless verification finds defects.

- [ ] **Step 1: Start a local static server**

Run:

```bash
python -m http.server 8080
```

Expected: server starts on `http://localhost:8080/`.

- [ ] **Step 2: Open the app**

Open:

```text
http://localhost:8080/taniman.html
```

Expected: the map initially frames Ambassador, and plot polygons are visible.

- [ ] **Step 3: Verify zoom-out behavior**

Use the in-app zoom-out control until it stops.

Expected:

- The map reaches zoom 10.
- The surrounding area remains satellite-looking.
- The Ambassador detail area remains visible and sharper when zoomed back in.
- No broken image icons appear.

- [ ] **Step 4: Verify panning outside the detail bounds**

Pan outside the current Ambassador/Tublay detail extent but stay inside the broader context bounds.

Expected: satellite-looking context remains visible for orientation.

- [ ] **Step 5: Verify offline behavior**

With the local server still running, disable the network adapter or use browser devtools offline mode and reload.

Expected:

- Local JS/CSS/fonts still load.
- `tiles/context/` and `tiles/map/` load from the local server.
- The app does not require online map tile requests.

- [ ] **Step 6: Run automated tests again**

Run:

```bash
node --test tests/map-zoom-config.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Inspect Node processes before ending heavy tooling work**

Because this repo has an AGENTS.md process hygiene instruction, use the `process-hygiene` skill if Node/browser tooling was run. Be conservative: do not kill an intentionally running local server unless field testing is finished.

- [ ] **Step 8: Final commit for any verification fixes**

If verification required fixes:

```bash
git add app.js generate_tiles.py tests/map-zoom-config.test.mjs README.md tiles/context tiles/map tiles/plots
git commit -m "fix: polish offline context map behavior"
```

If no fixes were required, do not create an empty commit.

---

## Execution Notes

- Start with `CONTEXT_MIN_ZOOM = 10` and `CONTEXT_MAX_ZOOM = 13`.
- Use the full `benguet_satellite.tif` bounds for initial context bounds. At zooms 10-13 this is still a modest tile count and gives the strongest offline orientation.
- Reduce `CONTEXT_MAX_ZOOM` or JPEG quality first if generated context assets are too large.
- Keep all required map assets local. Online map layers may be added later as optional convenience only.
- Do not remove or rewrite unrelated untracked files in the repository.
