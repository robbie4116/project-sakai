# Taniman - Paoay Crop Map

Field data collection app for ground-truth crop mapping in Paoay, Atok, Benguet.

## Setup (one-time, before first deploy)

### 1. Generate the Paoay boundary

```bash
python scripts/extract_paoay_boundary.py
```

This extracts the Paoay barangay boundary from the faeldon Philippines JSON maps
2019 barangay hires GeoJSON source and writes:

- `boundaries/Benguet_Atok_Paoay_boundary.geojson`

The existing Atok municipality boundary remains the outer offline boundary.
Paoay is the training-domain reference outline; editing tiles cover the reference
Sentinel-2 raster extent, with Paoay membership carried in the export.

### 2. Generate tile assets

```bash
pip install -r requirements-dev.txt
python generate_plots.py
```

The current web labeling grid and imagery need no local source rasters. For
legacy offline map assets only, `generate_tiles.py` requires these rasters:

- `atok_satellite.tif` - high-detail Atok satellite raster for offline map tiles and Paoay plot crops
- `benguet_satellite.tif` - wider low-zoom satellite context map tiles

Tile outputs:

- `tiles/s2-plots/` - current UTM-aligned labeling imagery
- `tiles/plots/` - legacy geographic-grid plot images
- `tiles/map/` - high-detail offline Atok map tiles
- `tiles/context/` - wider low-zoom offline satellite context tiles for zoomed-out orientation

After tile generation, the static web app and downloadable Tauri app can render
Atok/Paoay locally. Plotting is fixed to the Sentinel-2 raster grid; there
is no Add Plot workflow.

### 3. Configure Supabase

Edit `config.js` with your Supabase project URL and anon key.

For a **new Supabase project only**, run `docs/supabase-setup.sql` to create the
plot table and photo bucket. This is a destructive reset script: it drops and
recreates `public.plots`, wiping its existing rows. For a project that already
contains field data, follow the existing-project instructions below instead.

### Existing Supabase project: add shared crops

Run these steps in order before deploying the shared-crop feature:

1. Back up the project data if desired.
2. In the SQL Editor for the existing project configured in `config.js`, run
   `docs/supabase-add-crops.sql`.
3. Verify that the `public.crops` table exists in the project's table list.
4. Merge or push the feature to `main`. Vercel automatically deploys the app
   from `main`.
5. Open the web app in two browsers and add a crop in the first. Reload the
   second, select the shared crop, and paint with it. Export the data and verify
   its name in `crops.csv` and its labeled season rows in `seasons.csv` and
   `plot_crop_counts.csv`.

No new Vercel environment variable, Supabase project, key, photo bucket, or
manual seed rows are needed. The additive crop migration creates the catalog
table and its validation and access policies; it does not modify existing plot
rows. **Do not run `docs/supabase-setup.sql` on an existing project** because it
drops and recreates `public.plots`.

If the app deploys before the migration is applied, the built-in target crops
remain available, but saving a new shared crop will fail until the catalog table
is installed.

### Reset Supabase for season schema (destructive)

1. Open Supabase Dashboard.
2. Select the project used by `config.js`.
3. Open SQL Editor.
4. Paste the full contents of `docs/supabase-setup.sql`.
5. Run it. This wipes existing plot rows. Do not use this reset procedure on an
   existing project with data you need to keep.
6. Reload the deployed app.

For a fresh project that will use shared crops, run
`docs/supabase-add-crops.sql` after this setup script. Existing projects should
run only the additive crop migration described above.

### 4. Deploy to Vercel

Push to GitHub. Connect the repo in Vercel; no build settings are needed because
the app is static.

## Local development

```bash
python -m http.server 8080
# Open http://localhost:8080/taniman.html
```

## Data export

Use the "Save all (.zip)" button in the app footer. Exports:

- `seasons.csv` - authoritative ML ground truth; one row per `season_id` plus
  `cell_idx`, with `crop_id`, inclusive recurring `start_mmdd`/`end_mmdd`,
  `wraps_year`, WGS84 cell center/bounds, row, and column
- `crops.csv` - joinable crop class lookup (`crop_id`, display name, color,
  target flag, and whether the ID resolves to a catalog crop). Referenced IDs
  missing from the catalog are included as unresolved placeholders.
- `plot_crop_counts.csv` - sparse counts grouped by plot and crop ID. Counts
  are derived from `seasons.csv` rows, so the same cell in overlapping seasons
  contributes once per season.
- `labels/plot_NNN.png` - color-coded label map per plot
- `labels.csv` - compatibility per-season/cell labels with crop names
- `plots.csv` - Paoay plot metadata, target-crop row counts, and an
  `other_crop_cells` count for custom or unresolved crops
- `farmers.csv` - farmer IDs, plot lists, and crop IDs as a JSON array in the
  `crops` column
- `metadata.json` - schema version, recurring annual date encoding, Sentinel-2
  alignment notes, farmer names, notes, plot coordinates, and crop summaries

Use `seasons.csv` as the training-label source and join it to `crops.csv` by
`crop_id`. Crop colors in the PNG label maps are for visual inspection only and
are not the class labels.

All exported plot records are generated Paoay plots with `plot_area=paoay` and
`plot_source=field_grid`.

## Offline desktop build (Windows and macOS)

The repo can be built as a standalone offline field app with Tauri.

### One-time setup

1. Install [Rust via rustup](https://rustup.rs/).
2. Install Node 18+ (any LTS).
3. From `src-tauri/`: `npm install`.

### Build

From `src-tauri/`:

- `npm run prepare-dist` - stages the static offline bundle in `src-tauri/dist-static`
- `npm run dev` - hot-reload dev window
- `npm run build` - produces the desktop app binary

The Tauri build does not affect the Vercel deployment.

### macOS distribution

The GitHub Actions workflow builds unsigned macOS builds for trusted testers.
They are free to produce, but macOS Gatekeeper may show warnings such as
unidentified developer, cannot be opened, or damaged. This is expected because
the app is not signed with a paid Apple Developer ID certificate or notarized.

Download the artifact that matches the Mac:

- `taniman-macos-arm64-unsigned` - Apple Silicon Macs (M1/M2/M3/M4)
- `taniman-macos-x64-unsigned` - Intel Macs

To use:

1. Open GitHub `Actions > Build`.
2. Open the latest successful run.
3. Download the correct macOS artifact.
4. Unzip the artifact and open the `.dmg`.
5. Drag `Taniman.app` to `Applications`.
6. If macOS blocks the app, run:

```bash
xattr -dr com.apple.quarantine /Applications/Taniman.app
open /Applications/Taniman.app
```

Only use this bypass for builds you trust from this repository. A normal
double-click download experience requires paid Apple Developer ID signing and
Apple notarization.

## Sentinel-2 labeling grid

The current website uses the exact grid of `Sentinel2_CSPlus_2024_01_H1.tif`:
EPSG:32651, 10 m pixels, upper-left edge `(258690, 1841210)`, 571 columns
and 494 rows. The 120 editing tiles are 500 m squares with 50 × 50 cells;
they are not the paper's 50 m independent validation plots. Partial edge cells
outside the raster are disabled. Zoom changes display size, never ground size.

Run `python generate_plots.py` to regenerate `s2-grid-data.js` and the UTM-aligned
imagery in `tiles/s2-plots/`. `generate_tiles.py` and `tiles/plots/` describe the
legacy geographic grid and must not replace these new assets. Esri imagery is
reference context; its capture date is not inferred as the crop observation date.

Before painting, choose the crop-cycle start year, dates and class, then confirm
the evidence. Use observed field IDs consistently across editing tiles. Exports
record zero-based Sentinel-2 row/column, UTM centers and bounds, geographic
footprints, year, class ID, field ID and Paoay membership. Labels outside Paoay
are excluded by the training preparation command.

Old browser labels remain in `taniman_v4_atok_paoay`; corrected labels use
`taniman_v5_sentinel2` with a grid identifier. Native saves use separate
`state-s2-v1.json` and backup files, preserving legacy `state.json` files.
The connected database already uses the per-season foundation schema. Before
merging/deploying this branch, run **`docs/supabase-s2-labels.sql`** in its SQL
Editor. This additive migration creates the separate `s2_label_plots` JSON table
and a crop-deletion RPC scoped to the new table. New grid plot IDs are stored in
1000000–1000119 there. Existing `plots`, `seasons` and legacy label records are
preserved. Crops used by another labeling dataset cannot be deleted through the
new app. Do not rerun either destructive reset script for this change.
Concurrent editing still follows the existing whole-plot save behavior.

The crop-cycle start year also controls the canvas, map and legend's label view.
An empty year shows all recorded years explicitly. Erasing requires a year and
removes only that cycle's observations; clearing a whole plot still clears all
its years. ZIP exports always contain every recorded year.

See [Random Forest training preparation](docs/random-forest-training.md) to turn
an export and a dated, aligned predictor stack into a training table. Correct
geometry does not establish crop identity, historical crop presence, or model
accuracy: those still need verified observations and independent field validation.

Checks: `node --test tests/*.test.mjs` and
`python -m pytest tests/test_plot_grid.py tests/test_generate_plots.py tests/test_prepare_rf_training.py`.
