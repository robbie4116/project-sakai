# Labeling Foundation: Sentinel-2 Grid, Land-Cover Classes, Safe Saves

Date: 2026-10-13
Status: Approved design, awaiting implementation plan

## Context

The team reviewed the app after an expert (Sir Kent) supplied labels outside the
app, through Google My Maps. Those labels were displaced and cannot be used. A
professor advised the team not to expect an outside expert to label every pixel
in the team's format. The team labels from imagery itself, and the expert paints
where he can and confirms or corrects the rest.

The full revision is split into separate specs:

1. **Labeling foundation (this spec):** a Sentinel-2-aligned grid, land-cover
   classes, explicit painting rules, field IDs, export, and safe saves.
2. **Needs check (later spec):** the team flags a field with a question; the
   expert answers correct, wrong, or not sure, with a remark.
3. **Faster painting (later spec):** canvas zoom, fill tool, number-key
   shortcuts, and adding another season to selected cells.

Decisions that constrain all three specs:

- The app is website only (Vercel). Offline support and the Tauri build are no
  longer requirements.
- There is no login and no annotator attribution.
- Seasons stay recurring date ranges with no year. The pipeline chooses the year.
- The Supabase database holds no labels worth keeping, so it can be reset.

This spec must ship before any real labeling, because changing the grid later
would mean converting every label.

## Goals

- One label cell equals exactly one pixel of the Sentinel-2 training composites.
- Labels distinguish crops, non-crop land cover, and "not labeled".
- Painting never silently produces an all-year crop label.
- The export carries the class IDs, field IDs and pixel coordinates the pipeline
  needs.
- Two people editing the same plot never erase each other's work.
- Farmer data is removed entirely.

## Non-goals

- Updating the Tauri build or the offline map tiles. That code stays in the repo
  and goes stale. It is not deleted here.
- Login, roles, or recording who labeled what.
- Years on seasons, confidence, source, or growth stage.
- Sentinel-2 imagery views, NDVI charts, landmarks, or a guided checklist.

## 1. Grid

### Reference grid (hardcoded constants)

These values come from the training composite
`Sentinel2_CSPlus_2024_01_H1.tif` (bands B3, B4, B5, B8, B11, float32), which
was read on 2026-10-13. The implementer does not need the file.

| Constant | Value |
|---|---|
| CRS | EPSG:32651 (WGS 84 / UTM zone 51N) |
| Pixel size | 10 m × 10 m |
| Origin, top-left corner (x, y) | (258690, 1841210) |
| Size | 571 columns × 494 rows |
| Extent | x 258690–264400, y 1836270–1841210 |

The Sentinel-2 pixel at (`s2_row`, `s2_col`) covers
x ∈ [258690 + 10·col, +10) and y ∈ (1841210 − 10·row − 10, 1841210 − 10·row].

### Plots

- A plot is 50 × 50 cells, which is 500 m × 500 m.
- The grid has 12 columns and 10 rows of plots, 120 plots in total. Plots are
  numbered row-major: `plot_idx = pr·12 + pc`.
- Cell (`r`, `c`) of plot (`pr`, `pc`) is Sentinel-2 pixel
  `s2_row = pr·50 + r`, `s2_col = pc·50 + c`. The cell index within a plot stays
  `r·50 + c`.
- Plot column 11 and plot row 9 are partial. The composite has 571 columns
  (11·50 + 21) and 494 rows (9·50 + 44). Cells with `s2_col ≥ 571` or
  `s2_row ≥ 494` are **out of bounds**: they are drawn greyed out, cannot be
  painted, and are never exported.
- All 120 plots are kept. Plots are no longer filtered by the Paoay boundary.
- `window.PAOAY_PLOTS` is renamed `window.PLOTS`, and `window.GRID` holds the
  reference constants.
- The zone classification is removed: `classifyZone`, the paoay/atok/outside
  zones, `CORE_PLOT_COUNT`, and the `plot_area`/`plot_source` fields.
- The overview map fits to the composite extent, and its max bounds are that
  extent plus a 1 km margin. `PAOAY_GRID_BOUNDS` and `ATOK_DETAIL_BOUNDS` are
  replaced by `GRID_BOUNDS`.
- `PAOAY_POLY` is kept and drawn as a reference outline. `ATOK_POLY` stays only
  for the Tauri path.

The composite is offset about 770 m east of the app's Paoay boundary. The team
chose to tile the composite's extent so that every paintable cell has a training
pixel. The Paoay outline is still drawn on the map for reference only.

### Geometry in the browser

The generator writes each plot's four corners (NW, NE, SE, SW) in WGS84 to the
generated block of `data.js`. A UTM square appears as a slightly rotated
quadrilateral in latitude and longitude.

- The Leaflet map draws plots as 4-corner polygons, not `L.rectangle`.
- A cell's latitude and longitude come from bilinear interpolation of the
  plot's corners. UTM coordinates are exact arithmetic on the constants. No
  projection library is loaded in the browser.
- The plot record replaces `latS/latN/lngW/lngE` with
  `{idx, pr, pc, corners:[[lat,lng]×4], utmX0, utmY0, validCols, validRows,
  tilePath}`. `validCols` is 50 except for plot column 11, where it is 21;
  `validRows` is 50 except for plot row 9, where it is 44.

## 2. Plot imagery

The generator is a new version of `generate_tiles.py`. It keeps the boundary
code it still needs and drops the steps that read `atok_satellite.tif` and
`benguet_satellite.tif`.

For each plot it:

1. Fetches Esri World Imagery tiles at zoom 18 (about 0.57 m per pixel at this
   latitude) that cover the plot's bounds plus a small margin, from
   `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`.
   Tiles are cached in a git-ignored directory (`.tile-cache/`). Requests are
   throttled to a few per second and send a descriptive User-Agent.
2. Mosaics the tiles in EPSG:3857 and reprojects them with
   `rasterio.warp.reproject` (bilinear) onto the plot's UTM square, using the
   transform `(0.5, 0, utmX0, 0, −0.5, utmY0)` and a 1000 × 1000 output.
3. Writes `tiles/plots/plot_NNN.jpg` (JPEG quality 80, about 30 MB in total),
   which is committed as `tiles/plots` is today.

The canvas draws the image scaled to fit, with grid lines every 20 image pixels.
Out-of-bounds cells get a grey overlay.

Esri's terms restrict bulk tile downloading. The team accepted this for a
non-commercial thesis, generating the images once and using them only in this
app.

The overview map still uses live Esri imagery. Its offline `tiles/map` and
`tiles/context` layers are used only by Tauri and are left untouched.

## 3. Classes

`window.CROPS` in `data.js` is replaced by `window.CLASSES`:

| class_id | key | English | Color | Group | Dates |
|---|---|---|---|---|---|
| 1 | carrot | Carrot | `#FF6A1F` | target crop | required |
| 2 | cabbage | Cabbage | `#A855F7` | target crop | required |
| 3 | potato | Potato | `#FFC629` | target crop | required |
| 4 | other_cultivated | Other cultivated | `#14B8A6` | crop, needs a crop name | required |
| 5 | forest | Forest / woody | `#166534` | non-crop | default all year |
| 6 | built_up | Built-up | `#DC2626` | non-crop | default all year |
| 7 | bare_fallow | Bare / fallow | `#A16207` | non-crop | default all year |
| 8 | grass_shrub | Grass / shrub | `#84CC16` | non-crop | default all year |
| (none) | other | Other | `#F472B6` | needs a remark | required |

- Each class has en/tl/il names. Tagalog and Ilocano names are flagged for the
  team to verify.
- On the canvas and map, class 4 cells use their crop name's own color, and the
  class color `#14B8A6` is used in legends.
- **Class 4 crop names** come from the existing shared Supabase `crops` table,
  which keeps its add and delete UI. It is now opened only after class 4 is
  picked.
- The block on target names changes from
  `lettuce, letsugas, potato, patatas, carrot, karot` to
  `carrot, karot, cabbage, repolyo, potato, patatas`, compared after trimming,
  collapsing whitespace and lowercasing. The SQL constraint and the client
  check use the same list.
- Seeded crop names: Lettuce `#22C55E` and Wombok `#4ADE80`.
- **Other** requires a free-text remark of 1–200 characters. It exports with an
  empty `class_id` and is meant for review, not training.
- The pipeline's `config.yaml` currently lists seven classes. The team must add
  grass/shrub as a separate class 8 to match. This is a pipeline-side task.

## 4. Painting rules

- A season is a class, plus a crop name (class 4) or remark (Other), plus
  `start`/`end` dates (MM-DD, recurring, may wrap past New Year).
- On page load nothing is selected: no class, no crop name, no remark, no
  dates. Selections are not persisted across reloads. They do persist when
  switching plots within a session.
- Painting is **blocked**, and the canvas shows a one-line prompt, until the
  selection is complete:
  - Classes 1–3: class and both dates.
  - Class 4: class, crop name and both dates.
  - Other: remark and both dates.
  - Classes 5–8: class only. Dates default to `01-01`–`12-31` and can be
    changed, for example fallow Jul–Sep.
- Painting with the same season key (class, crop name or remark, start, end)
  adds cells to the existing season in that plot. Otherwise it creates a new
  season. A cell may belong to several seasons, which is how rotations are
  painted, as today.
- Remarks are normalized (trimmed, inner whitespace collapsed) before storing.
  The key compares them case-insensitively, so "Weeds" and "weeds " are the
  same season.
- **Season IDs are deterministic.** The ID is derived from the plot and the
  season key:
  `p<plot_idx>|<class_id or "other">|<crop uuid or "">|<start>|<end>|<lowercased remark or "">`.
  Two people who create the same season at the same time therefore write to the
  same row and never produce duplicates.
- Erasing removes cells from every season in the plot that this browser knows
  about, as today. Seasons left empty are deleted. A season someone else
  created after this browser last fetched the plot is not affected. This is
  accepted, because each plot is refetched when it is opened.
- **Clear plot** calls the RPC `clear_plot(p_plot_idx)`. It deletes all of the
  plot's season rows, including ones this browser hasn't seen, and resets its
  note and photo. The local seasons and pending deltas for that plot are then
  dropped.
- Out-of-bounds cells ignore paint and erase.
- The month scrubber, map coverage legend and per-plot views keep their
  behavior, now keyed by class, with class 4 shown by crop name.

## 5. Farmer removal

The following are removed:

- The roster button and modal.
- The Farmer ID and name inputs and their suggestion.
- The editor's farmer chip.
- The `farmerId`/`farmer` plot fields and translation strings.
- `farmers.csv` and every `farmer_id` export column.

Plot details keep only the note and photos.

## 6. Field IDs (computed at export)

- A field is a maximal set of cells joined by shared edges (4-connectivity, not
  diagonal) that all belong to seasons with the same season key.
- Connectivity uses global (`s2_row`, `s2_col`), so a field that crosses a plot
  edge is one field.
- Field IDs are `F0001`, `F0002`, and so on, ordered by each field's minimum
  (`s2_row`, `s2_col`). They are stable for identical data within one export and
  are not stored.

## 7. Export (`Save all (.zip)`)

Files:

- **`seasons.csv`**, the authoritative training labels, with one row per
  season × cell. Columns: `plot_idx, season_id, field_id, class_id, class_name,
  crop_name, remark, start_mmdd, end_mmdd, wraps_year, s2_row, s2_col, utm_x,
  utm_y, center_lat, center_lng`.
  - `utm_x`/`utm_y` are the cell center in EPSG:32651.
  - `crop_name` is filled only for class 4.
  - `remark` is filled only for Other, which also has an empty `class_id`.
- **`fields.csv`**: `field_id, class_id, class_name, crop_name, remark,
  start_mmdd, end_mmdd, wraps_year, cell_count, plot_idxs` (the plot list is
  joined with `;`).
- **`classes.csv`**: `class_id, key, class_name, hex`, plus one row per class-4
  crop name (`class_id=4`, `key=crop:<uuid>`).
- **`plots.csv`**: `plot_idx, plot_row, plot_col, valid_cols, valid_rows, note,
  photo_count, season_count`, plus one `class_<id>_cells` column per class and
  `other_cells`.
- **`metadata.json`**: the schema version (6) and the reference grid constants
  (CRS, origin, pixel size, width, height), so the pipeline can verify
  alignment.
- `labels/plot_NNN.png` and photos, as today. The PNG rules:
  - Unlabeled cells are transparent.
  - Out-of-bounds cells are solid `#404040`.
  - Labeled cells use their class color; class 4 uses the crop name's color and
    Other uses `#F472B6`.
  - A cell in several seasons is drawn as today.

The export drops `farmers.csv`, `labels.csv`, `plot_crop_counts.csv` and
`crops.csv`.

## 8. Storage and safe saves

### Supabase schema (owner runs once)

A new, destructive script, `docs/supabase-foundation.sql`, replaces
`supabase-setup.sql` and `supabase-add-crops.sql`. The project owner runs it once
in the Supabase SQL Editor when the new version deploys. Only the owner has
dashboard access. The script:

- Drops the `plots` table, its custom-crop trigger, and the functions
  `delete_crop_and_seasons` and `validate_plot_custom_crops`.
- Creates `plots(plot_idx int primary key check 0–119, note text, photo_url
  text, updated_at timestamptz)`.
- Creates `seasons`:
  - `id text primary key`
  - `plot_idx int not null` (0–119)
  - `class_id smallint null` (1–8)
  - `crop_id uuid null references crops(id) on delete cascade`
  - `remark text null`
  - `start_mmdd text not null`, `end_mmdd text not null` (MM-DD format)
  - `cells int[] not null`
  - `updated_at timestamptz`
  - Checks: `crop_id` is not null exactly when `class_id = 4`, and `class_id`
    is null exactly when `remark` is non-empty.
  - Index on `plot_idx`.
- Keeps `crops` and its select and insert policies (anon still has no direct
  delete).
  - Drops the old `crops_not_target_name` constraint and adds one with the
    section 3 list.
  - Seeds Lettuce and Wombok with `on conflict do nothing`.
- Creates RPC `delete_crop(p_crop_id uuid) returns bigint`, a `security
  definer` function, which replaces `delete_crop_and_seasons`. It deletes the
  crop (seasons cascade) and returns the number of season rows removed. The
  client's `deleteCustomCrop` calls it.
  - A crop that is already gone returns 0 and raises no error.
- Creates RPC `apply_season_cells(p_id, p_plot_idx, p_class_id, p_crop_id,
  p_remark, p_start, p_end, p_add int[], p_remove int[])`, a `security definer`
  function that does the following:
  - Runs `INSERT … ON CONFLICT (id) DO UPDATE` with
    `cells = (existing ∪ add) − remove`, sorted and distinct. A conflicting
    upsert locks the row, so concurrent calls serialize. Metadata never
    conflicts, because the ID is derived from it.
  - `ON CONFLICT` does not update `remark`. When two remarks differ only in
    case, the first one written is the text that is kept.
  - Deletes the row if `cells` ends up empty.
  - Returns the resulting row, or null if it was deleted.
- Creates RPC `clear_plot(p_plot_idx int)`, a `security definer` function that
  deletes the plot's season rows and resets its `plots` row.
  - Files already uploaded to the `photos` bucket are left in place, as they
    are today.
- Keeps public read and write policies for anon on `plots`. Grants anon
  `select` on `seasons` and `execute` on the RPCs. There is no direct write to
  `seasons` and no login. The `photos` bucket stays as it is.
- The `device_id` column is dropped, and the client stops sending it.

The script is idempotent where practical and states at the top that it is
destructive.

### Client sync

- Local edits are queued as per-season deltas (`add`, `remove`). They are
  debounced and sent through `apply_season_cells`. Retries are safe because add
  and remove are idempotent.
- The plot note and photos are upserted to `plots` as before.
- On load, and whenever a plot is opened, the app selects that plot's `seasons`
  rows and replaces local seasons that have no pending deltas.
- **Coalescing rule.** The outbox holds at most one `{add, remove}` pair per
  season ID. Adding a cell removes it from the pending `remove` set and puts it
  in `add`; removing a cell does the reverse. The latest action wins, and the
  two sets never overlap. Erasing a cell and then repainting it before the save
  is sent therefore leaves the cell painted.
- **Undo and redo.** The whole-plot snapshots stay as they are. Restoring a
  snapshot works out, for each season, the difference between the current and
  restored cells, and queues those changes through the same coalescing rule. A
  season missing from the snapshot becomes a remove of all its cells. The undo
  and redo stacks of a plot are cleared whenever that plot is refetched from
  the server.
- **Refetch.** Local seasons with pending deltas are kept. Every other local
  season is replaced by the server's rows, and one that is missing on the
  server is dropped.
- **RPC result.** When `apply_season_cells` returns and no further deltas are
  queued for that season, the returned row, or its absence, replaces the local
  season.
- **Crop IDs.** The client now uses the bare crop UUID everywhere: in state,
  season IDs and RPC arguments. The old `crop_<uuid>` prefix is removed.
- **Error handling.**
  - Network errors and 5xx responses keep the delta in the outbox and retry
    every 30 s, as today.
  - A permanent error drops the delta, refetches the plot, and shows a short
    notice ("A change couldn't be saved; the plot was reloaded."). Permanent
    errors are Postgres codes `23xxx` (for example, a deleted crop's foreign
    key) and `22xxx`, and HTTP 4xx other than 408 and 429.
- **Deleting a class-4 crop name** also drops local seasons and pending deltas
  that use it, as `removeCustomCrop` does today.
- Two people painting different seasons, or the same season, never overwrite
  each other. An erase and a paint racing on the same cell resolve in the order
  the server receives them.
- localStorage remains a cache and an outbox for unsent deltas. The state key
  changes to `taniman_v6_s2grid`, so old cached state is ignored.

## 9. Testing

Tests use Node's built-in runner (`node --test tests/`) and follow the existing
style.

| Area | What the tests cover |
|---|---|
| Grid math | Mapping from plot and cell to `s2_row`/`s2_col` and UTM; out-of-bounds flags on the partial plots; cell latitude/longitude from corner interpolation within 0.5 m of reference points computed in Python and fixed in the test |
| Painting rules | Nothing selected on load; crop classes and Other blocked without dates; Other blocked without a remark; classes 5–8 default to all year; paint and erase ignore out-of-bounds cells |
| Field IDs | 4-connectivity; one field across a plot border; separate patches get separate IDs; cells touching only diagonally are not joined; IDs are deterministic |
| Export | Exact column sets and sample values for each CSV; no `farmer` strings anywhere in the export |
| Sync | Deltas sent to a fake Supabase client; outbox retry; the coalescing rule (erasing then repainting the same cell before a flush leaves it painted); undo producing the right deltas; remote rows replacing local seasons that have no pending deltas, and dropping seasons that are gone on the server; a permanent error dropping the delta and refetching the plot |
| Generator | A small Python test of the grid layout: 120 plots, corners and origin. Image download is verified by hand by opening several plots and checking that field edges line up with the cells. |

Existing tests tied to the old crops, the farmer fields, the 112-plot Paoay grid
or the plot-row sync are updated or removed. Expected candidates:

- `atok-paoay-study-area`
- `outside-plots`
- `crop-migration`
- `crop-targets`
- `crop-catalog`
- `crop-export`
- `supabase-crops`
- `supabase-season-source`
- `map-zoom-config`
- `season-state-source`
- `translations` (strings)

Tauri-only tests (`tauri-save-zip`, `desktop-lockfile`, `macos-build-workflow`)
are left alone.

## 10. Handoff

The implementer works from `main`.

**Needed**

- Node 18+ for the tests.
- Python 3 with `rasterio`, `Pillow`, `numpy`, `pyproj` and `requests`, plus
  internet access for the one-time image render. Add these to
  `requirements-dev.txt`.

**Not needed**

- Any `.tif` file. The grid constants are in this spec and in the generator.

**Optional check**

Someone who has a composite can confirm it matches the constants:

```bash
python -c "import rasterio;s=rasterio.open('Sentinel2_CSPlus_2024_01_H1.tif');print(s.crs,s.transform,s.width,s.height)"
```

The expected output is EPSG:32651, origin (258690, 1841210), 10 m, 571 × 494.

**Supabase (owner action)**

The implementer cannot run `docs/supabase-foundation.sql`. The repository owner
runs it in the SQL Editor when the new version deploys. Vercel deploys
automatically from `main`.
