# Taniman Digital Map Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the existing Taniman mockup into a fully offline-capable, Supabase-backed crop mapping app ready for field use on an iPad.

**Architecture:** Pure static web app (no build step) served from Vercel. Satellite imagery pre-generated from a local GeoTIFF into bundled JPEG tiles. Browser syncs plot data to Supabase in the background using a debounced, per-plot upsert strategy; localStorage provides instant offline restore.

**Tech Stack:** HTML/CSS/JS (vanilla), Leaflet 1.9.4, Supabase JS SDK v2, Python 3 + rasterio + Pillow (one-time asset generation only), Vercel (static hosting), Supabase (Postgres + Storage)

---

## Chunk 1: Project Scaffold, Vendor Bundling, HTML Updates

### Task 1: Create .gitignore and folder structure

**Files:**
- Create: `.gitignore`
- Create: `vendor/` (directory)
- Create: `fonts/` (directory)
- Create: `tiles/plots/` (directory)
- Create: `tiles/map/` (directory)

- [ ] **Step 1: Create .gitignore**

```
# Large satellite source files — run generate_tiles.py locally, commit output
tublay_satellite.tif
benguet_satellite.tif
Benguet_Sentinel2_Median.tif

# Python
__pycache__/
*.pyc
.venv/
```

Save as `.gitignore` at the project root.

- [ ] **Step 2: Create directory structure**

```bash
mkdir -p tiles/plots tiles/map vendor fonts
```

- [ ] **Step 3: Commit scaffold**

```bash
touch tiles/plots/.gitkeep tiles/map/.gitkeep vendor/.gitkeep fonts/.gitkeep
git add .gitignore tiles/plots/.gitkeep tiles/map/.gitkeep vendor/.gitkeep fonts/.gitkeep
git commit -m "chore: project scaffold, gitignore for source TIFs"
```

---

### Task 2: Download vendor JS/CSS dependencies locally

The app currently loads Leaflet, JSZip, and FileSaver from CDNs. For full offline use these must be local.

**Files:**
- Create: `vendor/leaflet.css`
- Create: `vendor/leaflet.js`
- Create: `vendor/jszip.min.js`
- Create: `vendor/FileSaver.min.js`

- [ ] **Step 1: Download Leaflet**

```bash
curl -L "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" -o vendor/leaflet.css
curl -L "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" -o vendor/leaflet.js
```

- [ ] **Step 2: Download Leaflet marker images** (Leaflet CSS references these)

```bash
mkdir -p vendor/images
curl -L "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png" -o vendor/images/marker-icon.png
curl -L "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png" -o vendor/images/marker-icon-2x.png
curl -L "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png" -o vendor/images/marker-shadow.png
```

Fix the image path in leaflet.css — after downloading, the CSS references `images/marker-icon.png` relative to itself. Since `vendor/leaflet.css` is in `vendor/`, the `images/` subfolder at `vendor/images/` is correct. Verify no path rewrite is needed by checking the CSS for `url(images/`:

```bash
grep "url(" vendor/leaflet.css
```

Expected output includes lines like `url(images/marker-icon.png)` — these resolve correctly with the `vendor/images/` subfolder.

- [ ] **Step 3: Download JSZip and FileSaver**

```bash
curl -L "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" -o vendor/jszip.min.js
curl -L "https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js" -o vendor/FileSaver.min.js
```

- [ ] **Step 4: Verify all four files are non-empty**

```bash
wc -c vendor/leaflet.css vendor/leaflet.js vendor/jszip.min.js vendor/FileSaver.min.js
```

Expected: all four show byte counts >10000. If any shows 0 or an error page, re-run that curl.

- [ ] **Step 5: Commit vendor files**

```bash
git add vendor/
git commit -m "chore: bundle Leaflet, JSZip, FileSaver locally for offline use"
```

---

### Task 3: Download and bundle fonts locally

The HTML currently loads IBM Plex Sans, IBM Plex Mono, and Fraunces from Google Fonts CDN.

**Files:**
- Create: `fonts/fonts.css`
- Create: `fonts/*.woff2` (one file per font weight/style)

- [ ] **Step 1: Download font files**

Download each woff2 file. The exact URLs come from Google Fonts CSS. Run:

```bash
# Get Google Fonts CSS for all three families
curl -A "Mozilla/5.0" "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" -o fonts/_google_fonts_response.css
```

- [ ] **Step 2: Extract and download woff2 URLs**

```bash
# Extract all woff2 URLs from the response
grep -oP "https://[^)']+" fonts/_google_fonts_response.css | grep woff2 > fonts/_urls.txt
cat fonts/_urls.txt
```

Expected: a list of ~15–20 woff2 URLs.

```bash
# Download each
while IFS= read -r url; do
  filename=$(basename "$url" | sed 's/?.*//')
  curl -L "$url" -o "fonts/${filename}"
done < fonts/_urls.txt
```

- [ ] **Step 3: Build fonts/fonts.css**

Copy the content of `fonts/_google_fonts_response.css`, then replace every `https://fonts.gstatic.com/...` URL with a relative path pointing to the downloaded file. The woff2 files downloaded in Step 2 have opaque hash-based filenames (e.g. `KFOmCnqEu92Fr1Mu4mxK.woff2`) — use the exact filenames from the downloaded files, not clean names. Run `ls fonts/*.woff2` to see the actual names, then substitute them in.

Example of what one `@font-face` block should look like after editing (your actual filename will differ):

```css
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 400;
  src: url(./KFOmCnqEu92Fr1Mu4mxK.woff2) format('woff2');
}
```

Save the edited content as `fonts/fonts.css`. Delete `fonts/_google_fonts_response.css` and `fonts/_urls.txt`.

- [ ] **Step 4: Verify font files downloaded**

```bash
ls -lh fonts/*.woff2 | wc -l
```

Expected: 15 or more woff2 files listed.

- [ ] **Step 5: Commit fonts**

```bash
git add fonts/
git commit -m "chore: bundle IBM Plex Sans, IBM Plex Mono, Fraunces fonts locally"
```

---

### Task 4: Update taniman.html — replace CDN refs, add new scripts

**Files:**
- Modify: `taniman.html`

The `<head>` of `taniman.html` currently has:
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=..." rel="stylesheet">
...
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"></script>
```

And the bottom of `<body>` currently has:
```html
<script src="data.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 1: Replace the CDN `<link>` and `<script>` tags in `<head>`**

Remove the three CDN link/preconnect lines and the three CDN script tags. Replace with:

```html
<link rel="stylesheet" href="vendor/leaflet.css">
<link rel="stylesheet" href="fonts/fonts.css">
```

And at the bottom of `<head>` (before `</head>`):

```html
<script src="vendor/leaflet.js"></script>
<script src="vendor/jszip.min.js"></script>
<script src="vendor/FileSaver.min.js"></script>
```

- [ ] **Step 2: Add Supabase SDK and new app scripts at the bottom of `<body>`**

The bottom of `<body>` currently ends with:
```html
<script src="data.js"></script>
<script src="app.js"></script>
```

Replace with:
```html
<script src="data.js"></script>
<script src="config.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="supabase-sync.js"></script>
<script src="app.js"></script>
```

`config.js` must load before `supabase-sync.js` because it sets `window.SUPABASE_URL` and `window.SUPABASE_ANON_KEY`. The Supabase SDK loads from CDN (only needed when online — graceful absence if offline). `supabase-sync.js` must load before `app.js` so its functions are available.

- [ ] **Step 3: Verify the HTML still has valid structure**

```bash
# Check that googleapis, cdnjs, and gstatic refs are removed
grep -n "googleapis\|cdnjs\|gstatic" taniman.html
```

Expected: no output. The `cdn.jsdelivr.net` Supabase SDK reference is intentionally present (loaded only when online) and is NOT checked by this grep.

- [ ] **Step 4: Commit HTML changes**

```bash
git add taniman.html
git commit -m "feat: replace CDN dependencies with local vendor/fonts for offline use"
```

---

## Chunk 2: Asset Pipeline (Python)

### Task 5: Install dependencies and validate TIF inputs

**Files:**
- Create: `requirements-dev.txt` (pipeline deps only — not deployed)

- [ ] **Step 1: Create requirements-dev.txt**

```
rasterio==1.4.3
Pillow==11.2.1
numpy==2.2.5
```

- [ ] **Step 2: Install**

```bash
pip install rasterio Pillow numpy
```

- [ ] **Step 3: Verify TIF is readable and has correct resolution**

```python
# Run as: python -c "..."
import rasterio, math

with rasterio.open("tublay_satellite.tif") as src:
    t = src.transform
    px_m = abs(t.a) * 111320 * math.cos(math.radians(16.48))
    print(f"Size: {src.width}x{src.height}  Bands: {src.count}  CRS: {src.crs}")
    print(f"Pixel size: ~{px_m:.2f} m")
    assert src.count >= 3, "Need at least 3 bands (RGB)"
    assert px_m < 3.0, f"Resolution too coarse: {px_m:.2f}m (expected ~1.15m)"
    print("OK")
```

Expected output:
```
Size: 11008x10496  Bands: 3  CRS: EPSG:4326
Pixel size: ~1.15 m
OK
```

- [ ] **Step 4: Commit requirements file**

```bash
git add requirements-dev.txt
git commit -m "chore: add dev requirements for tile generation pipeline"
```

---

### Task 6: Write and run generate_tiles.py

**Files:**
- Create: `generate_tiles.py`

- [ ] **Step 1: Write the script**

```python
"""
generate_tiles.py — one-time asset generation from tublay_satellite.tif

Outputs:
  tiles/plots/plot_000.jpg … plot_063.jpg  (64 cropped plot images)
  tiles/map/{z}/{x}/{y}.jpg               (XYZ tiles, zoom 12-16)
  tiles/map/empty.jpg                     (1×1 grey fallback tile)

Run: python generate_tiles.py
Requires: pip install rasterio Pillow numpy
"""

import math, os, struct
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling
from rasterio.crs import CRS

# ── CONFIG ────────────────────────────────────────────────────────────────────
SOURCE_TIF   = "tublay_satellite.tif"
PLOT_OUT_DIR = Path("tiles/plots")
MAP_OUT_DIR  = Path("tiles/map")
PLOT_SIZE    = 512          # px per side for plot crops
MAP_TILE_PX  = 256          # standard XYZ tile size
JPEG_QUALITY = 85
TILE_QUALITY = 80
MIN_ZOOM     = 12
MAX_ZOOM     = 16

# Ambassador bounding box + 20% padding (from data.js AMBASSADOR_PLOTS)
BBOX_N = 16.49551
BBOX_S = 16.46141
BBOX_E = 120.65667
BBOX_W = 120.62388
PAD    = 0.20
LAT_PAD = (BBOX_N - BBOX_S) * PAD
LNG_PAD = (BBOX_E - BBOX_W) * PAD
TILE_BBOX_N = BBOX_N + LAT_PAD
TILE_BBOX_S = BBOX_S - LAT_PAD
TILE_BBOX_E = BBOX_E + LNG_PAD
TILE_BBOX_W = BBOX_W - LNG_PAD

# 64 plots from data.js (matching AMBASSADOR_PLOTS order)
PLOTS = [
    {"idx": 0,  "latS": 16.491248, "latN": 16.49551,  "lngW": 120.62388,  "lngE": 120.627979},
    {"idx": 1,  "latS": 16.491248, "latN": 16.49551,  "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 2,  "latS": 16.491248, "latN": 16.49551,  "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 3,  "latS": 16.491248, "latN": 16.49551,  "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 4,  "latS": 16.491248, "latN": 16.49551,  "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 5,  "latS": 16.491248, "latN": 16.49551,  "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 6,  "latS": 16.491248, "latN": 16.49551,  "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 7,  "latS": 16.491248, "latN": 16.49551,  "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 8,  "latS": 16.486985, "latN": 16.491248, "lngW": 120.62388,  "lngE": 120.627979},
    {"idx": 9,  "latS": 16.486985, "latN": 16.491248, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 10, "latS": 16.486985, "latN": 16.491248, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 11, "latS": 16.486985, "latN": 16.491248, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 12, "latS": 16.486985, "latN": 16.491248, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 13, "latS": 16.486985, "latN": 16.491248, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 14, "latS": 16.486985, "latN": 16.491248, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 15, "latS": 16.486985, "latN": 16.491248, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 16, "latS": 16.482723, "latN": 16.486985, "lngW": 120.62388,  "lngE": 120.627979},
    {"idx": 17, "latS": 16.482723, "latN": 16.486985, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 18, "latS": 16.482723, "latN": 16.486985, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 19, "latS": 16.482723, "latN": 16.486985, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 20, "latS": 16.482723, "latN": 16.486985, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 21, "latS": 16.482723, "latN": 16.486985, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 22, "latS": 16.482723, "latN": 16.486985, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 23, "latS": 16.482723, "latN": 16.486985, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 24, "latS": 16.47846,  "latN": 16.482723, "lngW": 120.62388,  "lngE": 120.627979},
    {"idx": 25, "latS": 16.47846,  "latN": 16.482723, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 26, "latS": 16.47846,  "latN": 16.482723, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 27, "latS": 16.47846,  "latN": 16.482723, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 28, "latS": 16.47846,  "latN": 16.482723, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 29, "latS": 16.47846,  "latN": 16.482723, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 30, "latS": 16.47846,  "latN": 16.482723, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 31, "latS": 16.47846,  "latN": 16.482723, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 32, "latS": 16.474197, "latN": 16.47846,  "lngW": 120.62388,  "lngE": 120.627979},
    {"idx": 33, "latS": 16.474197, "latN": 16.47846,  "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 34, "latS": 16.474197, "latN": 16.47846,  "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 35, "latS": 16.474197, "latN": 16.47846,  "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 36, "latS": 16.474197, "latN": 16.47846,  "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 37, "latS": 16.474197, "latN": 16.47846,  "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 38, "latS": 16.474197, "latN": 16.47846,  "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 39, "latS": 16.474197, "latN": 16.47846,  "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 40, "latS": 16.469935, "latN": 16.474197, "lngW": 120.62388,  "lngE": 120.627979},
    {"idx": 41, "latS": 16.469935, "latN": 16.474197, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 42, "latS": 16.469935, "latN": 16.474197, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 43, "latS": 16.469935, "latN": 16.474197, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 44, "latS": 16.469935, "latN": 16.474197, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 45, "latS": 16.469935, "latN": 16.474197, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 46, "latS": 16.469935, "latN": 16.474197, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 47, "latS": 16.469935, "latN": 16.474197, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 48, "latS": 16.465673, "latN": 16.469935, "lngW": 120.62388,  "lngE": 120.627979},
    {"idx": 49, "latS": 16.465673, "latN": 16.469935, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 50, "latS": 16.465673, "latN": 16.469935, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 51, "latS": 16.465673, "latN": 16.469935, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 52, "latS": 16.465673, "latN": 16.469935, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 53, "latS": 16.465673, "latN": 16.469935, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 54, "latS": 16.465673, "latN": 16.469935, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 55, "latS": 16.465673, "latN": 16.469935, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 56, "latS": 16.46141,  "latN": 16.465673, "lngW": 120.62388,  "lngE": 120.627979},
    {"idx": 57, "latS": 16.46141,  "latN": 16.465673, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 58, "latS": 16.46141,  "latN": 16.465673, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 59, "latS": 16.46141,  "latN": 16.465673, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 60, "latS": 16.46141,  "latN": 16.465673, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 61, "latS": 16.46141,  "latN": 16.465673, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 62, "latS": 16.46141,  "latN": 16.465673, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 63, "latS": 16.46141,  "latN": 16.465673, "lngW": 120.652571, "lngE": 120.65667},
]

# ── HELPERS ───────────────────────────────────────────────────────────────────

def lat_lng_to_pixel(src, lat, lng):
    """Convert WGS84 lat/lng to pixel row/col in the source raster."""
    col, row = ~src.transform * (lng, lat)
    return int(row), int(col)

def crop_band(src, row0, col0, row1, col1):
    """Read a window from source, return numpy array (bands, h, w)."""
    from rasterio.windows import Window
    h = row1 - row0
    w = col1 - col0
    window = Window(col0, row0, w, h)
    return src.read(window=window)

def arr_to_pil(arr):
    """Convert (bands, h, w) uint8 array to PIL RGB Image."""
    rgb = np.stack([arr[0], arr[1], arr[2]], axis=2)
    return Image.fromarray(rgb.astype(np.uint8))

def deg2tile(lat, lng, zoom):
    """Return (x, y) tile coordinates for a lat/lng at given zoom."""
    n = 2 ** zoom
    x = int((lng + 180) / 360 * n)
    lat_r = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n)
    return x, y

def tile_bounds(x, y, zoom):
    """Return (lat_N, lat_S, lng_W, lng_E) for an XYZ tile."""
    n = 2 ** zoom
    lng_w = x / n * 360 - 180
    lng_e = (x + 1) / n * 360 - 180
    def merc_to_lat(merc_y):
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * merc_y / n))))
    lat_n = merc_to_lat(y)
    lat_s = merc_to_lat(y + 1)
    return lat_n, lat_s, lng_w, lng_e

# ── PART 1: PLOT CROPS ────────────────────────────────────────────────────────

def generate_plot_crops(src):
    # Note: tiles are sampled directly from the EPSG:4326 source raster by converting
    # lat/lng bounds to pixel coordinates. No reprojection to EPSG:3857 is performed.
    # At latitude ~16.5° and zoom 12-16, the distortion is <0.5% — acceptable.
    PLOT_OUT_DIR.mkdir(parents=True, exist_ok=True)
    for p in PLOTS:
        row0, col0 = lat_lng_to_pixel(src, p["latN"], p["lngW"])
        row1, col1 = lat_lng_to_pixel(src, p["latS"], p["lngE"])
        row0, row1 = max(0, min(row0, row1)), min(src.height, max(row0, row1))
        col0, col1 = max(0, min(col0, col1)), min(src.width, max(col0, col1))
        if row1 - row0 < 2 or col1 - col0 < 2:
            print(f"  WARNING: plot_{p['idx']:03d} has insufficient coverage in TIF — skipping")
            continue
        arr = crop_band(src, row0, col0, row1, col1)
        img = arr_to_pil(arr).resize((PLOT_SIZE, PLOT_SIZE), Image.LANCZOS)
        out = PLOT_OUT_DIR / f"plot_{p['idx']:03d}.jpg"
        img.save(out, "JPEG", quality=JPEG_QUALITY)
        print(f"  plot_{p['idx']:03d}.jpg  {img.size}")
    print(f"Done: {len(PLOTS)} plot images → {PLOT_OUT_DIR}/")

# ── PART 2: XYZ MAP TILES ─────────────────────────────────────────────────────

def generate_map_tiles(src):
    MAP_OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Empty tile fallback (1×1 grey)
    empty = Image.new("RGB", (MAP_TILE_PX, MAP_TILE_PX), color=(80, 80, 80))
    empty.save(MAP_OUT_DIR / "empty.jpg", "JPEG", quality=60)

    total = 0
    for zoom in range(MIN_ZOOM, MAX_ZOOM + 1):
        x0, y0 = deg2tile(TILE_BBOX_N, TILE_BBOX_W, zoom)
        x1, y1 = deg2tile(TILE_BBOX_S, TILE_BBOX_E, zoom)
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        count = (x1 - x0 + 1) * (y1 - y0 + 1)
        print(f"Zoom {zoom}: x {x0}–{x1}, y {y0}–{y1}  ({count} tiles)")
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                out_path = MAP_OUT_DIR / str(zoom) / str(tx) / f"{ty}.jpg"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                lat_n, lat_s, lng_w, lng_e = tile_bounds(tx, ty, zoom)
                r0, c0 = lat_lng_to_pixel(src, lat_n, lng_w)
                r1, c1 = lat_lng_to_pixel(src, lat_s, lng_e)
                r0, r1 = max(0, min(r0, r1)), min(src.height, max(r0, r1))
                c0, c1 = max(0, min(c0, c1)), min(src.width, max(c0, c1))
                if r1 - r0 < 2 or c1 - c0 < 2:
                    empty.save(out_path, "JPEG", quality=TILE_QUALITY)
                    continue
                arr = crop_band(src, r0, c0, r1, c1)
                img = arr_to_pil(arr).resize((MAP_TILE_PX, MAP_TILE_PX), Image.LANCZOS)
                img.save(out_path, "JPEG", quality=TILE_QUALITY)
                total += 1
    print(f"Done: {total} map tiles → {MAP_OUT_DIR}/")

# ── MAIN ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Opening {SOURCE_TIF}...")
    with rasterio.open(SOURCE_TIF) as src:
        print(f"  {src.width}×{src.height} px, {src.count} bands, CRS={src.crs}")
        print("\n── Generating plot crops ──")
        generate_plot_crops(src)
        print("\n── Generating map tiles ──")
        generate_map_tiles(src)
    print("\nAll done. Commit the tiles/ directory.")
```

- [ ] **Step 2: Run the script**

```bash
python generate_tiles.py
```

Expected output (will take 2–5 minutes):
```
Opening tublay_satellite.tif...
  11008×10496 px, 3 bands, CRS=EPSG:4326

── Generating plot crops ──
  plot_000.jpg  (512, 512)
  plot_001.jpg  (512, 512)
  ...
  plot_063.jpg  (512, 512)
Done: 64 plot images → tiles/plots/

── Generating map tiles ──
Zoom 12: x ...  (N tiles)
...
Done: ~350 map tiles → tiles/map/

All done. Commit the tiles/ directory.
```

- [ ] **Step 3: Verify output**

```bash
# 64 plot images (warn if any were skipped due to TIF coverage gaps)
ls tiles/plots/*.jpg | wc -l
# Expected: 64

# map tiles exist across zoom levels
ls tiles/map/
# Expected: directories 12 13 14 15 16 plus empty.jpg

# Tile count per zoom level
for z in 12 13 14 15 16; do
  count=$(find tiles/map/$z -name "*.jpg" | wc -l)
  echo "zoom $z: $count tiles"
done
# Expected: zoom 12: ~1-4, zoom 13: ~4-16, zoom 14: ~16-50, zoom 15: ~50-200, zoom 16: ~200-800
# Total across all levels: 300–500 tiles
find tiles/map -name "*.jpg" | wc -l

# Check one plot image dimensions (PIL)
python -c "from PIL import Image; img=Image.open('tiles/plots/plot_000.jpg'); print(img.size)"
# Expected: (512, 512)

# Total size sanity check
du -sh tiles/
# Expected: 5–25 MB
```

- [ ] **Step 4: Commit tiles**

```bash
git add tiles/ generate_tiles.py
git commit -m "feat: add pre-generated satellite tiles for offline use"
```

---

## Chunk 3: app.js Modifications

### Task 7: Replace procedural tile generator with local JPEG loading

**Files:**
- Modify: `app.js`

The current `getTile(idx)` function generates a fake procedural canvas. Replace it and its dependencies.

- [ ] **Step 1: Remove the procedural tile functions**

Delete the following functions entirely from `app.js`:
- `makeProceduralTile(idx)` (lines ~391–447)
- `mulberry32(a)` (line ~448)

- [ ] **Step 2: Replace `getTile(idx)` with image loader**

Find:
```js
function getTile(idx){
  if (!imgCache[idx]) imgCache[idx] = makeProceduralTile(idx);
  return imgCache[idx];
}
```

Replace with:
```js
function getTile(idx) {
  if (!imgCache[idx]) {
    const img = new Image();
    img.onload = () => renderCanvas();
    img.src = `tiles/plots/plot_${String(idx).padStart(3, '0')}.jpg`;
    imgCache[idx] = img;
  }
  return imgCache[idx];
}
```

- [ ] **Step 3: Guard renderCanvas against incomplete image**

First check whether a guard already exists:
```bash
grep -n "complete\|naturalWidth" app.js
```
Expected: no output (the guard does not exist yet). If it already exists, skip this step.

In `renderCanvas()`, find the line:
```js
const tile = getTile(state.plotIdx);
ctx.drawImage(tile, 0, 0, w, h);
```

Replace with:
```js
const tile = getTile(state.plotIdx);
if (tile.complete && tile.naturalWidth > 0) {
  ctx.drawImage(tile, 0, 0, w, h);
} else {
  ctx.fillStyle = getCss('--canvas-bg');
  ctx.fillRect(0, 0, w, h);
}
```

- [ ] **Step 4: Verify in browser**

Open `taniman.html` in a browser via a local server:
```bash
python -m http.server 8080
```
Navigate to `http://localhost:8080/taniman.html`. Click any plot on the map. The canvas editor should show a real satellite image (green/brown terrain, visible terraces) instead of the procedural greenish noise pattern. Confirm for at least plots 0, 27, and 63.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: load real satellite imagery for plot canvas backgrounds"
```

---

### Task 8: Switch Leaflet overview map to local offline tiles

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace `makeTileLayer()` in app.js**

Find this existing function (use `grep -n "makeTileLayer" app.js` to confirm line numbers):
```js
function makeTileLayer(){
  const t = state.theme;
  // Esri World Imagery — free for non-commercial; matches "satellite view"
  // For dark theme we layer a Carto dark labels on top; light/contrast use Esri only
  const sat = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: '' }
  );
  const labels = L.tileLayer(
    'https://stamen-tiles.a.ssl.fastly.net/toner-labels/{z}/{x}/{y}.png',
    { maxZoom: 18, opacity: t==='dark' ? 0.6 : 0.55, errorTileUrl: '' }
  );
  // Group as a layerGroup so caller can remove cleanly
  const g = L.layerGroup([sat]);
  return g;
}
```

Replace the entire function with:

```js
function makeTileLayer() {
  return L.tileLayer('tiles/map/{z}/{x}/{y}.jpg', {
    minZoom: 12,
    maxZoom: 16,
    errorTileUrl: 'tiles/map/empty.jpg',
    attribution: 'Imagery © Map Tiles API',
  });
}
```

- [ ] **Step 2: Verify in browser**

Reload `http://localhost:8080/taniman.html`. The left-hand Leaflet map should display satellite imagery of the Ambassador area from local tiles rather than from the ESRI CDN. Zoom in and out between zoom 12 and 16. At zoom 16 individual roads and buildings should be visible.

To confirm no network requests are made to ESRI: open browser DevTools → Network tab → filter by `arcgisonline` — there should be zero requests.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: switch Leaflet overview map to local offline tiles"
```

---

### Task 9: Implement redo

**Files:**
- Modify: `app.js`

The `btn-redo` element exists in `taniman.html` but `app.js` has no redo logic.

- [ ] **Step 1: Add redoStack alongside undoStack**

Find:
```js
const undoStack = [];
const UNDO_LIMIT = 50;
```

Replace with:
```js
const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 50;
```

- [ ] **Step 2: Clear redoStack on new paint (snapshotForUndo)**

Find:
```js
function snapshotForUndo(idx){
  const p = state.plots[idx];
  const labels = p && p.labels ? new Uint8Array(p.labels) : null;
  undoStack.push({ plotIdx: idx, labels });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  updateUndoBtn();
}
```

Replace with:
```js
function snapshotForUndo(idx) {
  const p = state.plots[idx];
  const labels = p && p.labels ? new Uint8Array(p.labels) : null;
  undoStack.push({ plotIdx: idx, labels });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoBtn();
}
```

- [ ] **Step 3: Push to redoStack in undo(), implement redo()**

Find the `undo()` function. After the line `const entry = undoStack.pop();` and before `if (!entry) {`, add a redo-snapshot push. Replace the full `undo()` function:

```js
function undo() {
  const entry = undoStack.pop();
  if (!entry) { updateUndoBtn(); return; }
  // snapshot current state for redo before restoring
  const cur = state.plots[entry.plotIdx];
  redoStack.push({
    plotIdx: entry.plotIdx,
    labels: cur && cur.labels ? new Uint8Array(cur.labels) : null,
  });
  if (!state.plots[entry.plotIdx]) {
    state.plots[entry.plotIdx] = { labels: new Uint8Array(GRID * GRID), farmer: '', note: '', photo: null };
  }
  state.plots[entry.plotIdx].labels = entry.labels || new Uint8Array(GRID * GRID);
  if (state.plotIdx !== entry.plotIdx) {
    state.plotIdx = entry.plotIdx;
    updatePlotHeader();
    drawPlotsOnMap();
  } else {
    updateMapPlot(entry.plotIdx);
  }
  renderCanvas();
  updateProgress();
  refreshMetaToggle();
  schedSave(entry.plotIdx);
  updateUndoBtn();
  toast(tr('undone'));
}
```

Add `redo()` immediately after `undo()`:

```js
function redo() {
  const entry = redoStack.pop();
  if (!entry) { updateUndoBtn(); return; }
  const cur = state.plots[entry.plotIdx];
  undoStack.push({
    plotIdx: entry.plotIdx,
    labels: cur && cur.labels ? new Uint8Array(cur.labels) : null,
  });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  if (!state.plots[entry.plotIdx]) {
    state.plots[entry.plotIdx] = { labels: new Uint8Array(GRID * GRID), farmer: '', note: '', photo: null };
  }
  state.plots[entry.plotIdx].labels = entry.labels || new Uint8Array(GRID * GRID);
  if (state.plotIdx !== entry.plotIdx) {
    state.plotIdx = entry.plotIdx;
    updatePlotHeader();
    drawPlotsOnMap();
  } else {
    updateMapPlot(entry.plotIdx);
  }
  renderCanvas();
  updateProgress();
  refreshMetaToggle();
  schedSave(entry.plotIdx);
  updateUndoBtn();
}
```

- [ ] **Step 4: Verify btn-redo exists in taniman.html, then wire it**

```bash
grep -n "btn-redo" taniman.html
```
Expected: at least one line showing `id="btn-redo"`. If missing, the redo button needs to be added to the HTML alongside `btn-undo`.

Add `updateUndoBtn` toggle and wire `btn-redo`:

Find:
```js
function updateUndoBtn(){
  const btn = document.getElementById('btn-undo');
  if (!btn) return;
  btn.disabled = undoStack.length === 0;
}
```

Replace with:
```js
function updateUndoBtn() {
  const undo = document.getElementById('btn-undo');
  const redo = document.getElementById('btn-redo');
  if (undo) undo.disabled = undoStack.length === 0;
  if (redo) redo.disabled = redoStack.length === 0;
}
```

Find:
```js
document.getElementById('btn-undo').onclick = undo;
```

Add immediately after:
```js
document.getElementById('btn-redo').onclick = redo;
```

- [ ] **Step 5: Add Ctrl+Y / Ctrl+Shift+Z keyboard shortcut**

Find the keydown handler block that contains the undo shortcut:
```js
if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')){
  e.preventDefault(); undo(); return;
}
```

Insert the following **before** that existing undo block (so redo shortcuts are checked first and the `return` in the undo block cannot shadow them):

```js
if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
  e.preventDefault(); redo(); return;
}
if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
  e.preventDefault(); redo(); return;
}
```

- [ ] **Step 6: Verify in browser**

Open the app. Paint some cells. Press Ctrl+Z — cells should disappear. Press Ctrl+Y or Ctrl+Shift+Z — cells should reappear. The redo button (↷) should enable/disable appropriately.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: implement redo with Ctrl+Y / Ctrl+Shift+Z"
```

---

## Chunk 4: Supabase Setup + Sync Module + Deployment

### Task 10: Set up Supabase project (dashboard + SQL)

This task is performed in the Supabase dashboard, not in code. Complete it before Task 11 so you have the real credentials to write into `config.js`.

- [ ] **Step 1: Create Supabase project**

Go to [supabase.com](https://supabase.com) → New project. Region: Southeast Asia (Singapore). Once created, go to Settings → API and copy the **Project URL** and **anon public key** — you will need them in Task 11.

- [ ] **Step 2: Create `plots` table**

In the Supabase SQL editor, run:

```sql
create table public.plots (
  plot_idx   integer primary key,
  labels     integer[] not null default '{}',
  farmer     text      not null default '',
  note       text      not null default '',
  photo_url  text,
  device_id  text      not null default '',
  updated_at timestamptz not null default now()
);

alter table public.plots enable row level security;

create policy "public_read_write" on public.plots
  for all
  using (true)
  with check (true);
```

- [ ] **Step 3: Create Storage bucket for photos**

Run this SQL in the Supabase SQL editor (this is sufficient — do not also create the bucket via the dashboard UI, to avoid a duplicate conflict):

```sql
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict do nothing;

create policy "public_photo_upload" on storage.objects
  for insert with check (bucket_id = 'photos');

create policy "public_photo_read" on storage.objects
  for select using (bucket_id = 'photos');
```

- [ ] **Step 4: Verify**

In the Supabase Table Editor, confirm `plots` table exists with columns: `plot_idx`, `labels`, `farmer`, `note`, `photo_url`, `device_id`, `updated_at`. In Storage, confirm the `photos` bucket is listed.

---

### Task 11: Create config.js with real Supabase credentials

**Files:**
- Create: `config.js`

- [ ] **Step 1: Write config.js** (use the URL and key from Task 10 Step 1)

```js
// Supabase project credentials.
// The anon key is safe to commit — access is controlled by Row Level Security policies.
window.SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';
window.SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

Replace `YOUR_PROJECT_ID` and `YOUR_ANON_KEY` with the actual values from the Supabase dashboard.

- [ ] **Step 2: Commit**

```bash
git add config.js
git commit -m "feat: add Supabase config (anon key — intentionally public per RLS design)"
```

---

### Task 12: Write supabase-sync.js

**Files:**
- Create: `supabase-sync.js`

This module is loaded after `config.js` and the Supabase SDK, and before `app.js`. It exposes four functions on `window`:

- [ ] **Step 1: Write supabase-sync.js**

```js
// supabase-sync.js
// Handles all Supabase read/write. Exposes: syncInit, syncPlots, syncOnNavigate, uploadPhoto.
// Loaded before app.js. Falls back silently if Supabase SDK is unavailable (offline).

(function () {
  'use strict';

  let db = null;

  function isOnline() {
    return navigator.onLine && typeof supabase !== 'undefined';
  }

  function initClient() {
    if (db) return db;
    if (typeof supabase === 'undefined') return null;
    db = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return db;
  }

  // Convert app state plot object → Supabase row
  function plotToRow(idx, plotData, deviceId) {
    return {
      plot_idx:   idx,
      labels:     plotData.labels ? Array.from(plotData.labels) : [],
      farmer:     plotData.farmer  || '',
      note:       plotData.note    || '',
      photo_url:  plotData.photo_url || null,
      device_id:  deviceId,
      updated_at: new Date().toISOString(),
    };
  }

  // Convert Supabase row → app state plot object
  function rowToPlot(row) {
    return {
      labels:    new Uint8Array(row.labels || []),
      farmer:    row.farmer    || '',
      note:      row.note      || '',
      photo_url: row.photo_url || null,
      photo:     null,   // base64 legacy field — not stored remotely
      _synced_at: row.updated_at,
    };
  }

  /**
   * syncInit — called on app start.
   * Fetches all plot rows from Supabase and merges with current in-memory state.
   * Newer updated_at wins per plot. Calls onMerge(plotIdx, plotData) for each
   * plot that was updated from remote.
   */
  window.syncInit = async function (state, onMerge) {
    if (!isOnline()) return;
    const client = initClient();
    if (!client) return;
    try {
      const { data, error } = await client.from('plots').select('*');
      if (error) { console.warn('syncInit fetch error:', error.message); return; }
      for (const row of data) {
        const local = state.plots[row.plot_idx];
        const localTs = local && local._synced_at ? new Date(local._synced_at) : new Date(0);
        const remoteTs = new Date(row.updated_at);
        if (remoteTs > localTs) {
          state.plots[row.plot_idx] = rowToPlot(row);
          onMerge(row.plot_idx);
        }
      }
    } catch (e) {
      console.warn('syncInit error:', e);
    }
  };

  /**
   * syncPlots — batch-upserts the given plot indices.
   * Called by the cloud save scheduler with the set of dirty plots.
   */
  window.syncPlots = async function (indices, state, deviceId) {
    if (!isOnline()) return;
    const client = initClient();
    if (!client) return;
    const rows = indices
      .filter(idx => state.plots[idx])
      .map(idx => plotToRow(idx, state.plots[idx], deviceId));
    if (!rows.length) return;
    try {
      const { error } = await client
        .from('plots')
        .upsert(rows, { onConflict: 'plot_idx' });
      if (error) console.warn('syncPlots error:', error.message);
      else {
        // stamp local entries so future merges know what's synced
        for (const row of rows) {
          if (state.plots[row.plot_idx]) {
            state.plots[row.plot_idx]._synced_at = row.updated_at;
          }
        }
      }
    } catch (e) {
      console.warn('syncPlots error:', e);
    }
  };

  /**
   * syncOnNavigate — fetches a single plot row when the user navigates to it.
   * If the remote version is newer, overwrites local and calls onMerge(idx).
   * Any network failure is silently swallowed — local state is kept.
   */
  window.syncOnNavigate = async function (idx, state, onMerge) {
    if (!isOnline()) return;
    const client = initClient();
    if (!client) return;
    try {
      const { data, error } = await client
        .from('plots')
        .select('*')
        .eq('plot_idx', idx)
        .maybeSingle();
      if (error || !data) return;
      const local = state.plots[idx];
      const localTs = local && local._synced_at ? new Date(local._synced_at) : new Date(0);
      const remoteTs = new Date(data.updated_at);
      if (remoteTs > localTs) {
        state.plots[idx] = rowToPlot(data);
        onMerge(idx);
      }
    } catch (e) {
      // silently ignore — keep local state
    }
  };

  /**
   * uploadPhoto — uploads a base64 JPEG to Supabase Storage.
   * Returns the public URL, or null on failure.
   */
  window.uploadPhoto = async function (plotIdx, dataUrl) {
    if (!isOnline()) return null;
    const client = initClient();
    if (!client) return null;
    try {
      const base64 = dataUrl.split(',')[1];
      const byteStr = atob(base64);
      const ab = new ArrayBuffer(byteStr.length);
      const ua = new Uint8Array(ab);
      for (let i = 0; i < byteStr.length; i++) ua[i] = byteStr.charCodeAt(i);
      const blob = new Blob([ab], { type: 'image/jpeg' });
      const path = `plot_${String(plotIdx).padStart(3, '0')}.jpg`;
      const { error } = await client.storage.from('photos').upload(path, blob, {
        upsert: true,
        contentType: 'image/jpeg',
      });
      if (error) { console.warn('uploadPhoto error:', error.message); return null; }
      const { data } = client.storage.from('photos').getPublicUrl(path);
      return data.publicUrl;
    } catch (e) {
      console.warn('uploadPhoto error:', e);
      return null;
    }
  };

})();
```

- [ ] **Step 2: Commit**

```bash
git add supabase-sync.js
git commit -m "feat: add supabase-sync module (syncInit, syncPlots, syncOnNavigate, uploadPhoto)"
```

---

### Task 13: Wire sync into app.js

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add device ID generation near the top of app.js**

After the `const PLOTS = ...` declarations, add:

```js
// Persistent device identifier — stored in localStorage, travels with all upserts
function getDeviceId() {
  let id = localStorage.getItem('taniman_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
    localStorage.setItem('taniman_device_id', id);
  }
  return id;
}
const DEVICE_ID = getDeviceId();
```

- [ ] **Step 2: Replace schedSave with two-tier save scheduler**

Find the current `schedSave` and its timer variable:

```js
let saveTimer = null;
function schedSave(idx) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
}
```

Replace with:

```js
let saveTimer = null;
let cloudSaveTimer = null;
const dirtyPlots = new Set();

function schedSave(idx) {
  // tier 1 — local, fast
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);

  // tier 2 — cloud, batched
  if (idx !== undefined) dirtyPlots.add(idx);
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async () => {
    if (dirtyPlots.size && typeof syncPlots === 'function') {
      await syncPlots([...dirtyPlots], state, DEVICE_ID);
    }
    dirtyPlots.clear();
  }, 5000);
}
```

- [ ] **Step 3: Update all schedSave call sites to pass plot index**

First confirm the parameter name used in `openPlot`:
```bash
grep -n "function openPlot" app.js
```
Expected: `function openPlot(idx){` — use whatever parameter name is shown (likely `idx`).

Find every call to `schedSave()` in `app.js` and update to pass the relevant index. The call sites are:

- In `paintAt()`: `schedSave();` → `schedSave(state.plotIdx);`
- In `undo()`: `schedSave(entry.plotIdx);` ← already updated in Task 9
- In `redo()`: `schedSave(entry.plotIdx);` ← already updated in Task 9
- In `openPlot()`: `schedSave();` → `schedSave(idx);` (use actual parameter name from grep above)
- In metadata input handlers (`in-farmer`, `in-note`): `schedSave();` → `schedSave(state.plotIdx);`
- In `btn-clear` click handler: leave as `saveState()` (not schedSave — this is a forced immediate save after clear)
- In theme/lang/brush/mix button handlers: leave as `saveState()` (settings only, no plot index)

- [ ] **Step 4: Add syncInit call at app startup**

At the very end of `app.js`, after all the existing init calls, add:

```js
// Cloud sync on startup — fetch any newer data from other devices
if (typeof syncInit === 'function') {
  syncInit(state, (plotIdx) => {
    updateMapPlot(plotIdx);
    if (plotIdx === state.plotIdx) renderCanvas();
    updateProgress();
  });
}
```

- [ ] **Step 5: Add syncOnNavigate call in openPlot()**

In `openPlot(idx)`, at the end of the function (after `refreshMetaToggle()` and before `schedSave(idx)`), add.

Note on sequencing: `syncOnNavigate` is async — it resolves after `schedSave(idx)` has already queued a local save. If the remote version is newer and overwrites local state, the queued local save (400ms later) will re-upload the now-correct merged state, which is fine. The 5s cloud sync fires after that, also with the correct state. This is acceptable for a field app with no concurrent real-time edits.

```js
if (typeof syncOnNavigate === 'function') {
  syncOnNavigate(idx, state, (updatedIdx) => {
    loadMetadataIntoDrawer();
    renderCanvas();
    updateMapPlot(updatedIdx);
    refreshMetaToggle();
  });
}
```

- [ ] **Step 6: Update photo capture to use Supabase Storage**

Find the `in-photo` change handler. Currently it ends with:
```js
getPlotData(state.plotIdx).photo = small;
renderPhoto(small);
schedSave(); refreshMetaToggle();
```

Replace with:
```js
const plotData = getPlotData(state.plotIdx);
// Store base64 locally as legacy fallback
plotData.photo = small;
renderPhoto(small);
schedSave(state.plotIdx);
refreshMetaToggle();
// Upload to Storage in background; replace local base64 with URL when done
if (typeof uploadPhoto === 'function') {
  uploadPhoto(state.plotIdx, small).then(url => {
    if (url) {
      plotData.photo_url = url;
      plotData.photo = null;   // free localStorage space
      schedSave(state.plotIdx);
    }
  });
}
```

- [ ] **Step 7: Update renderPhoto to handle both photo and photo_url**

Find `loadMetadataIntoDrawer()`:
```js
function loadMetadataIntoDrawer(){
  const p = getPlotData(state.plotIdx);
  document.getElementById('in-farmer').value = p.farmer || '';
  document.getElementById('in-note').value = p.note || '';
  renderPhoto(p.photo);
}
```

Replace with:
```js
function loadMetadataIntoDrawer() {
  const p = getPlotData(state.plotIdx);
  document.getElementById('in-farmer').value = p.farmer || '';
  document.getElementById('in-note').value = p.note || '';
  renderPhoto(p.photo_url || p.photo || null);
}
```

- [ ] **Step 8: Verify sync in browser**

Open `http://localhost:8080/taniman.html`. Open browser DevTools → Network tab. Paint on plot 5. Wait 6 seconds. A POST/PATCH request to `*.supabase.co` should appear in the Network tab. In the Supabase dashboard → Table Editor → `plots`, a row for `plot_idx = 5` should be visible with a non-empty `labels` array.

- [ ] **Step 9: Commit**

```bash
git add app.js
git commit -m "feat: wire Supabase sync — device ID, two-tier save, startup merge, per-navigate fetch"
```

---

### Task 14: Vercel deployment

**Files:**
- Create: `vercel.json`
- Create: `README.md`

- [ ] **Step 1: Create vercel.json**

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/tiles/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/vendor/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/fonts/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

This tells Vercel to cache tile/vendor/font assets for 1 year (they never change after generation).

- [ ] **Step 2: Create README.md**

```markdown
# Taniman — Ambassador Crop Map

Field data collection app for ground-truth crop mapping in Ambassador, Tublay, Benguet.

## Setup (one-time, before first deploy)

### 1. Generate tile assets

```bash
pip install rasterio Pillow numpy
python generate_tiles.py
```

Requires `tublay_satellite.tif` in the project root (not committed — ask a team member).

### 2. Configure Supabase

Edit `config.js` with your Supabase project URL and anon key.

Run the SQL in `docs/supabase-setup.sql` in the Supabase SQL editor.

### 3. Deploy to Vercel

Push to GitHub. Connect the repo in Vercel — no build settings needed, it's a static site.

## Local development

```bash
python -m http.server 8080
# Open http://localhost:8080/taniman.html
```

## Data export

Use the "Save all (.zip)" button in the app footer. Exports:
- `labels/plot_NNN.png` — colour-coded label map per plot
- `labels.csv` — per-cell crop assignments
- `metadata.json` — farmer names, notes, plot coordinates
```

- [ ] **Step 3: Create docs/supabase-setup.sql**

The `docs/` directory already exists (created during brainstorming). Create `docs/supabase-setup.sql` containing the SQL from Task 10 Steps 2 and 3, so it's easy to re-run on a fresh Supabase project.

- [ ] **Step 4: Push to GitHub and deploy**

```bash
git add vercel.json README.md docs/supabase-setup.sql
git commit -m "chore: Vercel config, README, Supabase setup SQL"
# Add remote only if none exists
git remote -v
# If no remote is shown, run:
# git remote add origin https://github.com/robbie4116/thesis-digital-map.git
git push -u origin main
```

Then in [vercel.com](https://vercel.com): Import project → select the GitHub repo → Deploy. No build settings needed.

- [ ] **Step 5: Verify deployed app**

Open the Vercel URL. Confirm:
1. Map loads with satellite imagery (local tiles)
2. Clicking a plot shows real satellite imagery in the canvas
3. Painting cells and waiting 6s creates a row in the Supabase `plots` table
4. Hard-refreshing the page restores painted cells from localStorage
5. In Supabase Storage → `photos`, upload test works via the photo button in the metadata drawer

- [ ] **Step 6: Offline smoke test**

In the browser, open DevTools → Network → select "Offline" from the throttling dropdown. Hard-refresh the page. Confirm:
- The map tiles load from local files (satellite image visible, no blank grey tiles)
- Fonts render correctly (IBM Plex Sans / Fraunces visible, no system fallback)
- The canvas background loads when clicking a plot
- Painting works and the autosave indicator shows "Auto-saved"
- No console errors about failed network requests (the Supabase SDK failing silently is expected and acceptable)

Re-enable network when done.

- [ ] **Step 7: Final commit**

```bash
git add vercel.json README.md docs/
git commit -m "chore: final cleanup after verified Vercel deploy"
git push
```
