# Crop Season Ground Truth Design

## Goal

Update the deployed Taniman web app so it collects crop-presence ground truth that is usable for Sentinel-2 based crop classification. The active target crops are lettuce, potato, and carrot. The app should keep the current field workflow of choosing a crop and schedule, then painting cells, but the schedule must become more precise than whole-month masks.

The output should support a downstream random forest training pipeline that samples Sentinel-2 bands and vegetation indices only from dates when a crop is actually present.

## Current Behavior

The deployed app is the static Vercel app served from `taniman.html`. The desktop/Tauri app shares the same static files, but the deployment path does not require a build step.

The current crop list is carrot, potato, cabbage, and wombok/petsay. Crop cell data is stored as arrays aligned to the crop list. Each crop/cell value is a 12-bit month mask, where a set bit means the crop is planted during that whole month.

This is not precise enough for the intended training workflow. If a crop is only planted in the last week of June, the current storage still marks all of June as valid. That can create label noise when extracting Sentinel-2 bands for early-June imagery.

## Proposed Behavior

Replace whole-month crop masks with recurring annual crop season records. The field workflow remains:

```text
choose crop -> choose planting-to-harvest range -> paint cells
```

Each painted season record stores:

```js
{
  cropId: "lettuce",
  start: "06-20",
  end: "07-10",
  cells: [1044, 1045, 1094]
}
```

Rules:

- Active crops are exactly `lettuce`, `potato`, and `carrot`.
- Date ranges use recurring month-day values, not years.
- The range is planting until harvest.
- `start` and `end` are inclusive. A same-day range means the crop is present for that one calendar day.
- Wrapped annual ranges are valid. `11-15` to `05-05` means November 15 through December 31 and January 1 through May 5, inclusive.
- A plot can contain many season records.
- The same cell can contain multiple crops.
- The same crop can appear on the same cell in multiple date windows.
- Overlap is allowed. The app should not force one crop or one schedule to win.

## Data Model

Move plot crop data from `cells: Uint16Array[]` month masks to a season-oriented structure:

```js
{
  seasons: [
    {
      id: "local generated id",
      cropId: "lettuce",
      start: "06-20",
      end: "07-10",
      cells: [1044, 1045, 1094],
      createdAt: "ISO timestamp",
      updatedAt: "ISO timestamp"
    }
  ],
  farmerId: "",
  farmer: "",
  note: "",
  photos: []
}
```

Cell IDs remain the app's existing 50 by 50 plot-local cell indexes for the UI, but exports must include geospatial cell information so the downstream pipeline can align labels to a Sentinel-2 grid.

The implementation should use one row per season plus cell in exports. A single season with 20 painted cells becomes 20 `seasons.csv` rows with the same `season_id`. If the same cell has two overlapping lettuce seasons, the export keeps two rows unless a future explicit dedupe rule is added. This preserves the survey record instead of silently merging labels.

Crop identity should use `cropId` instead of relying on crop array position. This avoids scrambling labels when removing cabbage and wombok/petsay or when reordering the palette.

Because the current Supabase data is disposable, no preservation migration is required for remote records. Locally loaded legacy records should either reset safely or be converted best-effort only when the old crop can be mapped unambiguously. Non-target old crops should not appear in the active UI or ML export.

## Sentinel-2 Ground Truth Alignment

Sentinel-2 has native bands at 10 m, 20 m, and 60 m spatial resolution. The training pipeline should treat 10 m cells as the preferred label grid because the visible and NIR bands used by common crop indices are available at 10 m.

The app does not need to redesign the painting UI into a true Sentinel-2 raster editor in this step. Instead, the export must contain enough geospatial information for each painted app cell so downstream processing can rasterize or sample labels onto a fixed 10 m grid.

Cell geometry is exported in `EPSG:4326` latitude/longitude coordinates. The source is the plot's existing georeferenced bounds:

- `latS`, `latN`, `lngW`, and `lngE` from the selected plot record;
- `GRID = 50`;
- `cell_row = Math.floor(cell_idx / GRID)`;
- `cell_col = cell_idx % GRID`;
- `lat_step = (latN - latS) / GRID`;
- `lng_step = (lngE - lngW) / GRID`;
- `lat_n = latN - cell_row * lat_step`;
- `lat_s = lat_n - lat_step`;
- `lng_w = lngW + cell_col * lng_step`;
- `lng_e = lng_w + lng_step`;
- `center_lat = (lat_s + lat_n) / 2`;
- `center_lng = (lng_w + lng_e) / 2`.

The exported bounds are axis-aligned WGS84 boxes matching the app's current plot grid. Values should be written with enough precision for sub-meter reproducibility in WGS84, preferably 7 or more decimal places. If a future plot source uses non-axis-aligned cells, export should add a polygon field, but the current generated Paoay plot grid can use these bounds.

For each season/cell row, export:

- `plot_idx`
- `season_id`
- `cell_idx`
- `crop_id`
- `start_mmdd`
- `end_mmdd`
- `wraps_year`
- `center_lat`
- `center_lng`
- `lat_s`
- `lat_n`
- `lng_w`
- `lng_e`
- `cell_row`
- `cell_col`
- optional cell area fields if available

The downstream ML pipeline can then:

1. Choose a target year.
2. Expand recurring `MM-DD` ranges into concrete dates.
3. Query cloud-screened Sentinel-2 imagery inside those dates.
4. Sample bands and indices at each cell center or by cell polygon.
5. Train the random forest with `crop_id` as the class label.

## User Interface

Keep the existing palette and painting workflow, with these changes:

- Crop palette shows only Lettuce, Potato, and Carrot.
- The schedule control changes from month-range selection to planting-to-harvest `MM-DD` selection.
- Provide fast shortcuts that populate exact month-day fields:
  - whole month: `MM-01` through the month's last valid day;
  - early month: `MM-01` through `MM-10`;
  - mid month: `MM-11` through `MM-20`;
  - late month: `MM-21` through the month's last valid day.
- Provide exact start and end month/day inputs.
- The readout should show labels such as `Lettuce · Jun 20-Jul 10`.
- Painting applies the selected `cropId`, `start`, and `end` to the brushed cells.

For the first implementation, the map visibility filter can stay simple:

- All schedules
- Month view
- Optional date-range view if it can be added without expanding scope too much

When multiple crops are visible in a cell for the active filter, keep the existing mixed-cell rendering behavior.

## Export

The export zip should add `seasons.csv` as the primary ML-ready ground truth file:

```csv
plot_idx,season_id,cell_idx,cell_row,cell_col,crop_id,start_mmdd,end_mmdd,wraps_year,center_lat,center_lng,lat_s,lat_n,lng_w,lng_e
12,season_abc123,1044,20,44,lettuce,06-20,07-10,false,16.6200000,120.7500000,16.6199000,16.6201000,120.7499000,120.7501000
12,season_def456,1044,20,44,potato,08-01,10-20,false,16.6200000,120.7500000,16.6199000,16.6201000,120.7499000,120.7501000
18,season_ghi789,802,16,2,carrot,11-15,05-05,true,16.6300000,120.7600000,16.6299000,16.6301000,120.7599000,120.7601000
```

Keep compatibility exports where useful:

- `plots.csv`: plot-level summary by crop and season count.
- `labels.csv`: cell-level labels updated for date ranges instead of month bits.
- `metadata.json`: schema version, target crop list, date encoding rules, and Sentinel-2 alignment notes.
- label PNGs: rendered from the current app view for visual QA, not as the authoritative ML data.

The new export schema should clearly state that `MM-DD` windows are recurring annual schedules. It should not imply a specific year. `start_mmdd` and `end_mmdd` are inclusive. `wraps_year` is true when `start_mmdd` is later in the calendar year than `end_mmdd`.

## Supabase Reset

Since the existing database has no important data, use a clean schema reset for the new storage format. The implementation should update `docs/supabase-setup.sql` or add a dedicated reset SQL file that:

- drops or recreates the `plots` table;
- stores `seasons` as JSONB;
- keeps farmer, note, photo, device, and timestamp columns;
- preserves the simple public read/write policies already used by the app;
- wipes old rows.

The final implementation instructions should be concrete: open the Supabase SQL Editor, paste/run the reset SQL file, then reload the deployed app.

## Validation And Error Handling

Date validation should reject impossible month-day values such as `02-31`, `00-10`, or `13-01`.

The UI should prevent painting if no valid crop/date range is selected. If a saved season contains invalid data, ignore that season for rendering/export and surface a console warning.

Wrapped ranges are not errors. Same-day ranges are valid and mean one inclusive day.

Erase behavior can remain broad for the first implementation: erasing a cell removes all crop seasons touching that cell. A more selective erase mode can be added later if needed.

## Testing

Add focused tests for:

- target crop list is exactly lettuce, potato, carrot;
- overlapping normal date ranges are preserved and exported;
- overlapping wrapped date ranges are preserved and exported;
- invalid month-day rejection;
- same-day range behavior;
- season storage uses `cropId`;
- painting can add overlapping crop/date windows;
- export includes `seasons.csv`;
- export includes one row per `season_id` plus `cell_idx`;
- export includes WGS84 cell center, bounds, row, and column;
- old month-mask crop index data cannot scramble active target crops.

Run the existing source tests after the change. Add a browser smoke test if feasible:

1. Serve the static app locally.
2. Open `taniman.html`.
3. Select a crop and exact date range.
4. Paint one cell.
5. Export zip.
6. Inspect `seasons.csv` headers and at least one row.

## Deployment

The deployed app is static on Vercel. After implementation and tests pass, deployment should happen through the existing GitHub/Vercel flow. No build command is required for Vercel.

The local desktop/Tauri app shares the static files, so the UI/data changes will also affect the built-in app when its static bundle is prepared. This request prioritizes the deployed app.

## Out Of Scope

- Building the Sentinel-2 extraction pipeline itself.
- Training the random forest model inside this app.
- Reprojecting the app editor into an exact Sentinel-2 10 m raster grid during this change.
- Preserving old Supabase crop labels.
- Selective erase/edit tools for one season inside a cell.
