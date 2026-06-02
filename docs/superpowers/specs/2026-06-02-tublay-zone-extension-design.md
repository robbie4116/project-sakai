# Tublay Zone Extension Design

**Date:** 2026-06-02
**Status:** Approved

## Overview

Extend the Taniman app's plotting coverage from Ambassador Area (the existing 8×8 grid) to the full Tublay municipality. Ambassador Area is a sub-area within Tublay. All of Tublay gets high-res satellite coverage offline; areas outside Tublay require internet (ESRI).

## Zone Model

Every coordinate in the app falls into exactly one of three zones:

| Zone | Definition | Canvas background | Offline |
|------|-----------|-------------------|---------|
| `ambassador` | Inside AMBASSADOR_GRID_BOUNDS rectangle | Pre-cut JPEG from `tiles/plots/plot_NNN.jpg` | Works offline |
| `tublay` | Inside Tublay polygon, outside Ambassador rect | Pre-cut JPEG from `tiles/plots/outside_NNN.jpg` (high-res) | Works offline |
| `outside` | Outside Tublay polygon | ESRI XYZ tile compositing | Requires internet; blocked with message if offline |

### Authoritative Tublay Bounds (from `Benguet_Tublay_boundary.geojson`)

All bounding values in this spec derive from the GeoJSON file. Do not use the old `TUBLAY_DETAIL_BOUNDS` values:

- N: 16.5514979
- S: 16.4547903
- E: 120.7004932
- W: 120.5665814

### Classification Logic

```
if (pointInRect(lat, lng, AMBASSADOR_GRID_BOUNDS)) → zone = 'ambassador'
else if (pointInPolygon(lat, lng, TUBLAY_POLY)) → zone = 'tublay'
else → zone = 'outside'
```

- `pointInRect` — existing rectangular bounds check using `AMBASSADOR_GRID_BOUNDS`
- `pointInPolygon` — existing function at `app.js:36`, reused for Tublay polygon
- `TUBLAY_POLY` — 282-vertex polygon array (281 unique + 1 closing repeat), inlined into `data.js` as `window.TUBLAY_POLY` from `Benguet_Tublay_boundary.geojson`. Same pattern as `window.AMBASSADOR_POLY`.
- `TUBLAY_BBOX` — fast rectangular pre-filter constant added to `app.js` using the authoritative bounds above; skip polygon math entirely if point is outside this rect

### Naming: Existing "outside_tublay" area tag

The existing codebase uses `area: 'outside_tublay'` and `isOutsidePlot()` for plots that are within Tublay but outside Ambassador — i.e. what this spec now calls the `tublay` zone. This naming predates the three-zone model and is now ambiguous. During implementation, rename:

- `area: 'outside_tublay'` → `area: 'tublay'`
- `isOutsidePlot()` → `isTublayPlot()` (or equivalent)
- Any references to `OUTSIDE_PLOTS` → `TUBLAY_PLOTS`

The new `outside` zone (outside Tublay entirely) has no pre-existing code representation — it is handled at selection time only (connectivity check + ESRI), not stored as a plot area tag.

## Map View Changes

Three boundary layers, draw order bottom to top:

1. **Tublay bounding rectangle** — `L.rectangle` using authoritative GeoJSON bbox (N=16.5514979, S=16.4547903, E=120.7004932, W=120.5665814). Style: thin solid white border, no fill. Outer orientation frame.
2. **Tublay polygon outline** — `L.polygon` from `TUBLAY_POLY` (282 vertices). Style: dashed light-blue (`#64B5F6`), slightly thicker. Shows true irregular municipality boundary.
3. **Ambassador polygon** — unchanged, dashed yellow (`#F2C84B`), rendered on top.

No fill on either new layer — satellite imagery underneath remains visible.

## Tile Regeneration (`generate_tiles.py`)

### Source change
All outside-Ambassador tiles switch source from `tublay_satellite.tif` (low-res, incomplete) to `tublay_satellite-highres.tif` (full Tublay coverage, same resolution as Ambassador tiles).

### Bounding extents
Update `TUBLAY_BBOX_*` constants in `generate_tiles.py` to the authoritative GeoJSON values (N/S/E/W above). These must stay in sync with `TUBLAY_DETAIL_BOUNDS` in `app.js`.

`tublay_satellite-highres.tif` is confirmed to cover the full Tublay municipality including all four GeoJSON bbox edges, so tile generation will not produce blank tiles at the boundary. The current `TUBLAY_BBOX_*` values in `generate_tiles.py` were derived from the old (smaller) TIF extent and must be replaced with the GeoJSON values — they are not equivalent.

### What gets regenerated
- **Plot crops** — all existing `tiles/plots/outside_NNN.jpg` files regenerated at 512×512 JPEG from high-res source. Existing `outsideSeq` indexing unchanged.
- **Map detail tiles** — `tiles/map/` (zoom 12–16) regenerated for full Tublay extent from high-res source.

### What stays unchanged
- Ambassador plot crops (`plot_000.jpg` to `plot_063.jpg`) — already high-res.
- Context tiles (`tiles/context/`) — still from `benguet_satellite.tif` (wide Benguet overview).

### `plotFitsDetailBounds` behavioral change
`createOutsidePlotAt` calls `plotFitsDetailBounds` which checks against `TUBLAY_DETAIL_BOUNDS`. Once bounds are updated to full Tublay extents, user-placed custom outside plots are permitted anywhere within Tublay. This is the intended behavior.

## Plot Selection — Outside Zone

When a user clicks a location outside the Tublay polygon:

1. **Connectivity check** — try-fetch a single ESRI tile URL with a 3-second timeout.
2. **Online** → plot canvas opens using ESRI XYZ tiles as canvas background (see below).
3. **Offline or timeout** → canvas does not open. Non-blocking message: *"This area is outside Tublay. An internet connection is required to view satellite imagery here."*

Applies identically to Vercel web build and Tauri desktop build.

### `drawMapTileBackground` refactor

The current function hardcodes `tiles/map/${z}/${x}/${y}.jpg` inside `getMapTileImage()` (`app.js:1105`). It does not accept a tile URL parameter. To support ESRI tiles for the `outside` zone, refactor `getMapTileImage` to accept an optional tile URL template parameter:

```
getMapTileImage(z, x, y, idx, urlTemplate = 'tiles/map/{z}/{x}/{y}.jpg')
```

The existing `idx` parameter (used for async re-render triggering: `if (idx === state.plotIdx) renderCanvas()`) is kept as-is in position 4. `urlTemplate` is added as a 5th parameter with a default matching current behavior, so all existing call sites require no changes.

For `outside` zone plots, pass the ESRI URL template:
```
'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
```

Note ESRI uses `{z}/{y}/{x}` order (y before x), unlike the local tiles which use `{z}/{x}/{y}`. The URL template substitution must account for this difference.

`drawMapTileBackground` itself passes the template down to `getMapTileImage`. The existing lat/lng → pixel math is unchanged.

## Data and Config Changes

| File | Change |
|------|--------|
| `data.js` | Add `window.TUBLAY_POLY` (282-vertex array inlined from GeoJSON) |
| `app.js` | Update `TUBLAY_DETAIL_BOUNDS` to authoritative GeoJSON extents; add `TUBLAY_BBOX` fast pre-filter constant; rename `isOutsidePlot` → `isTublayPlot` and related identifiers |
| `generate_tiles.py` | Swap source TIF to `tublay_satellite-highres.tif`; update `TUBLAY_BBOX_*` to authoritative extents |
| `.gitignore` | Add `tublay_satellite-highres.tif` |

No changes to: Tauri Rust backend, Supabase sync, offline storage layer, or Tauri build pipeline (`prepare-dist.mjs`).

## Out of Scope

- Changing the Ambassador 8×8 grid definition or plot dimensions
- Adding new zoom levels to context tiles
- Modifying the 50×50 cell crop data structure per plot
