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
