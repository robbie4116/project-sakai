# Taniman - Ambassador Crop Map

Field data collection app for ground-truth crop mapping in Ambassador, Tublay, Benguet.

## Setup (one-time, before first deploy)

### 1. Generate tile assets

```bash
pip install rasterio Pillow numpy
python generate_tiles.py
```

Requires `tublay_satellite.tif` in the project root (not committed - ask a team member).

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
