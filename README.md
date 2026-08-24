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
Paoay is the only plotting boundary.

### 2. Generate tile assets

```bash
pip install rasterio Pillow numpy
python generate_tiles.py
```

Requires these source rasters in the project root (not committed):

- `atok_satellite.tif` - high-detail Atok satellite raster for offline map tiles and Paoay plot crops
- `benguet_satellite.tif` - wider low-zoom satellite context map tiles

Tile outputs:

- `tiles/plots/` - generated Paoay plot crop JPEGs used by the labeling canvas
- `tiles/map/` - high-detail offline Atok map tiles
- `tiles/context/` - wider low-zoom offline satellite context tiles for zoomed-out orientation

After tile generation, the static web app and downloadable Tauri app can render
Atok/Paoay locally. Plotting is fixed to the generated Paoay plots only; there
is no Add Plot workflow.

### 3. Configure Supabase

Edit `config.js` with your Supabase project URL and anon key.

Run the SQL in `docs/supabase-setup.sql` in the Supabase SQL editor. This drops
and recreates the `plots` table, which wipes existing plot rows and replaces the
old crop-month cell schema with `seasons jsonb`.

### Reset Supabase for season schema

1. Open Supabase Dashboard.
2. Select the project used by `config.js`.
3. Open SQL Editor.
4. Paste the full contents of `docs/supabase-setup.sql`.
5. Run it. This wipes existing plot rows.
6. Reload the deployed app.

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
- `labels/plot_NNN.png` - color-coded label map per plot
- `labels.csv` - compatibility per-season/cell labels with crop names
- `plots.csv` - Paoay plot metadata and season row counts
- `farmers.csv` - farmer IDs and plot lists
- `metadata.json` - schema version, recurring annual date encoding, Sentinel-2
  alignment notes, farmer names, notes, plot coordinates, and crop summaries

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
