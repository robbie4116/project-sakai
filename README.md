# Taniman - Paoay Crop Map

Field labeling app for ground-truth land-cover mapping in Paoay, Atok, Benguet.
Each label cell is exactly one 10 m pixel of the Sentinel-2 training composites.

## Setup (one-time, before first deploy)

### 1. The Sentinel-2 grid

The grid is fixed to the Sentinel-2 training composite
(`Sentinel2_CSPlus_2024_01_H1.tif`): EPSG:32651 (UTM 51N), 10 m pixels, origin
(258690, 1841210), 571 × 494 px. It is tiled into 120 plots (12 columns × 10
rows) of 50 × 50 cells (500 m × 500 m). The last plot column and row are
partial; cells past the composite are greyed out and cannot be painted. The
constants live in `plot_grid.py` (Python) and `grid.js` (browser). The Paoay
boundary is drawn on the map for reference only.

No `.tif` file is needed. If you have the composite, you can check it matches:

```bash
python -c "import rasterio;s=rasterio.open('Sentinel2_CSPlus_2024_01_H1.tif');print(s.crs,s.transform,s.width,s.height)"
```

It should print EPSG:32651, origin (258690, 1841210), 10 m and 571 × 494.

### 2. Plot images

```bash
pip install -r requirements-dev.txt
python generate_plots.py                # all 120 plots + the data.js grid block
python generate_plots.py --only 0,13    # re-render a few plots
python generate_plots.py --skip-images  # only rewrite the data.js grid block
```

This fetches Esri World Imagery (zoom 18), caches tiles in `.tile-cache/`, and
warps them onto each plot's UTM square as `tiles/plots/plot_NNN.jpg`
(1000 × 1000, 0.5 m/px). It also rewrites the generated block at the top of
`data.js` (`GRID`, `PLOTS`). The images are committed; you only need to re-run
this if the grid changes. Esri's terms restrict bulk downloads; this is a
one-time, non-commercial render for this thesis app only.

`generate_tiles.py` is the legacy Tauri tile builder and now refuses to run,
because it would overwrite the Sentinel-2 grid in `data.js`.

### 3. Configure Supabase

Edit `config.js` with your Supabase project URL and anon key.

The repository owner runs `docs/supabase-foundation.sql` **once** in the
Supabase SQL Editor when this version deploys. It is **destructive**: it drops
and recreates `public.plots` and `public.seasons`, wiping all plot notes, photo
links and painted labels. Shared crop names in `public.crops` are kept (except
names that are now classes: carrot, cabbage, potato). Optionally run
`docs/supabase-foundation-smoke.sql` afterwards; it leaves no data behind.

The schema stores one row per season (plot + class + crop name or remark +
dates) in `public.seasons`. The app writes cells only through the atomic
`apply_season_cells` RPC, so two people editing the same plot never erase each
other's work. `clear_plot` and `delete_crop` are RPCs too.

### 4. Deploy to Vercel

Push to GitHub. Connect the repo in Vercel; no build settings are needed because
the app is static. Vercel deploys `main` automatically, so merge app changes
only after the matching Supabase script has been run.

## Local development

```bash
python -m http.server 8080
# Open http://localhost:8080/taniman.html
```

Tests:

```bash
node --test tests/*.test.mjs
python -m pytest tests/test_plot_grid.py
```

## Classes

| class_id | Class | Dates |
|---|---|---|
| 1 | Carrot | required |
| 2 | Cabbage | required |
| 3 | Potato | required |
| 4 | Other cultivated (needs a crop name from the shared list) | required |
| 5 | Forest / woody | default all year |
| 6 | Built-up | default all year |
| 7 | Bare / fallow | default all year |
| 8 | Grass / shrub | default all year |
| (none) | Other (needs a remark) | required |

Painting is blocked until the selection is complete. Nothing is selected when
the page loads.

## Data export

Use the "Save all (.zip)" button in the app footer. Exports:

- `seasons.csv` - the authoritative training labels, one row per season × cell:
  `plot_idx, season_id, field_id, class_id, class_name, crop_name, remark,
  start_mmdd, end_mmdd, wraps_year, s2_row, s2_col, utm_x, utm_y, center_lat,
  center_lng`. `s2_row`/`s2_col` index the Sentinel-2 composite pixel;
  `utm_x`/`utm_y` are the pixel center in EPSG:32651. `crop_name` is filled only
  for class 4 and `remark` only for Other.
- `fields.csv` - one row per field (4-connected cells sharing a season, across
  plot borders): `field_id, class_id, class_name, crop_name, remark, start_mmdd,
  end_mmdd, wraps_year, cell_count, plot_idxs` (`;`-joined).
- `classes.csv` - `class_id, key, class_name, hex`, plus one row per class-4
  crop name (`class_id=4`, `key=crop:<uuid>`).
- `plots.csv` - `plot_idx, plot_row, plot_col, valid_cols, valid_rows, note,
  photo_count, season_count`, one `class_<id>_cells` column per class, and
  `other_cells`.
- `metadata.json` - schema version 6 and the grid constants (CRS, origin, pixel
  size, width, height) so the pipeline can verify alignment.
- `labels/plotNNN.png` - color-coded label map per plot (unlabeled cells
  transparent, out-of-bounds cells `#404040`), and `photos/`.

Rows with an empty `class_id` are "Other": they are for review, not training.
Dates are recurring MM-DD ranges with no year; the pipeline chooses the year.
The pipeline's `config.yaml` must list grass/shrub as class 8 to match.

## Offline desktop build (Windows and macOS)

The Tauri desktop build is no longer maintained: it is not updated for the
Sentinel-2 grid, classes, or the new Supabase schema. The notes below are kept
for reference.

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
