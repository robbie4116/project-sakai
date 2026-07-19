# Atok/Paoay Study Area Design

**Date:** 2026-07-14
**Status:** Approved for implementation planning

## Overview

Move Taniman from the current Ambassador/Tublay study area to Paoay, Atok, Benguet.

The replacement model keeps the same basic app behavior:

- an outer administrative boundary for map context and offline coverage
- an inner administrative boundary where plotting is valid
- fixed plot crops and 50 x 50 crop-label canvases generated from local imagery
- offline field use inside the supported boundary

The new outer boundary is Atok. The new inner boundary is Paoay. Plotting is constrained to Paoay.

## Source of Truth

### Atok Boundary

Use the existing local boundary file:

- `boundaries/Benguet_Atok_boundary.geojson`

This file is EPSG:4326 and already carries Atok municipal metadata. It replaces the current Tublay municipality role in the app.

### Paoay Boundary

The repo does not currently contain a Paoay barangay boundary. The implementation must source one and commit it locally as:

- `boundaries/Benguet_Atok_Paoay_boundary.geojson`

The boundary must be sourced or extracted by PSGC where possible:

- Paoay barangay PSGC: `1401101005`
- Parent municipality: Atok, Benguet
- Parent municipality PSGC: `1401101000`

Preferred source order:

1. `faeldon/philippines-json-maps` 2019 Atok barangay GeoJSON, because it provides a small direct municipality-level file containing Paoay with admin hierarchy fields and source p-code `PH141101005`.
2. HDX COD-AB Philippines admin level 4 boundary dataset, because it is barangay-level and includes admin hierarchy fields, but the national GeoJSON archive is much larger and should be used as fallback.
3. Another barangay-level public GeoJSON dataset with PSGC fields and clear provenance.

Approximation is not in scope for this implementation plan. If no barangay polygon can be extracted from a credible source, implementation must stop and report the failed sources instead of generating an approximate Paoay boundary.

## Zone Model

Every coordinate in the app falls into one of three zones:

| Zone | Definition | User behavior | Offline behavior |
| --- | --- | --- | --- |
| `paoay` | Inside the Paoay barangay polygon | Plot-capable; fixed grid and crop labeling work | Fully offline if Atok/Paoay tiles and plot crops are generated |
| `atok` | Inside Atok but outside Paoay | Visible context only; no fixed plot selection | Fully offline map context if Atok tiles are generated |
| `outside` | Outside Atok | Out of supported offline area; plotting blocked | Blocked with a clear offline-area message |

Plotting is allowed only in `paoay`.

Atok outside Paoay remains visible for orientation but does not create plot records. The current outside-plot subsystem must be hidden for this study-area change. Users must not be able to add plots in Atok outside Paoay or outside Atok.

## Offline Requirement

The app must be fully usable offline within Atok after assets are regenerated.

The offline build requires:

- local Atok map tiles under `tiles/map/{z}/{x}/{y}.jpg`
- local Paoay plot crops under `tiles/plots/plot_NNN.jpg`
- local context tiles under `tiles/context/{z}/{x}/{y}.jpg`, if retained
- local Atok and Paoay GeoJSON-derived polygon arrays in `data.js`
- no network dependency for map viewing or canvas labeling inside Atok

The current `tublay_satellite-highres.tif` cannot be assumed to cover Atok/Paoay. The implementation must use a georeferenced raster that covers the full Atok municipality, because the accepted requirement is offline use within Atok.

Required source raster name:

- `atok_satellite.tif`

Using a Paoay-only raster is not acceptable for this implementation because it would not satisfy offline map viewing inside Atok.

## Boundary and Naming Changes

The implementation must stop extending Ambassador/Tublay names for the new location. Internals must use exact Atok/Paoay names for this migration.

Required public globals in `data.js`:

- `window.ATOK_POLY`: array of `[lat, lng]` points derived from `boundaries/Benguet_Atok_boundary.geojson`
- `window.PAOAY_POLY`: array of `[lat, lng]` points derived from `boundaries/Benguet_Atok_Paoay_boundary.geojson`
- `window.PAOAY_PLOTS`: array of plot metadata objects for generated Paoay plot crops

Required constants/functions in `app.js`:

- `const ATOK_POLY = window.ATOK_POLY`
- `const PAOAY_POLY = window.PAOAY_POLY`
- `const PAOAY_PLOTS = window.PAOAY_PLOTS`
- `const ATOK_DETAIL_BOUNDS = { n, s, e, w }`
- `const PAOAY_GRID_BOUNDS = { latN, latS, lngE, lngW }`
- `function classifyZone(lat, lng)` returning exactly `paoay`, `atok`, or `outside`

Avoid keeping `AMBASSADOR_*` and `TUBLAY_*` names for Paoay/Atok behavior except in deleted legacy comments or migration notes.

## Implementation Interfaces

`window.PAOAY_PLOTS` must use the same field contract currently expected by the app:

- `idx`: zero-based integer, contiguous from `0`
- `r`: grid row
- `c`: grid column
- `latS`, `latN`, `lngW`, `lngE`: plot rectangle bounds in WGS84
- `centerLat`, `centerLng`: plot center in WGS84
- `area`: literal string `paoay`
- `source`: literal string `field_grid`
- `tilePath`: `tiles/plots/plot_NNN.jpg`

Generated plot image names must be contiguous and match `idx`:

- `idx: 0` -> `tiles/plots/plot_000.jpg`
- `idx: 1` -> `tiles/plots/plot_001.jpg`

No `outside_*.jpg` plot crops are active in the new model. Existing stale files may remain in the working tree, but generated metadata and runtime code must not reference them.

## Plot Grid

The current plot grid is derived from the Ambassador rectangular extent. For Paoay, regenerate the fixed grid from Paoay's boundary extent.

The grid should:

- cover the Paoay polygon's bounding box
- keep the existing 50 x 50 cell labeling canvas per plot
- include plots whose rectangle overlaps the Paoay polygon
- preserve stable plot indexing for generated images and export rows
- use generated plot crops as the canvas background

This matches the current style where the app works with regular rectangular plot crops while the boundary remains irregular.

Plot validity is plot-level, not per-cell. If a plot rectangle overlaps the Paoay polygon, the whole 50 x 50 canvas is labelable. The implementation must not add per-cell polygon masking in this migration. Boundary-straddling plots are accepted because the app's current data model stores one rectangular plot crop with a full 50 x 50 label grid.

## Map View

Draw the map layers in this order:

1. Offline context tiles, if retained
2. Offline Atok detail tiles
3. Atok boundary outline
4. Paoay boundary outline
5. Paoay plot grid and crop composition overlays

Initial map view should fit Atok, not Paoay only. This keeps the outer boundary visible and confirms the offline supported area.

Recommended styling:

- Atok boundary: thin white outline, no fill
- Paoay boundary: stronger yellow or gold dashed outline, slight transparent fill if useful
- Plot grid: same plot styling as current app, adjusted only as needed for contrast

## Tile Generation

`generate_tiles.py` should be updated or replaced so it uses the Atok/Paoay model.

Responsibilities:

- read the Atok boundary to derive outer map tile bounds
- read the Paoay boundary to derive the plot grid extent
- generate `tiles/map/` from the Atok-covering raster
- generate `tiles/plots/plot_NNN.jpg` from the Paoay plot rectangles
- generate or validate `window.PAOAY_PLOTS` metadata using the exact interface above
- avoid generating active Ambassador/Tublay plot crops or active `outside_*.jpg` references

The plan should include a verification step comparing:

- number of generated `tiles/plots/plot_*.jpg`
- number of `window.PAOAY_PLOTS` entries
- app runtime plot count

These counts must match.

Before generation, the implementation should remove or ignore stale active plot outputs:

- delete old `tiles/plots/plot_*.jpg` before writing Paoay plot crops
- delete old `tiles/map/**/*.jpg` before writing Atok map tiles
- leave `tiles/context/empty.jpg` and `tiles/map/empty.jpg` fallbacks intact or recreate them

## Data Export

Exports should identify the new study area:

- `survey_area`: `Paoay, Atok, Benguet`
- plot area for fixed plots: `paoay`
- plot source for fixed plots: `field_grid`

Remove or replace exported `ambassador`, `tublay`, and `outside_tublay` area labels unless explicitly retained for legacy-import compatibility.

## Persistence and Sync Clean Slate

Do not reuse the existing local storage namespace for the new study area.

Required local storage key:

- `taniman_v4_atok_paoay`

On app start, old `taniman_v3` local data must not be loaded into the Atok/Paoay app. It may be left in local storage or explicitly removed, but it must not hydrate labels, farmer IDs, farmer names, notes, photos, sync timestamps, or sync payloads into the Atok/Paoay app state.

Supabase currently keys rows by `plot_idx`. The user confirmed the existing Supabase data is not important and may be rewritten or deleted. The implementation may keep the existing Supabase schema and sync behavior if it performs a clean reset before the Atok/Paoay app is used.

Required remote reset:

- remove all rows from `public.plots`
- remove existing objects from the `photos` storage bucket if credentials/policies allow it
- recreate missing table, bucket, or policies from `docs/supabase-setup.sql` if needed

The implementation thread should attempt the reset itself when the available credentials allow it. If the Supabase project requires owner-only SQL dashboard access or service-role credentials that are not available locally, stop and ask the user to run the exact SQL rather than silently leaving stale remote data in place.

Fallback SQL for the user to run in the Supabase SQL editor if local credentials are insufficient:

```sql
delete from public.plots;

delete from storage.objects
where bucket_id = 'photos';
```

The `storage.objects` deletion may require project-owner or service-role privileges. If photo cleanup cannot be performed but `public.plots` is empty, old photo objects are unreferenced by the app and may remain as storage debris. In that case, record the skipped photo cleanup in the implementation handoff.

Remote schema changes are still out of scope. If online sync later needs to preserve multiple study areas at once, create a separate plan to add a `study_area` column and composite conflict target such as `study_area, plot_idx`.

## UI Copy

User-facing strings should change from Ambassador/Tublay to Paoay/Atok:

- map title
- add-plot hints
- outside-area messages
- export metadata
- README setup text

Because plotting is Paoay-only, UI copy should not encourage adding plots in Atok outside Paoay.

The "Add plot" control must be hidden for this migration. Fixed Paoay plots are generated from the Paoay boundary and are the only supported plot records.

## Error Handling

If the Paoay boundary cannot be sourced by PSGC, implementation must stop and report the source attempted and why it failed. Approximation requires a separate explicit approval and spec revision.

If the Atok raster is missing, tile generation must fail with a clear message explaining that offline Atok support requires a georeferenced raster covering Atok/Paoay.

If the app is opened before regenerated tiles exist, it should fail visibly rather than silently showing stale Ambassador/Tublay imagery.

## Tests and Verification

Automated checks should cover:

- Atok and Paoay boundary arrays exist in `data.js`
- `classifyZone` returns `paoay`, `atok`, and `outside` for known coordinates
- plot count matches generated plot crop count
- exports use `Paoay, Atok, Benguet`
- UI strings no longer show Ambassador/Tublay for the active study area
- local storage uses `taniman_v4_atok_paoay`, not `taniman_v3`
- Supabase `public.plots` is empty before first Atok/Paoay sync, or sync is disabled until it can be reset
- the `photos` bucket is emptied, or old photo objects are explicitly recorded as unreferenced debris after `public.plots` reset
- no runtime metadata references `outside_*.jpg`

Manual/browser checks should cover:

- map opens fit to Atok
- Paoay boundary appears inside Atok
- plot markers are present only for Paoay
- selecting a Paoay plot opens a nonblank 50 x 50 canvas
- disabling network still allows Atok map viewing and Paoay plot labeling
- Add Plot is hidden and cannot create Atok-outside-Paoay records
- no active labels, export values, or visible headers mention Ambassador or Tublay

## Out of Scope

- Changing the crop taxonomy
- Changing the 50 x 50 label grid resolution
- Changing Supabase schema
- Changing the Tauri build pipeline except as needed to include the new static assets
- Keeping Ambassador/Tublay as an active selectable study area

## Implementation Handoff Notes

This is a planning artifact only. Code implementation should happen in a separate implementation thread.

The implementation thread should start by acquiring `boundaries/Benguet_Atok_Paoay_boundary.geojson`, then validate it against the existing Atok boundary before touching app behavior.
