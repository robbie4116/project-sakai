# ESRI Hybrid Map: Online Base + Offline Fallback Design Spec
**Date:** 2026-05-24
**Study area:** Ambassador barangay, Tublay, Benguet, Philippines

---

## 1. Problem

The current two-layer offline map produces a visible dark rectangle over the context layer. The detail tile layer (`tiles/map/`) has a 20% padded bounds that extends into areas where `tublay_satellite.tif` has no data. Those regions are filled with `OUTSIDE_TILE_FILL = (14, 26, 14)`, which appears black after the CSS brightness filter. The result is an unsightly dark rectangle overlaid on the satellite context.

A reference implementation using ESRI World Imagery as the base layer is smooth, visually correct, and requires no local context tiles when online.

---

## 2. Goals

- Use ESRI World Imagery as the primary satellite base when internet is available.
- Degrade gracefully offline: local context tiles (`tiles/context/`) show through when ESRI tiles fail.
- Keep the Ambassador detail layer (`tiles/map/`) always offline-capable.
- Eliminate the black rectangle glitch by tightening the detail layer bounds to the actual plot extent.
- Reposition the zoom controls into the map header bar and remove the "8 × 8 · 64 plot" hint text.

---

## 3. Non-Goals

- Do not replace Leaflet.
- Do not regenerate `tiles/map/`, `tiles/context/`, or `tiles/plots/`.
- Do not add user-facing layer controls or online/offline indicators.
- Do not change `generate_tiles.py`.

---

## 4. Architecture

Three Leaflet tile layers, added bottom to top:

```
Leaflet map
  |
  +-- [1] Context layer (offline fallback)
  |     Source: tiles/context/{z}/{x}/{y}.jpg
  |     Native zooms: 10–13
  |     Bounds: full benguet_satellite.tif extent
  |     Always present; shows through when ESRI tiles fail offline
  |
  +-- [2] ESRI World Imagery (online base)
  |     Source: server.arcgisonline.com/…/World_Imagery/MapServer/tile/{z}/{y}/{x}
  |     No bounds constraint (global)
  |     maxZoom: 19
  |     errorTileUrl: '' (fails silently when offline)
  |
  +-- [3] Ambassador detail layer
        Source: tiles/map/{z}/{x}/{y}.jpg
        Native zooms: 12–16
        Bounds: TIGHT — actual plot extent only, no padding
        Always present; offline-capable
  |
  +-- Vector overlays (Ambassador boundary, plot grid, current plot highlight)
```

**Online behaviour:** ESRI covers context tiles; users see smooth global satellite plus crisp Ambassador detail.

**Offline behaviour:** ESRI tiles silently fail (blank). Context tiles show through underneath. Detail tiles load from disk. No broken-image icons appear because `errorTileUrl` is set to empty fallbacks.

---

## 5. Constants

```js
const MAP_TILE_VERSION = '20260524-esri';
const MAP_CONTEXT_MIN_ZOOM = 10;
const MAP_CONTEXT_MAX_ZOOM = 13;
const MAP_DETAIL_MIN_ZOOM = 12;
const MAP_DETAIL_MAX_ZOOM = 16;
const MAP_APP_MIN_ZOOM = 10;   // literal — required for readNumericConstant in tests
const MAP_APP_MAX_ZOOM = 16;   // literal — required for readNumericConstant in tests
const MAP_CONTEXT_BOUNDS = L.latLngBounds(
  [16.1724728083975, 120.43212890625],
  [16.93070509876553, 120.9375]
);
const MAP_DETAIL_BOUNDS = L.latLngBounds(
  [16.46141, 120.62388],   // tight: actual plot extent, no padding
  [16.49551, 120.65667]
);
```

`MAP_DETAIL_BOUNDS` is reduced from the previous padded extent to the exact Ambassador plot bounding box. ESRI and context tiles already cover the surrounding terrain, so the padded area adds no value and was the source of the black-fill glitch.

---

## 6. Layer Factories

### 6a. `makeContextTileLayer()`

```js
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
```

### 6b. `makeEsriTileLayer()`

```js
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
```

No bounds. `errorTileUrl: ''` means failed tiles render as blank, not broken icons, allowing the context layer to show through.

### 6c. `makeDetailTileLayer()`

```js
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
```

---

## 7. Map Initialisation Changes

### Layer refs

```js
let contextTileLayerRef = null;
let esriTileLayerRef = null;
let detailTileLayerRef = null;
```

### `initMap()` options

```js
map = L.map('map', {
  center: [16.482, 120.640],
  zoom: 14,
  minZoom: MAP_APP_MIN_ZOOM,
  maxZoom: MAP_APP_MAX_ZOOM,
  maxBounds: MAP_CONTEXT_BOUNDS,
  maxBoundsViscosity: 0.85,
  zoomControl: false,
  attributionControl: false,
  zoomAnimation: false,
});
```

### Layer addition order

```js
contextTileLayerRef = makeContextTileLayer().addTo(map);
esriTileLayerRef    = makeEsriTileLayer().addTo(map);
detailTileLayerRef  = makeDetailTileLayer().addTo(map);
```

### `applyTheme()` update

```js
if (map && contextTileLayerRef && esriTileLayerRef && detailTileLayerRef) {
  map.removeLayer(detailTileLayerRef);
  map.removeLayer(esriTileLayerRef);
  map.removeLayer(contextTileLayerRef);
  contextTileLayerRef = makeContextTileLayer().addTo(map);
  esriTileLayerRef    = makeEsriTileLayer().addTo(map);
  detailTileLayerRef  = makeDetailTileLayer().addTo(map);
}
```

---

## 8. UI Changes

### Map header

**Before:**
```html
<div class="map-head">
  <h2 id="map-title">Ambassador Survey Area</h2>
  <span class="hint" id="map-hint">8 × 8 · 64 plot</span>
</div>
<div class="map-zoom">          <!-- absolute-positioned corner -->
  <button id="zoom-in">+</button>
  <button id="zoom-out">−</button>
</div>
```

**After:**
```html
<div class="map-head">
  <h2 id="map-title">Ambassador Survey Area</h2>
  <div class="map-zoom-inline">
    <button id="zoom-out" aria-label="Zoom out">−</button>
    <button id="zoom-in"  aria-label="Zoom in">+</button>
  </div>
</div>
```

- The `.map-zoom` absolute-positioned element is removed from the map pane.
- Zoom buttons move into the header bar as an inline horizontal pair, `−` on the left, `+` on the right.
- CSS for `.map-zoom-inline` styles the pair as two adjacent square buttons matching the header height.
- The `id="map-hint"` element is removed from the HTML. The corresponding line in `applyLang()` that sets `document.getElementById('map-hint').textContent` must also be removed from `app.js`.

---

## 9. Test Updates

The existing tests in `tests/map-zoom-config.test.mjs` check for `makeContextTileLayer` and `makeDetailTileLayer` — both still present. The new `makeEsriTileLayer` does not need a dedicated test.

The tests assert that the context and detail layer URLs contain the `?v=` query parameter (presence only, not value). Changing `MAP_TILE_VERSION` from `'20260524-context'` to `'20260524-esri'` does not break any test. No assertion checks the specific version string.

The generator tests remain unchanged (no changes to `generate_tiles.py`).

---

## 10. Acceptance Criteria

- At any zoom (10–16), the map shows satellite imagery — no blank areas within `MAP_CONTEXT_BOUNDS`.
- The Ambassador detail area shows crisp local imagery when zoomed to 12–16.
- No dark rectangle or visible tile bounds artifact in the Ambassador area.
- Zooming out to 10 shows satellite context covering the wider Benguet area.
- With network disabled in devtools, the map still shows satellite context (`tiles/context/`) and Ambassador detail (`tiles/map/`). ESRI tiles show as blank but do not display broken-image icons.
- Zoom `−`/`+` buttons appear inline in the map header, `−` left of `+`.
- The "8 × 8 · 64 plot" text is absent from the UI.
- All automated tests pass.
