"""Render Sentinel-2 aligned plot images and write the grid block in data.js.

Usage:
    python generate_plots.py                # all 120 plots + data.js
    python generate_plots.py --only 0,13    # re-render a few plots (data.js still rewritten)
    python generate_plots.py --skip-images  # only rewrite data.js

Fetches Esri World Imagery tiles (zoom 18, ~0.57 m/px) once, caches them in
.tile-cache/, and warps them onto each 500 m UTM plot at 0.5 m/px (1000x1000).
Esri's terms restrict bulk downloads; this is a one-time, non-commercial render
for the thesis app only.
"""
import argparse
import math
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject, transform_bounds

import plot_grid
from generate_tiles import (
    ATOK_BOUNDARY_PATH,
    DATA_JS_PATH,
    PAOAY_BOUNDARY_PATH,
    geometry_to_latlng_poly,
    js_assignment,
    load_feature,
)

ESRI_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
ZOOM = 18
TILE_PX = 256
OUT_PX = 1000
OUT_RES_M = plot_grid.PLOT_M / OUT_PX
MARGIN_M = 20
JPEG_QUALITY = 80
CACHE_DIR = Path(".tile-cache")
PLOT_OUT_DIR = Path("tiles/plots")
HEADERS = {"User-Agent": "taniman-thesis-plot-renderer/1.0 (one-time non-commercial render)"}
MERC_HALF = 20037508.342789244


def lnglat_to_tile(lng: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    x = (lng + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def tile_top_left_merc(x: int, y: int, z: int) -> tuple[float, float, float]:
    size = 2 * MERC_HALF / 2 ** z
    return -MERC_HALF + x * size, MERC_HALF - y * size, size


def fetch_tile(session: requests.Session, z: int, x: int, y: int) -> np.ndarray:
    path = CACHE_DIR / str(z) / str(x) / f"{y}.jpg"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(4):
            response = session.get(ESRI_URL.format(z=z, x=x, y=y), headers=HEADERS, timeout=30)
            if response.status_code == 200:
                path.write_bytes(response.content)
                break
            time.sleep(2 ** attempt)
        else:
            raise SystemExit(f"Failed to fetch Esri tile {z}/{x}/{y}")
        time.sleep(0.25)  # stay polite: a few requests per second at most
    return np.asarray(Image.open(path).convert("RGB"))


def render_plot(session: requests.Session, plot: dict) -> None:
    x0, y0 = plot["utmX0"], plot["utmY0"]
    west, south, east, north = transform_bounds(
        plot_grid.CRS, "EPSG:4326",
        x0 - MARGIN_M, y0 - plot_grid.PLOT_M - MARGIN_M,
        x0 + plot_grid.PLOT_M + MARGIN_M, y0 + MARGIN_M,
    )
    tx0, ty0 = lnglat_to_tile(west, north, ZOOM)
    tx1, ty1 = lnglat_to_tile(east, south, ZOOM)
    xs = range(int(tx0), int(tx1) + 1)
    ys = range(int(ty0), int(ty1) + 1)

    mosaic = np.zeros((3, len(ys) * TILE_PX, len(xs) * TILE_PX), dtype=np.uint8)
    for j, ty in enumerate(ys):
        for i, tx in enumerate(xs):
            tile = fetch_tile(session, ZOOM, tx, ty)
            mosaic[:, j * TILE_PX:(j + 1) * TILE_PX, i * TILE_PX:(i + 1) * TILE_PX] = tile.transpose(2, 0, 1)

    left, top, size = tile_top_left_merc(xs[0], ys[0], ZOOM)
    src_transform = Affine(size / TILE_PX, 0, left, 0, -size / TILE_PX, top)
    dst_transform = Affine(OUT_RES_M, 0, x0, 0, -OUT_RES_M, y0)
    out = np.zeros((3, OUT_PX, OUT_PX), dtype=np.uint8)
    reproject(
        source=mosaic, destination=out,
        src_transform=src_transform, src_crs="EPSG:3857",
        dst_transform=dst_transform, dst_crs=plot_grid.CRS,
        resampling=Resampling.bilinear,
    )
    PLOT_OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out.transpose(1, 2, 0)).save(
        PLOT_OUT_DIR / f"plot_{plot['idx']:03d}.jpg", quality=JPEG_QUALITY, optimize=True)


def write_grid_to_data_js(atok_poly: list, paoay_poly: list, plots: list) -> None:
    source = DATA_JS_PATH.read_text(encoding="utf-8")
    begin = source.find("// BEGIN GENERATED STUDY AREA DATA")
    end = source.find("// END GENERATED STUDY AREA DATA")
    if begin == -1 or end == -1:
        raise SystemExit("data.js is missing the generated study area markers")
    end_line = source.find("\n", end)
    end_line = len(source) if end_line == -1 else end_line + 1
    block = "\n".join([
        "// BEGIN GENERATED STUDY AREA DATA",
        js_assignment("ATOK_POLY", atok_poly),
        js_assignment("PAOAY_POLY", paoay_poly),
        js_assignment("GRID", plot_grid.grid_constants()),
        js_assignment("PLOTS", plots),
        "// END GENERATED STUDY AREA DATA",
        "",
    ])
    DATA_JS_PATH.write_text(source[:begin] + block + source[end_line:], encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="comma-separated plot indexes to render")
    parser.add_argument("--skip-images", action="store_true")
    args = parser.parse_args()

    plots = plot_grid.build_plots()
    if not args.skip_images:
        targets = plots
        if args.only:
            wanted = {int(v) for v in args.only.split(",")}
            targets = [p for p in plots if p["idx"] in wanted]
        else:
            for old in PLOT_OUT_DIR.glob("plot_*.jpg"):
                old.unlink()
        with requests.Session() as session:
            for n, plot in enumerate(targets, 1):
                render_plot(session, plot)
                print(f"[{n}/{len(targets)}] plot_{plot['idx']:03d}.jpg")

    atok_poly = geometry_to_latlng_poly(load_feature(ATOK_BOUNDARY_PATH))
    paoay_poly = geometry_to_latlng_poly(load_feature(PAOAY_BOUNDARY_PATH))
    write_grid_to_data_js(atok_poly, paoay_poly, plots)
    print(f"Wrote {len(plots)} plots to {DATA_JS_PATH}")


if __name__ == "__main__":
    main()
