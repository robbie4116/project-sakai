# Taniman - Ambassador Crop Map

Field data collection app for ground-truth crop mapping in Ambassador, Tublay, Benguet.

## Setup (one-time, before first deploy)

### 1. Generate tile assets

```bash
pip install rasterio Pillow numpy
python generate_tiles.py
```

Requires these source rasters in the project root (not committed - ask a team member):

- `tublay_satellite.tif` — high-detail plot crops and Ambassador/Tublay detail map tiles
- `benguet_satellite.tif` — wider low-zoom satellite context map tiles

Tile outputs:

- `tiles/plots/` — plot crop JPEGs used by the labeling canvas
- `tiles/map/` — high-detail offline map tiles for the Ambassador work area
- `tiles/context/` — wider low-zoom offline satellite context tiles for zoomed-out orientation

### 2. Configure Supabase

Edit `config.js` with your Supabase project URL and anon key.

Run the SQL in `docs/supabase-setup.sql` in the Supabase SQL editor.

### 3. Deploy to Vercel

Push to GitHub. Connect the repo in Vercel - no build settings needed, it's a static site.

## Local development

```bash
python -m http.server 8080
# Open http://localhost:8080/taniman.html
```

## Data export

Use the "Save all (.zip)" button in the app footer. Exports:
- `labels/plot_NNN.png` - colour-coded label map per plot
- `labels.csv` - per-cell crop assignments
- `metadata.json` - farmer names, notes, plot coordinates

## Offline desktop build (Windows and macOS)

The repo can be built as a standalone offline field app with Tauri.

### One-time setup
1. Install [Rust via rustup](https://rustup.rs/).
2. Install Node 18+ (any LTS).
3. From `src-tauri/`: `npm install`.

### Build
From `src-tauri/`:
- `npm run dev`    — hot-reload dev window
- `npm run build`  — produces `target/release/Taniman.exe`

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
