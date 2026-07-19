# Atok/Paoay Study Area Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Taniman from the Ambassador/Tublay study area to Paoay, Atok, Benguet, with Atok as the offline outer boundary and Paoay as the only plot-capable boundary.

**Architecture:** Replace the current Ambassador/Tublay geography model with explicit Atok/Paoay globals, regenerate plot metadata and imagery from boundary files, and keep Supabase on the existing schema after a clean remote reset. The app remains a static Leaflet app plus Tauri offline bundle; all Atok/Paoay map and plot assets must be local for offline use.

**Tech Stack:** Vanilla JavaScript, Leaflet, Python rasterio/Pillow/numpy tile generation, Node built-in test runner (`node --test`), Supabase REST/storage, Tauri static staging.

---

## Reference Documents

- Spec: `docs/superpowers/specs/2026-07-14-atok-paoay-study-area-design.md`
- Existing Atok boundary: `boundaries/Benguet_Atok_boundary.geojson`
- Primary Paoay candidate source: `https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2019/geojson/barangays/hires/barangays-municity-ph141101000.0.1.json`
- HDX fallback source: `https://data.humdata.org/dataset/cod-ab-phl`
- Canonical current Paoay PSGC: `1401101005`
- Primary source p-code for Paoay: `PH141101005`

## File Structure

- Create `scripts/extract_paoay_boundary.py` — downloads/extracts Paoay barangay geometry, validates it against Atok, writes `boundaries/Benguet_Atok_Paoay_boundary.geojson`.
- Create `scripts/verify_study_area_assets.mjs` — validates `data.js`, plot metadata, plot JPEG count, runtime plot count, and stale geography references.
- Create `tests/atok-paoay-study-area.test.mjs` — source and runtime checks for Atok/Paoay globals, classification, storage key, export metadata, and Add Plot removal.
- Modify `generate_tiles.py` — switch to `atok_satellite.tif`, read Atok/Paoay GeoJSON, generate Atok map tiles and Paoay plot crops, and update generated geography in `data.js`.
- Modify `data.js` — replace `window.TUBLAY_POLY`, `window.AMBASSADOR_POLY`, and `window.AMBASSADOR_PLOTS` with `window.ATOK_POLY`, `window.PAOAY_POLY`, and `window.PAOAY_PLOTS`; update copy strings to Paoay/Atok.
- Modify `app.js` — rename active geography constants, remove outside-plot behavior, classify `paoay`/`atok`/`outside`, use `taniman_v4_atok_paoay`, update map layers, export metadata, and sync behavior.
- Modify `taniman.html` — hide/remove the Add Plot control and stale outside-plot affordances.
- Modify `styles.css` — remove or neutralize styles only used by the hidden Add Plot control if needed.
- Modify `docs/supabase-setup.sql` — keep schema-compatible SQL and add clean-slate reset comments or a separate reset block.
- Modify `.gitignore` — add `atok_satellite.tif`.
- Modify `README.md` — update setup, raster, tile-generation, local development, offline notes, and survey-area language.
- Modify `src-tauri/scripts/prepare-dist.mjs` only if new files must be staged for the offline bundle.
- Modify or replace `tests/outside-plots.test.mjs` — the outside-plot subsystem is removed, so old outside-plot expectations must not remain.

## Chunk 1: Boundary Source and Data Gates

### Task 1: Add the Paoay boundary extraction script

**Files:**
- Create: `scripts/extract_paoay_boundary.py`
- Create or modify: `boundaries/Benguet_Atok_Paoay_boundary.geojson`

- [ ] **Step 1: Write the extraction script**

Create `scripts/extract_paoay_boundary.py` with standard-library Python only. It must:

- download the Atok barangay source URL from `faeldon/philippines-json-maps`
- select the feature where `ADM3_EN == "ATOK"` and `ADM4_EN == "Paoay"`
- validate the candidate has `ADM4_PCODE == "PH141101005"`
- validate the parent municipality has `ADM3_PCODE == "PH141101000"` and `ADM3_EN == "ATOK"`
- add canonical PSA-style properties `psgc: "1401101005"` and `parent_psgc: "1401101000"` to the output
- read `boundaries/Benguet_Atok_boundary.geojson`
- verify the Paoay bounding box sits inside the Atok bounding box
- verify every Paoay exterior-ring vertex is inside or on the existing Atok polygon
- write a one-feature FeatureCollection to `boundaries/Benguet_Atok_Paoay_boundary.geojson`
- include `source_url`, `source_dataset`, and `note` properties

Core script shape:

```python
from pathlib import Path
import json
import urllib.request

SOURCE_URL = "https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2019/geojson/barangays/hires/barangays-municity-ph141101000.0.1.json"
ATOK_PATH = Path("boundaries/Benguet_Atok_boundary.geojson")
OUT_PATH = Path("boundaries/Benguet_Atok_Paoay_boundary.geojson")

def bbox_for_feature(feature):
    coords = feature["geometry"]["coordinates"]
    points = []
    def walk(value):
        if isinstance(value, list) and len(value) == 2 and all(isinstance(n, (int, float)) for n in value):
            points.append(value)
        else:
            for item in value:
                walk(item)
    walk(coords)
    lngs = [p[0] for p in points]
    lats = [p[1] for p in points]
    return {"w": min(lngs), "e": max(lngs), "s": min(lats), "n": max(lats)}

def point_in_polygon(lat, lng, ring):
    inside = False
    j = len(ring) - 1
    for i, point in enumerate(ring):
        xi, yi = point
        xj, yj = ring[j]
        if point_on_segment(lng, lat, xi, yi, xj, yj):
            return True
        intersects = ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)
        if intersects:
            inside = not inside
        j = i
    return inside

def point_on_segment(px, py, ax, ay, bx, by, eps=1e-10):
    cross = (py - ay) * (bx - ax) - (px - ax) * (by - ay)
    if abs(cross) > eps:
        return False
    return min(ax, bx) - eps <= px <= max(ax, bx) + eps and min(ay, by) - eps <= py <= max(ay, by) + eps

def exterior_ring(feature):
    geometry = feature["geometry"]
    if geometry["type"] != "Polygon":
        raise SystemExit(f"Expected Polygon geometry, got {geometry['type']}")
    return geometry["coordinates"][0]

def main():
    with urllib.request.urlopen(SOURCE_URL, timeout=30) as response:
        source = json.loads(response.read().decode("utf-8"))
    matches = [
        f for f in source.get("features", [])
        if f.get("properties", {}).get("ADM3_EN", "").upper() == "ATOK"
        and f.get("properties", {}).get("ADM4_EN") == "Paoay"
    ]
    if len(matches) != 1:
        raise SystemExit(f"Expected exactly one Paoay feature, found {len(matches)}")
    feature = matches[0]
    if feature["properties"].get("ADM4_PCODE") != "PH141101005":
        raise SystemExit(f"Unexpected Paoay p-code: {feature['properties'].get('ADM4_PCODE')}")
    if feature["properties"].get("ADM3_PCODE") != "PH141101000":
        raise SystemExit(f"Unexpected Atok p-code: {feature['properties'].get('ADM3_PCODE')}")

    atok = json.loads(ATOK_PATH.read_text(encoding="utf-8"))
    if len(atok.get("features", [])) != 1:
        raise SystemExit("Expected existing Atok boundary file to contain exactly one feature")
    atok_ring = exterior_ring(atok["features"][0])
    paoay_ring = exterior_ring(feature)
    atok_bbox = bbox_for_feature(atok["features"][0])
    paoay_bbox = bbox_for_feature(feature)
    if not (atok_bbox["w"] <= paoay_bbox["w"] <= paoay_bbox["e"] <= atok_bbox["e"] and
            atok_bbox["s"] <= paoay_bbox["s"] <= paoay_bbox["n"] <= atok_bbox["n"]):
        raise SystemExit(f"Paoay bbox {paoay_bbox} is not inside Atok bbox {atok_bbox}")
    outside_vertices = [
        point for point in paoay_ring
        if not point_in_polygon(point[1], point[0], atok_ring)
    ]
    if outside_vertices:
        raise SystemExit(f"Paoay has {len(outside_vertices)} exterior vertices outside Atok")

    feature["properties"] = {
        **feature["properties"],
        "psgc": "1401101005",
        "parent_psgc": "1401101000",
        "source_url": SOURCE_URL,
        "source_dataset": "faeldon/philippines-json-maps 2019 barangay hires GeoJSON",
        "note": "Extracted for Taniman Atok/Paoay study-area migration.",
    }
    OUT_PATH.write_text(json.dumps({
        "type": "FeatureCollection",
        "name": "Benguet_Atok_Paoay_boundary",
        "features": [feature],
    }, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH}")
    print(f"Paoay bbox: {paoay_bbox}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the extractor**

Run:

```powershell
python scripts/extract_paoay_boundary.py
```

Expected:

- prints `Wrote boundaries\Benguet_Atok_Paoay_boundary.geojson`
- prints a Paoay bbox around latitude `16.596` to `16.641` and longitude `120.730` to `120.782`

- [ ] **Step 3: Inspect the generated boundary**

Run:

```powershell
python -m json.tool boundaries\Benguet_Atok_Paoay_boundary.geojson > $env:TEMP\paoay-boundary.json
```

Expected: exits `0`.

- [ ] **Step 4: Verify boundary properties and provenance**

Run:

```powershell
python -c "import json, pathlib; d=json.loads(pathlib.Path('boundaries/Benguet_Atok_Paoay_boundary.geojson').read_text()); p=d['features'][0]['properties']; assert d['type']=='FeatureCollection'; assert len(d['features'])==1; assert p['ADM4_EN']=='Paoay'; assert p['ADM3_EN']=='ATOK'; assert p['ADM4_PCODE']=='PH141101005'; assert p['ADM3_PCODE']=='PH141101000'; assert p['psgc']=='1401101005'; assert p['parent_psgc']=='1401101000'; assert p['source_url'].startswith('https://raw.githubusercontent.com/faeldon/'); print('paoay boundary verified')"
```

Expected: prints `paoay boundary verified`.

- [ ] **Step 5: Commit the boundary source task**

Run:

```powershell
git add scripts/extract_paoay_boundary.py boundaries/Benguet_Atok_Paoay_boundary.geojson
git commit -m "feat: add Paoay barangay boundary source"
```

### Task 2: Add geography tests before the app refactor

**Files:**
- Create: `tests/atok-paoay-study-area.test.mjs`

- [ ] **Step 1: Write failing tests for required geography and clean-slate behavior**

Create `tests/atok-paoay-study-area.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const dataSource = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');

function loadData() {
  const sandbox = { window: {} };
  vm.runInNewContext(dataSource, sandbox);
  return sandbox.window;
}

test('data exposes Atok and Paoay study-area globals', () => {
  const data = loadData();
  assert.ok(Array.isArray(data.ATOK_POLY), 'ATOK_POLY should be an array');
  assert.ok(Array.isArray(data.PAOAY_POLY), 'PAOAY_POLY should be an array');
  assert.ok(Array.isArray(data.PAOAY_PLOTS), 'PAOAY_PLOTS should be an array');
  assert.ok(data.PAOAY_PLOTS.length > 0);
  assert.equal(data.PAOAY_PLOTS[0].area, 'paoay');
  assert.equal(data.PAOAY_PLOTS[0].source, 'field_grid');
  assert.match(data.PAOAY_PLOTS[0].tilePath, /^tiles\/plots\/plot_000\.jpg$/);
});

test('Paoay and Atok polygons have expected coordinate ranges', () => {
  const data = loadData();
  const bbox = (poly) => ({
    s: Math.min(...poly.map(([lat]) => lat)),
    n: Math.max(...poly.map(([lat]) => lat)),
    w: Math.min(...poly.map(([, lng]) => lng)),
    e: Math.max(...poly.map(([, lng]) => lng)),
  });
  const atok = bbox(data.ATOK_POLY);
  const paoay = bbox(data.PAOAY_POLY);
  assert.ok(atok.s <= paoay.s && paoay.n <= atok.n);
  assert.ok(atok.w <= paoay.w && paoay.e <= atok.e);
  assert.ok(paoay.s > 16.59 && paoay.n < 16.65);
  assert.ok(paoay.w > 120.72 && paoay.e < 120.79);
});

test('app uses the Atok/Paoay storage namespace and zone names', () => {
  assert.match(appSource, /const\s+STORAGE_KEY\s*=\s*'taniman_v4_atok_paoay'/);
  assert.doesNotMatch(appSource, /localStorage\.getItem\('taniman_v3'\)|STORAGE_KEY\s*=\s*'taniman_v3'/);
  assert.match(appSource, /function\s+classifyZone\s*\(\s*lat,\s*lng\s*\)/);
  assert.match(appSource, /return\s+'paoay'/);
  assert.match(appSource, /return\s+'atok'/);
  assert.match(appSource, /return\s+'outside'/);
});

test('classifyZone returns paoay, atok, and outside for known coordinates', () => {
  const end = appSource.indexOf('// ── STATE');
  assert.notEqual(end, -1, 'classifyZone must appear before state setup');
  const sandbox = { window: loadData() };
  vm.runInNewContext(`${appSource.slice(0, end)}
globalThis.__zones = [
  classifyZone(16.624, 120.755),
  classifyZone(16.570, 120.690),
  classifyZone(16.700, 120.900),
];`, sandbox);
  assert.deepEqual(sandbox.__zones, ['paoay', 'atok', 'outside']);
});

test('active app no longer references Ambassador/Tublay plot models', () => {
  assert.doesNotMatch(appSource, /AMBASSADOR_PLOTS|AMBASSADOR_GRID_BOUNDS|TUBLAY_PLOTS|isTublayPlot|buildOutsidePlots/);
  assert.doesNotMatch(dataSource, /window\.AMBASSADOR_POLY|window\.AMBASSADOR_PLOTS|window\.TUBLAY_POLY/);
});

test('Add Plot control is not active in the Paoay-only workflow', () => {
  assert.doesNotMatch(htmlSource, /id="add-outside-btn"/);
  assert.doesNotMatch(appSource, /handleOutsideMapClick|createOutsidePlotAt|registerCustomOutsidePlot|enabledOutsidePlots/);
  assert.doesNotMatch(appSource, /document\.getElementById\('add-outside-btn'\)/);
  assert.doesNotMatch(appSource, /document\.getElementById\('btn-remove-outside'\)/);
  assert.doesNotMatch(appSource, /setOutsideAddMode|removeOutsidePlot/);
});

test('old taniman_v3 data cannot hydrate active Atok/Paoay state', () => {
  assert.match(appSource, /const\s+STORAGE_KEY\s*=\s*'taniman_v4_atok_paoay'/);
  assert.doesNotMatch(appSource, /taniman_v3/);
});

test('exports and UI copy use Paoay, Atok, Benguet', () => {
  assert.match(appSource, /survey_area:\s*'Paoay, Atok, Benguet'/);
  assert.match(dataSource, /mapTitle:\s*'Paoay'/);
  assert.doesNotMatch(dataSource, /Ambassador|Tublay/);
  const exportStart = appSource.indexOf('async function exportAll');
  assert.notEqual(exportStart, -1, 'exportAll should exist');
  const exportBlock = appSource.slice(exportStart, appSource.indexOf('// ── BOOT', exportStart));
  assert.match(exportBlock, /plotArea[^\\n]+paoay|plot_area,plot_source/);
  assert.doesNotMatch(exportBlock, /ambassador|tublay|outside_tublay|outside_custom/i);
});

test('generated plot crop files match PAOAY_PLOTS entries', async () => {
  const data = loadData();
  const files = await readdir(new URL('../tiles/plots', import.meta.url));
  const plotJpegs = files.filter(name => /^plot_\d{3}\.jpg$/.test(name));
  assert.equal(plotJpegs.length, data.PAOAY_PLOTS.length);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
node --test tests/atok-paoay-study-area.test.mjs
```

Expected: fails on missing `ATOK_POLY`, `PAOAY_POLY`, `PAOAY_PLOTS`, old storage key, and old outside-plot model.

- [ ] **Step 3: Commit the failing test**

Run:

```powershell
git add tests/atok-paoay-study-area.test.mjs
git commit -m "test: define Atok Paoay study area expectations"
```

## Chunk 2: Tile Generator and Generated Geography

### Task 3: Refactor `generate_tiles.py` for Atok/Paoay

**Files:**
- Modify: `generate_tiles.py`
- Modify: `.gitignore`
- Modify: `data.js`
- Modify generated assets under `tiles/plots/` and `tiles/map/`

- [ ] **Step 1: Add the Atok raster to `.gitignore`**

Add:

```gitignore
atok_satellite.tif
```

- [ ] **Step 2: Update generator constants**

In `generate_tiles.py`, replace Tublay/Ambassador constants with:

```python
DETAIL_SOURCE_TIF = "atok_satellite.tif"
CONTEXT_SOURCE_TIF = "benguet_satellite.tif"
ATOK_BOUNDARY_PATH = Path("boundaries/Benguet_Atok_boundary.geojson")
PAOAY_BOUNDARY_PATH = Path("boundaries/Benguet_Atok_Paoay_boundary.geojson")
PLOT_SIZE = 512
MAP_TILE_PX = 256
DETAIL_MIN_ZOOM = 12
DETAIL_MAX_ZOOM = 17
CONTEXT_MIN_ZOOM = 10
CONTEXT_MAX_ZOOM = 13
```

Remove active `AMBASSADOR_POLY`, `BBOX_*`, `TUBLAY_BBOX_*`, and `OUTSIDE_PLOT_PREFIX` usage.

- [ ] **Step 3: Add GeoJSON helpers to the generator**

Add helpers that read FeatureCollection polygons, convert GeoJSON `[lng, lat]` rings to app `[lat, lng]` arrays, compute bounding boxes, and test plot/polygon overlap. Reuse the existing `plot_overlaps_polygon` logic where possible.

Required helper signatures:

```python
def load_feature(path: Path) -> dict:
    """Return the only Feature in a FeatureCollection, or raise SystemExit."""

def geometry_to_latlng_poly(feature: dict) -> list[list[float]]:
    """Return the Polygon exterior ring as [lat, lng] pairs, or raise SystemExit for MultiPolygon, holes-only, empty, or invalid geometry."""

def bbox_for_feature(feature: dict) -> dict[str, float]:
    """Return {"n", "s", "e", "w"} from every exterior coordinate in a Polygon feature."""

def build_paoay_plots(paoay_feature: dict) -> list[dict]:
    """Return contiguous Paoay plot metadata using the fixed plot-size rule below."""

def write_geography_to_data_js(atok_poly: list, paoay_poly: list, paoay_plots: list) -> None:
    """Replace the generated study-area block in data.js and preserve crops/translations below it."""
```

Edge-case behavior is explicit:

- `load_feature` fails unless the file is a FeatureCollection with exactly one Feature.
- `geometry_to_latlng_poly` accepts only `geometry.type == "Polygon"` for this migration. If a fallback source returns `MultiPolygon`, stop and ask for a spec revision rather than guessing how to flatten it.
- Interior rings/holes are ignored for display only if present, but the script must print a warning. Paoay and Atok are expected to have simple exterior rings.
- `bbox_for_feature` takes a Feature object, never a Path. Call it as `bbox_for_feature(load_feature(ATOK_BOUNDARY_PATH))`.

- [ ] **Step 4: Define the Paoay plot grid rule**

Implement `build_paoay_plots` so it:

- uses the Paoay bbox
- uses the exact old plot dimensions:
  - `PLOT_LAT_DEGREES = 0.0041364375`
  - `PLOT_LNG_DEGREES = 0.0040060625`
- includes a plot when its rectangle overlaps the Paoay polygon
- assigns contiguous `idx` values from `0`
- writes `area: "paoay"`, `source: "field_grid"`, `tilePath: "tiles/plots/plot_NNN.jpg"`

If the old plot size creates an unexpectedly large or tiny plot count, stop and report the count before committing generated assets.

- [ ] **Step 5: Update map tile generation bounds**

Use `bbox_for_feature(load_feature(ATOK_BOUNDARY_PATH))` for `tiles/map/` detail tile bounds. Keep context tile generation from `benguet_satellite.tif` unless the raster is missing; if context raster is missing, stop and report that the existing app requires context tiles.

- [ ] **Step 6: Update data.js geography safely**

Wrap the generated geography section in `data.js` with `BEGIN GENERATED STUDY AREA DATA` and `END GENERATED STUDY AREA DATA` comments. The block must contain exactly three generated assignment statements in this order: `window.ATOK_POLY`, `window.PAOAY_POLY`, then `window.PAOAY_PLOTS`.

Keep crop definitions and translations below the generated section.

- [ ] **Step 7: Run the generator gate**

Run:

```powershell
python generate_tiles.py
```

Expected if `atok_satellite.tif` is missing: a clear failure explaining that full Atok offline support requires `atok_satellite.tif`. Stop Chunk 2 here. Commit only code/test/doc changes from earlier tasks if useful; do not commit generated asset changes and do not claim the Atok/Paoay app is runnable offline.

Expected if raster is present:

- old `tiles/plots/plot_*.jpg` are replaced with Paoay crops
- old active `outside_*.jpg` references are not generated
- `tiles/map/` is regenerated for Atok bounds
- `data.js` contains `window.ATOK_POLY`, `window.PAOAY_POLY`, and `window.PAOAY_PLOTS`
- generator output prints Paoay plot count, Atok map tile count, context tile count, and fallback tile status

The generator must delete stale outputs before writing new outputs:

- remove old `tiles/plots/plot_*.jpg`
- remove old `tiles/map/**/*.jpg`
- preserve or recreate `tiles/plots/empty.jpg` if it exists
- preserve or recreate `tiles/map/empty.jpg`
- preserve or recreate `tiles/context/empty.jpg`

- [ ] **Step 8: Add a generated-asset verifier**

Create `scripts/verify_study_area_assets.mjs`:

```js
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import vm from 'node:vm';

const dataSource = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8').catch(() => '');
const sandbox = { window: {} };
vm.runInNewContext(dataSource, sandbox);
const { ATOK_POLY, PAOAY_POLY, PAOAY_PLOTS } = sandbox.window;

assert.ok(Array.isArray(ATOK_POLY) && ATOK_POLY.length > 0, 'ATOK_POLY missing');
assert.ok(Array.isArray(PAOAY_POLY) && PAOAY_POLY.length > 0, 'PAOAY_POLY missing');
assert.ok(Array.isArray(PAOAY_PLOTS) && PAOAY_PLOTS.length > 0, 'PAOAY_PLOTS missing');

for (const [idx, plot] of PAOAY_PLOTS.entries()) {
  assert.equal(plot.idx, idx, `plot idx mismatch at ${idx}`);
  assert.equal(plot.area, 'paoay', `plot ${idx} area`);
  assert.equal(plot.source, 'field_grid', `plot ${idx} source`);
  assert.equal(plot.tilePath, `tiles/plots/plot_${String(idx).padStart(3, '0')}.jpg`);
  for (const key of ['latS', 'latN', 'lngW', 'lngE', 'centerLat', 'centerLng', 'r', 'c']) {
    assert.equal(typeof plot[key], 'number', `plot ${idx} missing numeric ${key}`);
  }
}

const plotFiles = (await readdir(new URL('../tiles/plots', import.meta.url)))
  .filter(name => /^plot_\d{3}\.jpg$/.test(name))
  .sort();
assert.equal(plotFiles.length, PAOAY_PLOTS.length, 'plot JPEG count must match PAOAY_PLOTS');
for (let idx = 0; idx < PAOAY_PLOTS.length; idx += 1) {
  assert.equal(plotFiles[idx], `plot_${String(idx).padStart(3, '0')}.jpg`);
}

const generatedBlock = dataSource.match(/BEGIN GENERATED STUDY AREA DATA([\s\S]*?)END GENERATED STUDY AREA DATA/)?.[1]
  ?? dataSource.slice(0, dataSource.indexOf('window.CROPS'));
assert.doesNotMatch(generatedBlock, /ambassador|tublay|outside_tublay|outside_custom|outside_\\d{3}\\.jpg/i);
assert.doesNotMatch(JSON.stringify(PAOAY_PLOTS), /ambassador|tublay|outside_tublay|outside_custom|outside_\\d{3}\\.jpg/i);
let runtimeCount = 'not-refactored-yet';
if (appSource.includes('const PLOTS = PAOAY_PLOTS')) {
  const marker = appSource.indexOf('const MONTH_SHORT');
  assert.notEqual(marker, -1, 'expected app constants before MONTH_SHORT');
  const appSandbox = { window: sandbox.window, console };
  vm.runInNewContext(`${appSource.slice(0, marker)}
globalThis.__runtimeCounts = { plots: PLOTS.length, core: CORE_PLOT_COUNT };`, appSandbox);
  assert.equal(appSandbox.__runtimeCounts.plots, PAOAY_PLOTS.length, 'runtime PLOTS length must match PAOAY_PLOTS');
  assert.equal(appSandbox.__runtimeCounts.core, PAOAY_PLOTS.length, 'runtime CORE_PLOT_COUNT must match PAOAY_PLOTS');
  runtimeCount = appSandbox.__runtimeCounts.plots;
}

console.log(`study-area assets ok: plots=${PAOAY_PLOTS.length} files=${plotFiles.length} runtime=${runtimeCount}`);
```

- [ ] **Step 9: Run generated-data verification**

Run:

```powershell
node scripts/verify_study_area_assets.mjs
```

Expected before the app refactor: prints `study-area assets ok: plots=<N> files=<N> runtime=not-refactored-yet`.

Expected after the app refactor: prints `study-area assets ok: plots=<N> files=<N> runtime=<N>`.

- [ ] **Step 10: Commit generator and asset changes**

Run:

```powershell
git add .gitignore generate_tiles.py data.js scripts/verify_study_area_assets.mjs tiles/plots tiles/map
git commit -m "feat: generate Atok Paoay offline study area assets"
```

## Chunk 3: App Geography Refactor

### Task 4: Replace Ambassador/Tublay runtime constants with Atok/Paoay

**Files:**
- Modify: `app.js`
- Modify: `tests/map-zoom-config.test.mjs`
- Modify: `tests/outside-plots.test.mjs`

- [ ] **Step 1: Update top-level constants**

In `app.js`, replace active geography constants with:

```js
const STORAGE_KEY = 'taniman_v4_atok_paoay';
const ATOK_POLY = window.ATOK_POLY;
const PAOAY_POLY = window.PAOAY_POLY;
const PAOAY_PLOTS = window.PAOAY_PLOTS;
const PLOTS = PAOAY_PLOTS;
const CORE_PLOT_COUNT = PAOAY_PLOTS.length;
```

Remove active `AMBASSADOR_PLOTS`, `POLY`, `TUBLAY_POLY`, `TUBLAY_PLOTS`, and `buildOutsidePlots`.

- [ ] **Step 2: Implement Atok/Paoay bounds and classification**

Add:

```js
const PAOAY_GRID_BOUNDS = PAOAY_PLOTS.reduce((bounds, plot) => ({
  latS: Math.min(bounds.latS, plot.latS),
  latN: Math.max(bounds.latN, plot.latN),
  lngW: Math.min(bounds.lngW, plot.lngW),
  lngE: Math.max(bounds.lngE, plot.lngE),
}), { latS: Infinity, latN: -Infinity, lngW: Infinity, lngE: -Infinity });

const ATOK_DETAIL_BOUNDS = {
  n: Math.max(...ATOK_POLY.map(([lat]) => lat)),
  s: Math.min(...ATOK_POLY.map(([lat]) => lat)),
  e: Math.max(...ATOK_POLY.map(([, lng]) => lng)),
  w: Math.min(...ATOK_POLY.map(([, lng]) => lng)),
};

function classifyZone(lat, lng) {
  if (pointInPolygon(lat, lng, PAOAY_POLY)) return 'paoay';
  if (pointInPolygon(lat, lng, ATOK_POLY)) return 'atok';
  return 'outside';
}
```

- [ ] **Step 3: Remove outside-plot state and helpers**

Remove state fields and helpers dedicated to custom/outside plots. The expected outcome is that these identifiers no longer appear in `app.js`:

- `enabledOutsidePlots`
- `customOutsidePlots`
- `outsideAddMode`
- `buildOutsidePlots`
- `isTublayPlot`
- `visiblePlots` filtering for outside candidates
- `handleOutsideMapClick`
- `createOutsidePlotAt`
- `registerCustomOutsidePlot`
- `enableOutsidePlot`
- `removeOutsidePlot`

After this task, all active plot aggregation should iterate `PLOTS` directly.

- [ ] **Step 4: Update map bounds and overlays**

Use `ATOK_DETAIL_BOUNDS` for `MAP_DETAIL_BOUNDS`, detail tiles, initial `fitBounds`, and map outer boundary. Draw:

```js
L.polygon(ATOK_POLY, { color: '#FFFFFF', weight: 1.5, fill: false, interactive: false }).addTo(map);
L.polygon(PAOAY_POLY, { color: '#F2C84B', weight: 2.5, dashArray: '7,5', fillColor: '#F2C84B', fillOpacity: 0.04, interactive: false }).addTo(map);
```

- [ ] **Step 5: Update tests for the removed outside subsystem**

Replace `tests/outside-plots.test.mjs` with tests that assert:

- Add Plot is absent
- no runtime `outside_*.jpg` metadata references exist
- all visible/legend/roster aggregation uses `PLOTS`
- Paoay plots use direct plot labels, not outside labels

Run:

```powershell
node --test tests/outside-plots.test.mjs tests/atok-paoay-study-area.test.mjs tests/map-zoom-config.test.mjs
```

Expected after app refactor: pass.

- [ ] **Step 6: Commit runtime geography refactor**

Run:

```powershell
git add app.js tests/outside-plots.test.mjs tests/atok-paoay-study-area.test.mjs tests/map-zoom-config.test.mjs
git commit -m "feat: switch runtime geography to Atok Paoay"
```

### Task 5: Update UI strings, export metadata, and README

**Files:**
- Modify: `data.js`
- Modify: `app.js`
- Modify: `taniman.html`
- Modify: `styles.css`
- Modify: `README.md`
- Modify: `tests/translations.test.mjs`

- [ ] **Step 1: Update English/Tagalog/Ilocano string keys**

In `data.js`, set active strings to Paoay/Atok. If `STRINGS_LEGACY` remains in the file, replace its Ambassador/Tublay values too; the new app must not keep user-facing Ambassador/Tublay strings in `data.js`.

Required English values:

```js
mapTitle: 'Paoay',
outsideArea: 'Outside Paoay · Atok',
outsidePickHint: 'Plotting is limited to Paoay',
outsideAdded: 'Plot unavailable outside Paoay',
outsideRemoved: 'Plot removed',
removeOutsidePlot: 'Remove this plot',
outsidePlotN: 'Plot {n}',
```

If Add Plot is fully removed, keep legacy-compatible keys only so translation completeness tests pass; they must not appear in active UI.

- [ ] **Step 2: Remove Add Plot markup and JavaScript references**

In `taniman.html`, remove the button with `id="add-outside-btn"`. If `btn-remove-outside` exists only for outside plots, remove that button too.

In `app.js`, remove all JavaScript references to:

- `document.getElementById('add-outside-btn')`
- `document.getElementById('btn-remove-outside')`
- `setOutsideAddMode`
- `removeOutsidePlot`

Expected: removing the markup cannot cause runtime `null.onclick` errors because the corresponding JS is gone.

- [ ] **Step 3: Update export metadata**

In `app.js`, change:

```js
survey_area: 'Paoay, Atok, Benguet'
```

Ensure `plot_area` resolves to `paoay` for all fixed plots.

Also ensure no active export path emits:

- `ambassador`
- `tublay`
- `outside_tublay`
- `outside_custom`

- [ ] **Step 4: Update README**

Rewrite the opening and setup sections to say:

- field data collection app for Paoay, Atok, Benguet
- required raster: `atok_satellite.tif`
- generated plot crops are Paoay plots
- generated map tiles cover Atok
- Atok works offline after tile generation
- Paoay boundary is generated by `scripts/extract_paoay_boundary.py`

- [ ] **Step 5: Run copy/export tests**

Run:

```powershell
node --test tests/translations.test.mjs tests/atok-paoay-study-area.test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit copy and docs**

Run:

```powershell
git add data.js app.js taniman.html styles.css README.md tests/translations.test.mjs tests/atok-paoay-study-area.test.mjs
git commit -m "feat: update UI copy and exports for Paoay Atok"
```

## Chunk 4: Supabase Clean Slate

### Task 6: Reset Supabase safely for the new study area

**Files:**
- Modify: `docs/supabase-setup.sql`
- Create: `scripts/reset_supabase_clean_slate.mjs`

- [ ] **Step 1: Add clean-slate SQL to docs**

Append this section to `docs/supabase-setup.sql`:

```sql
-- Clean slate reset for Atok/Paoay migration.
-- Run before first Atok/Paoay sync if the old Ambassador/Tublay data exists.
delete from public.plots;

-- This may require project owner or service-role privileges.
delete from storage.objects
where bucket_id = 'photos';
```

- [ ] **Step 2: Create the reset script**

Create `scripts/reset_supabase_clean_slate.mjs`:

```js
import { readFile } from 'node:fs/promises';

const config = await readFile(new URL('../config.js', import.meta.url), 'utf8');
const url = config.match(/SUPABASE_URL\s*=\s*'([^']+)'/)?.[1];
const key = config.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)?.[1];

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in config.js');
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
};

async function request(path, options = {}) {
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function resetPlots() {
  await request('/rest/v1/plots?plot_idx=not.is.null', {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  const rows = await request('/rest/v1/plots?select=plot_idx&limit=1');
  console.log(`plots empty=${Array.isArray(rows) && rows.length === 0}`);
  if (!Array.isArray(rows) || rows.length !== 0) {
    throw new Error('public.plots is not empty after reset');
  }
}

async function listPhotos() {
  return request('/storage/v1/object/list/photos', {
    method: 'POST',
    body: JSON.stringify({ limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  });
}

async function resetPhotos() {
  try {
    const objects = await listPhotos();
    const names = Array.isArray(objects) ? objects.map(obj => obj.name).filter(Boolean) : [];
    if (!names.length) {
      console.log('photos empty=true');
      return;
    }
    await request('/storage/v1/object/photos', {
      method: 'DELETE',
      body: JSON.stringify({ prefixes: names }),
    });
    const remaining = await listPhotos();
    const remainingCount = Array.isArray(remaining) ? remaining.length : -1;
    console.log(`photos empty=${remainingCount === 0}`);
    if (remainingCount !== 0) {
      console.log(`photos cleanup skipped: ${remainingCount} old objects remain unreferenced after public.plots reset`);
    }
  } catch (error) {
    console.log(`photos cleanup skipped: ${error.message}`);
    console.log('photos debris status=old objects unreferenced after public.plots reset');
  }
}

await resetPlots();
await resetPhotos();
```

- [ ] **Step 3: Attempt reset from local credentials**

Run:

```powershell
node scripts/reset_supabase_clean_slate.mjs
```

Expected success:

- prints `plots empty=true`
- prints either `photos empty=true` or a line beginning with `photos cleanup skipped:` plus `photos debris status=old objects unreferenced after public.plots reset`

If the script fails before `plots empty=true`, stop and ask the user to run the SQL from Step 1 in the Supabase SQL editor.

- [ ] **Step 4: Verify `public.plots` is empty with an explicit PowerShell check**

Run:

```powershell
$config = Get-Content config.js -Raw
$url = [regex]::Match($config, "SUPABASE_URL = '([^']+)'").Groups[1].Value
$key = [regex]::Match($config, "SUPABASE_ANON_KEY = '([^']+)'").Groups[1].Value
$rows = Invoke-RestMethod -Method Get -Uri "$url/rest/v1/plots?select=plot_idx&limit=1" -Headers @{
  apikey = $key
  Authorization = "Bearer $key"
}
"plots empty=$($rows.Count -eq 0)"
```

Expected: prints `plots empty=True`. If not empty and local reset cannot delete it, stop and ask the user to run the SQL from Step 1.

- [ ] **Step 5: Record photo cleanup status**

Use the output from `node scripts/reset_supabase_clean_slate.mjs`:

- If it printed `photos empty=true`, record that the bucket was emptied.
- If it printed `photos cleanup skipped`, record that old photo objects are unreferenced debris after `public.plots` reset.
- If photo cleanup status is unknown because the script did not run, do not claim Supabase clean slate is complete.

- [ ] **Step 6: Commit Supabase reset docs and script**

Run:

```powershell
git add docs/supabase-setup.sql scripts/reset_supabase_clean_slate.mjs
git commit -m "docs: add Supabase clean slate reset"
```

## Chunk 5: Verification and Offline Build

### Task 7: Run automated verification

**Files:**
- All modified runtime and test files

- [ ] **Step 1: Run all Node tests**

Run:

```powershell
node --test tests/*.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run tile-generation validation without regenerating if raster is unavailable**

If `atok_satellite.tif` exists, run:

```powershell
python generate_tiles.py
node scripts/verify_study_area_assets.mjs
```

Expected: generator completes and prints generated plot/map/context counts; verifier prints `study-area assets ok: plots=<N> files=<N> runtime=<N>`.

If `atok_satellite.tif` is missing, run:

```powershell
python generate_tiles.py
```

Expected: fails with the explicit `atok_satellite.tif` missing/offline coverage message. This is a blocking condition for final app verification, not a test failure in the plan.

- [ ] **Step 3: Start a local static server with a tracked process**

Run:

```powershell
$server = Start-Process -FilePath python -ArgumentList '-m http.server 8080' -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
"server pid=$($server.Id) url=http://localhost:8080/taniman.html"
```

Open `http://localhost:8080/taniman.html`.

- [ ] **Step 4: Browser-check the app and capture evidence**

Verify manually or with Playwright and record a screenshot path in the implementation handoff.

Required checks:

- map opens fit to Atok
- Paoay boundary appears inside Atok
- plot markers appear only for Paoay
- Add Plot control is hidden
- selecting a Paoay plot opens a nonblank 50 x 50 canvas
- visible headers, labels, drawer text, and export-facing strings do not mention Ambassador or Tublay
- with browser network disabled, Atok map viewing and Paoay plot labeling still work if generated tiles exist

Network-disable procedure:

1. Load `http://localhost:8080/taniman.html` online once.
2. Disable browser network using DevTools or Playwright routing.
3. Reload the page.
4. Confirm local `tiles/map/` and `tiles/plots/` still render.
5. Confirm no ESRI/network fallback is required for Atok/Paoay.

- [ ] **Step 5: Stop the local static server**

Run:

```powershell
Stop-Process -Id $server.Id
```

Expected: local server is stopped. If `$server` is unavailable, inspect candidate Python servers before killing anything.

- [ ] **Step 6: Stage Tauri static bundle**

Run:

```powershell
Push-Location src-tauri
npm run prepare-dist
Pop-Location
```

Expected:

- `src-tauri/dist-static/index.html` exists
- `src-tauri/dist-static/data.js` exists
- `src-tauri/dist-static/tiles/map` exists
- `src-tauri/dist-static/tiles/plots` exists
- `src-tauri/dist-static/index.html` does not contain the Supabase CDN script

Verify:

```powershell
Test-Path src-tauri\dist-static\index.html
Test-Path src-tauri\dist-static\data.js
Test-Path src-tauri\dist-static\tiles\map
Test-Path src-tauri\dist-static\tiles\plots
Select-String -Path src-tauri\dist-static\index.html -Pattern '@supabase' -Quiet
```

Expected: first four commands print `True`; final command prints `False`.

If a full desktop build is requested and Node/Rust dependencies are installed, run:

```powershell
Push-Location src-tauri
npm run build
Pop-Location
```

- [ ] **Step 7: Verify Supabase clean-slate status**

Run:

```powershell
node scripts/reset_supabase_clean_slate.mjs
```

Expected:

- `plots empty=true`
- either `photos empty=true` or `photos debris status=old objects unreferenced after public.plots reset`

If credentials are unavailable, final handoff must say `Supabase reset blocked: user must run docs/supabase-setup.sql clean-slate block`.

- [ ] **Step 8: Process hygiene**

Because this plan runs Node tests, possible Tauri tooling, and possibly browser automation, use `process-hygiene` before ending the implementation thread. Inspect stale `node.exe` processes first and only clean obvious leftovers.

### Task 8: Final handoff

**Files:**
- No new files unless recording handoff notes is requested

- [ ] **Step 1: Check git state**

Run:

```powershell
git status --short
```

Expected: only intentional generated assets or documented local-only raster files remain uncommitted.

- [ ] **Step 2: Summarize verification**

Final implementation response must include:

- Paoay boundary source used
- whether `atok_satellite.tif` was present
- generated Paoay plot count
- generated Atok map tile count
- Supabase reset outcome
- Node test command and result
- browser/offline verification result
- any remaining manual blocker
