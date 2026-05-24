# Offline Satellite Context Map: Design Spec
**Date:** 2026-05-24
**Study area:** Ambassador barangay, Tublay, Benguet, Philippines
**Purpose:** Let field users zoom out and orient themselves with satellite-looking context while keeping the Ambassador work area based on the highest-detail local imagery.

---

## 1. Overview

The current Taniman map is fully local, but its zoom-out range is constrained by a single local tile pyramid generated from `tublay_satellite.tif`. The browser map and tile layer both stop at zoom 12, and panning is clamped to a small padded Ambassador/Tublay tile extent. Users can work inside Ambassador, but they cannot zoom out far enough to understand the surrounding terrain.

The selected direction is a two-tier offline satellite map:

1. A wider, lower-detail satellite-looking context layer generated from `benguet_satellite.tif`.
2. The existing higher-detail Ambassador/Tublay layer generated from `tublay_satellite.tif`.

The context layer exists for orientation only. The Ambassador detail layer remains the authoritative imagery for plot selection, plot overlays, and fieldwork decisions.

---

## 2. Goals

- Allow users to zoom out farther than the current zoom 12 floor.
- Keep the surrounding reference map satellite-looking, not a simplified vector map.
- Work during fieldwork with poor, unstable, or unavailable internet.
- Preserve the current offline-first behavior: all required map imagery is bundled with the static app.
- Keep the Ambassador area visually detailed using the existing local `.tif`-derived imagery.
- Avoid a large broad-area high-resolution satellite bundle where coarse overview imagery is enough.

---

## 3. Non-Goals

- Do not replace Leaflet.
- Do not require an online tile provider for field use.
- Do not regenerate or change the 64 plot crop images unless the implementation discovers they are coupled to the map tile generator.
- Do not add user-facing layer switching unless needed for debugging. The app should present one coherent satellite map.
- Do not use the broad context imagery as the authoritative source for plot-level labeling.

---

## 4. Current State

Relevant files:

- `app.js`
  - `makeTileLayer()` loads `tiles/map/{z}/{x}/{y}.jpg`.
  - Map and tile layer are configured for zoom 12 through 16.
  - `maxBounds` is the current detail tile bounds, so users cannot pan beyond the small generated tile area.
- `generate_tiles.py`
  - Uses `SOURCE_TIF = "tublay_satellite.tif"`.
  - Generates plot crops into `tiles/plots/`.
  - Generates one tile pyramid into `tiles/map/`, currently zoom 12 through 16.
- `tests/map-zoom-config.test.mjs`
  - Verifies the app zoom floor matches the lowest committed native tile zoom.
  - Verifies map tiles preserve full XYZ tile extents rather than stretching partial source coverage.
- Local source rasters:
  - `tublay_satellite.tif`: EPSG:4326, 11008 x 10496, bounds approximately 120.5887..120.7068 longitude and 16.4545..16.5625 latitude.
  - `benguet_satellite.tif`: EPSG:4326, 5888 x 9216, bounds approximately 120.4321..120.9375 longitude and 16.1725..16.9307 latitude.
  - `Benguet_Sentinel2_Median.tif`: EPSG:4326, 5399 x 8309, 4 bands, similar broad Benguet coverage. This is a fallback if `benguet_satellite.tif` is unsuitable.

---

## 5. Proposed Architecture

```
Leaflet map
  |
  +-- Context satellite layer
  |     Source: benguet_satellite.tif
  |     Output: tiles/context/{z}/{x}/{y}.jpg
  |     Native zooms: 10-13
  |     Purpose: wide-area satellite-looking reference
  |
  +-- Detail satellite layer
  |     Source: tublay_satellite.tif
  |     Output: tiles/map/{z}/{x}/{y}.jpg
  |     Native zooms: 12-16
  |     Purpose: high-detail Ambassador/Tublay working imagery
  |
  +-- Vector overlays
        Ambassador boundary polygon
        Plot grid polygons
        Current plot highlight
```

Layer order matters. The context layer is added first. The detail layer is added second and visually replaces the context layer where local detail tiles exist. Boundary and plot overlays remain above both raster layers.

The app should set the map's `minZoom` to the context layer's lowest zoom, likely 10. The app should keep `maxZoom` at the current detail maximum, likely 16. The map's `maxBounds` should expand to the context layer's bounds, not the detail layer's bounds.

---

## 6. Tile Strategy

### 6a. Context Layer

Generate `tiles/context/{z}/{x}/{y}.jpg` from `benguet_satellite.tif`.

Recommended initial settings:

- Native zoom range: 10 through 13.
- Tile size: 256 px.
- JPEG quality: 70 to 78.
- Bounds: the full `benguet_satellite.tif` coverage.

The full `benguet_satellite.tif` coverage is practical at low zoom. Estimated tile count for zooms 10 through 13 is about 346 tiles, which is small enough for a static offline bundle at JPEG quality 70 to 78 while giving users meaningful surrounding satellite context.

The generator must write full XYZ tile extents with boundless reads and a neutral outside-fill color, the same principle already used by `read_xyz_tile()`. It must not stretch partial source coverage across full tile images.

### 6b. Detail Layer

Keep the existing `tiles/map/{z}/{x}/{y}.jpg` detail layer behavior for zoom 12 through 16. This layer continues to use `tublay_satellite.tif` and the current Ambassador/Tublay bounds.

When users zoom out below zoom 12, Leaflet may still show the detail layer using `minNativeZoom: 12`, but that is optional. The preferred behavior is:

- Context layer visible across zooms 10 through 16.
- Detail layer native from zoom 12 through 16.
- Detail layer bounded to the current detail bounds.
- Context layer remains visible outside the detail bounds.

This avoids blank areas outside the Ambassador detail extent.

---

## 7. Generator Design

`generate_tiles.py` should move from one hard-coded map tile output to two explicit layer configs:

- Plot crops:
  - Source: `tublay_satellite.tif`
  - Output: `tiles/plots/`
  - Existing behavior retained.
- Detail map tiles:
  - Source: `tublay_satellite.tif`
  - Output: `tiles/map/`
  - Zooms: 12 through 16
  - Bounds: current detail bounds.
- Context map tiles:
  - Source: `benguet_satellite.tif`
  - Output: `tiles/context/`
  - Zooms: 10 through 13
  - Bounds: full `benguet_satellite.tif` bounds.

The generator should avoid deleting existing unrelated output by default. If cleanup is needed, it should be explicit and scoped to the target layer directory.

The generator should print a summary for each layer:

- Source raster path.
- Output directory.
- Zoom range.
- Bounds.
- Tile count per zoom.
- Total output size if easy to compute.

---

## 8. App Design

`app.js` should replace the single map tile layer factory with two factories:

- `makeContextTileLayer()`
- `makeDetailTileLayer()`

Recommended constants:

```js
const MAP_TILE_VERSION = '20260524-context';
const MAP_CONTEXT_MIN_ZOOM = 10;
const MAP_CONTEXT_MAX_ZOOM = 13;
const MAP_DETAIL_MIN_ZOOM = 12;
const MAP_DETAIL_MAX_ZOOM = 16;
const MAP_APP_MIN_ZOOM = MAP_CONTEXT_MIN_ZOOM;
const MAP_APP_MAX_ZOOM = MAP_DETAIL_MAX_ZOOM;
const MAP_CONTEXT_BOUNDS = L.latLngBounds(...);
const MAP_DETAIL_BOUNDS = L.latLngBounds(...);
```

Layer configuration:

- Context layer:
  - URL: `tiles/context/{z}/{x}/{y}.jpg?v=${MAP_TILE_VERSION}`
  - `minZoom: MAP_APP_MIN_ZOOM`
  - `maxZoom: MAP_APP_MAX_ZOOM`
  - `minNativeZoom: MAP_CONTEXT_MIN_ZOOM`
  - `maxNativeZoom: MAP_CONTEXT_MAX_ZOOM`
  - `bounds: MAP_CONTEXT_BOUNDS`
  - `errorTileUrl: 'tiles/map/empty.jpg'` or a new `tiles/context/empty.jpg`
- Detail layer:
  - URL: `tiles/map/{z}/{x}/{y}.jpg?v=${MAP_TILE_VERSION}`
  - `minZoom: MAP_DETAIL_MIN_ZOOM`
  - `maxZoom: MAP_APP_MAX_ZOOM`
  - `minNativeZoom: MAP_DETAIL_MIN_ZOOM`
  - `maxNativeZoom: MAP_DETAIL_MAX_ZOOM`
  - `bounds: MAP_DETAIL_BOUNDS`
  - `errorTileUrl: 'tiles/map/empty.jpg'`

Map initialization:

- `minZoom` should use `MAP_APP_MIN_ZOOM`.
- `maxZoom` should use `MAP_APP_MAX_ZOOM`.
- `maxBounds` should use `MAP_CONTEXT_BOUNDS`.
- `maxBoundsViscosity` can remain near the current value.
- Initial `fitBounds()` should still fit the Ambassador polygon, not the full context layer.

Theme changes currently remove and recreate `tileLayerRef`. That should be updated to track both layers or to avoid recreating raster layers if no theme-specific raster behavior remains.

---

## 9. Offline Behavior

The feature must work with no network connection after the static app and committed tiles are available locally or served from Vercel cache.

Required behavior:

- Opening `taniman.html` from a local server must show context imagery without fetching external map tiles.
- Zooming out to the new minimum zoom must not reveal a blank map inside the context bounds.
- Panning outside the detail bounds but inside the context bounds must show context imagery.
- Existing plot crop canvases must continue to load from `tiles/plots/`.
- Supabase sync can remain opportunistic and unrelated to map tile availability.

Optional future enhancement:

- Add an online basemap as a convenience when internet exists. It must never be required for fieldwork.

---

## 10. Error Handling

- Missing context tiles should render a neutral fallback tile, not broken image icons.
- If `benguet_satellite.tif` is absent during generation, the script should print a clear error that names the required file and explains that it is only needed for context tiles.
- If the context source has fewer than three bands, the script should fail with a clear message.
- If the context source has four bands, the script should use bands 1, 2, and 3 for RGB unless a future domain-specific band mapping is specified.
- If generated context tile output becomes too large for practical deployment, reduce context zoom max or JPEG quality before expanding scope.

---

## 11. Testing

Automated tests should verify configuration and generator behavior:

- App map minimum zoom equals the context layer's lowest committed native zoom.
- Detail layer remains bounded separately from context layer.
- Context layer URL points at `tiles/context/{z}/{x}/{y}.jpg`.
- Detail layer URL still points at `tiles/map/{z}/{x}/{y}.jpg`.
- Generator defines separate context and detail outputs.
- Generator preserves boundless full XYZ tile reads.
- Generator handles a 4-band context source by selecting RGB bands explicitly.

Manual/browser verification should cover:

- Start local server with `python -m http.server 8080`.
- Open `http://localhost:8080/taniman.html`.
- Confirm initial map still frames Ambassador.
- Click zoom out until the new minimum zoom.
- Confirm satellite-looking context remains visible around Ambassador.
- Pan outside the detail extent but inside the context extent.
- Confirm the Ambassador boundary and plot grid remain visible and aligned.
- Simulate offline mode in browser devtools or disconnect internet and reload from local server.

---

## 12. Acceptance Criteria

- Users can zoom out below the current zoom 12 floor.
- At low zoom, the map still looks like satellite imagery.
- The Ambassador work area remains high-detail and aligned with plot overlays.
- Wider surrounding terrain is visible enough for orientation.
- The app does not depend on live internet map tiles.
- No external basemap requests are required for normal field use.
- Existing tests pass.
- New tests cover the two-layer map configuration.
- The implementation documents how to regenerate both detail and context tiles.

---

## 13. Risks and Mitigations

- **Asset size grows too large.** Keep context zoom max low, start with zoom 10 through 13, and use JPEG quality around 70 to 78.
- **Context imagery looks too coarse.** Increase `MAP_CONTEXT_MAX_ZOOM` to 14 only if needed after visual review.
- **Layer seam is visible where detail tiles overlay context tiles.** This is acceptable because the detail layer is the working area. If it is distracting, tune opacity or ensure both sources have similar color balance later.
- **Source rasters have different capture dates or color profiles.** Treat context as orientation-only and document that the Ambassador detail imagery remains authoritative.
- **Browser cache shows old tiles.** Bump `MAP_TILE_VERSION` whenever tile paths, tile bounds, or generated imagery changes.

---

## 14. Implementation Recommendation

Implement the feature in three passes:

1. Add tests that describe the desired two-layer offline map configuration.
2. Refactor `generate_tiles.py` to generate `tiles/context/` from `benguet_satellite.tif` while preserving current plot and detail outputs.
3. Update `app.js` to render context and detail tile layers together, then run browser verification at low zoom.

This is the smallest change that gives users a satellite-looking zoomed-out reference map while preserving offline field reliability.
