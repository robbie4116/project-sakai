"""
generate_tiles.py - one-time asset generation from source rasters

Sources:
  tublay_satellite-highres.tif   - Full Tublay municipality detail imagery (high resolution)
  benguet_satellite.tif          - Benguet province context imagery (wide coverage)

Outputs:
  tiles/plots/plot_000.jpg ... plot_063.jpg  (64 Ambassador plot images)
  tiles/plots/outside_000.jpg ...            (hidden Tublay outside plot images)
  tiles/map/{z}/{x}/{y}.jpg                  (XYZ detail tiles, zoom 12-16)
  tiles/map/empty.jpg                        (fallback tile)
  tiles/context/{z}/{x}/{y}.jpg              (XYZ context tiles, zoom 10-13)
  tiles/context/empty.jpg                    (fallback tile)

Run: python generate_tiles.py
Requires: pip install rasterio Pillow numpy
"""

import math
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import Window

# CONFIG
DETAIL_SOURCE_TIF = "tublay_satellite-highres.tif"
CONTEXT_SOURCE_TIF = "benguet_satellite.tif"
PLOT_OUT_DIR = Path("tiles/plots")
DETAIL_MAP_OUT_DIR = Path("tiles/map")
CONTEXT_MAP_OUT_DIR = Path("tiles/context")
OUTSIDE_PLOT_PREFIX = "outside_"
PLOT_SIZE = 512
MAP_TILE_PX = 256
JPEG_QUALITY = 85
DETAIL_TILE_QUALITY = 80
CONTEXT_TILE_QUALITY = 74
DETAIL_MIN_ZOOM = 12
DETAIL_MAX_ZOOM = 16
CONTEXT_MIN_ZOOM = 10
CONTEXT_MAX_ZOOM = 13
OUTSIDE_TILE_FILL = (14, 26, 14)

# Authoritative bounds from Benguet_Tublay_boundary.geojson
TUBLAY_BBOX_N = 16.5514979
TUBLAY_BBOX_S = 16.4547903
TUBLAY_BBOX_E = 120.7004932
TUBLAY_BBOX_W = 120.5665814

# Ambassador bounding box (from data.js AMBASSADOR_PLOTS)
BBOX_N = 16.49551
BBOX_S = 16.46141
BBOX_E = 120.65667
BBOX_W = 120.62388
TILE_BBOX_N = TUBLAY_BBOX_N
TILE_BBOX_S = TUBLAY_BBOX_S
TILE_BBOX_E = TUBLAY_BBOX_E
TILE_BBOX_W = TUBLAY_BBOX_W

AMBASSADOR_POLY = [[16.47974,120.62619],[16.48212,120.62477],[16.48323,120.62388],[16.48656,120.62922],[16.48843,120.63073],[16.49014,120.63064],[16.4938,120.63286],[16.49551,120.63446],[16.49253,120.63659],[16.49125,120.63872],[16.4898,120.64086],[16.4875,120.64201],[16.48588,120.64334],[16.48485,120.64414],[16.48366,120.64503],[16.4811,120.64725],[16.48016,120.65205],[16.47829,120.65569],[16.47667,120.65667],[16.47548,120.65374],[16.47207,120.65374],[16.46951,120.65481],[16.46814,120.65258],[16.46704,120.64956],[16.46618,120.64716],[16.46414,120.64343],[16.46311,120.6413],[16.46201,120.63881],[16.46141,120.63748],[16.46797,120.63588],[16.46831,120.63526],[16.47147,120.63472],[16.47369,120.63419],[16.47369,120.63215],[16.47565,120.63099],[16.47641,120.62975],[16.47769,120.62806],[16.47974,120.62619]]

# Wider satellite-looking context bounds from benguet_satellite.tif.
# At zooms 10-13 this is about 346 tiles, which is practical for an
# offline static bundle while giving field users meaningful orientation.
CONTEXT_BBOX_N = 16.93070509876553
CONTEXT_BBOX_S = 16.1724728083975
CONTEXT_BBOX_E = 120.9375
CONTEXT_BBOX_W = 120.43212890625

# 64 plots from data.js (matching AMBASSADOR_PLOTS order)
PLOTS = [
    {"idx": 0, "latS": 16.491248, "latN": 16.49551, "lngW": 120.62388, "lngE": 120.627979},
    {"idx": 1, "latS": 16.491248, "latN": 16.49551, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 2, "latS": 16.491248, "latN": 16.49551, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 3, "latS": 16.491248, "latN": 16.49551, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 4, "latS": 16.491248, "latN": 16.49551, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 5, "latS": 16.491248, "latN": 16.49551, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 6, "latS": 16.491248, "latN": 16.49551, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 7, "latS": 16.491248, "latN": 16.49551, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 8, "latS": 16.486985, "latN": 16.491248, "lngW": 120.62388, "lngE": 120.627979},
    {"idx": 9, "latS": 16.486985, "latN": 16.491248, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 10, "latS": 16.486985, "latN": 16.491248, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 11, "latS": 16.486985, "latN": 16.491248, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 12, "latS": 16.486985, "latN": 16.491248, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 13, "latS": 16.486985, "latN": 16.491248, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 14, "latS": 16.486985, "latN": 16.491248, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 15, "latS": 16.486985, "latN": 16.491248, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 16, "latS": 16.482723, "latN": 16.486985, "lngW": 120.62388, "lngE": 120.627979},
    {"idx": 17, "latS": 16.482723, "latN": 16.486985, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 18, "latS": 16.482723, "latN": 16.486985, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 19, "latS": 16.482723, "latN": 16.486985, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 20, "latS": 16.482723, "latN": 16.486985, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 21, "latS": 16.482723, "latN": 16.486985, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 22, "latS": 16.482723, "latN": 16.486985, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 23, "latS": 16.482723, "latN": 16.486985, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 24, "latS": 16.47846, "latN": 16.482723, "lngW": 120.62388, "lngE": 120.627979},
    {"idx": 25, "latS": 16.47846, "latN": 16.482723, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 26, "latS": 16.47846, "latN": 16.482723, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 27, "latS": 16.47846, "latN": 16.482723, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 28, "latS": 16.47846, "latN": 16.482723, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 29, "latS": 16.47846, "latN": 16.482723, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 30, "latS": 16.47846, "latN": 16.482723, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 31, "latS": 16.47846, "latN": 16.482723, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 32, "latS": 16.474197, "latN": 16.47846, "lngW": 120.62388, "lngE": 120.627979},
    {"idx": 33, "latS": 16.474197, "latN": 16.47846, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 34, "latS": 16.474197, "latN": 16.47846, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 35, "latS": 16.474197, "latN": 16.47846, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 36, "latS": 16.474197, "latN": 16.47846, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 37, "latS": 16.474197, "latN": 16.47846, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 38, "latS": 16.474197, "latN": 16.47846, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 39, "latS": 16.474197, "latN": 16.47846, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 40, "latS": 16.469935, "latN": 16.474197, "lngW": 120.62388, "lngE": 120.627979},
    {"idx": 41, "latS": 16.469935, "latN": 16.474197, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 42, "latS": 16.469935, "latN": 16.474197, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 43, "latS": 16.469935, "latN": 16.474197, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 44, "latS": 16.469935, "latN": 16.474197, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 45, "latS": 16.469935, "latN": 16.474197, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 46, "latS": 16.469935, "latN": 16.474197, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 47, "latS": 16.469935, "latN": 16.474197, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 48, "latS": 16.465673, "latN": 16.469935, "lngW": 120.62388, "lngE": 120.627979},
    {"idx": 49, "latS": 16.465673, "latN": 16.469935, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 50, "latS": 16.465673, "latN": 16.469935, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 51, "latS": 16.465673, "latN": 16.469935, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 52, "latS": 16.465673, "latN": 16.469935, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 53, "latS": 16.465673, "latN": 16.469935, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 54, "latS": 16.465673, "latN": 16.469935, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 55, "latS": 16.465673, "latN": 16.469935, "lngW": 120.652571, "lngE": 120.65667},
    {"idx": 56, "latS": 16.46141, "latN": 16.465673, "lngW": 120.62388, "lngE": 120.627979},
    {"idx": 57, "latS": 16.46141, "latN": 16.465673, "lngW": 120.627979, "lngE": 120.632077},
    {"idx": 58, "latS": 16.46141, "latN": 16.465673, "lngW": 120.632078, "lngE": 120.636176},
    {"idx": 59, "latS": 16.46141, "latN": 16.465673, "lngW": 120.636176, "lngE": 120.640275},
    {"idx": 60, "latS": 16.46141, "latN": 16.465673, "lngW": 120.640275, "lngE": 120.644374},
    {"idx": 61, "latS": 16.46141, "latN": 16.465673, "lngW": 120.644374, "lngE": 120.648472},
    {"idx": 62, "latS": 16.46141, "latN": 16.465673, "lngW": 120.648472, "lngE": 120.652571},
    {"idx": 63, "latS": 16.46141, "latN": 16.465673, "lngW": 120.652571, "lngE": 120.65667},
]

AMBASSADOR_GRID_BOUNDS = {
    "latS": min(p["latS"] for p in PLOTS),
    "latN": max(p["latN"] for p in PLOTS),
    "lngW": min(p["lngW"] for p in PLOTS),
    "lngE": max(p["lngE"] for p in PLOTS),
}
AMBASSADOR_GRID_ROWS = 8
AMBASSADOR_GRID_COLS = 8
GEOMETRY_EPSILON = 1e-12


def lat_lng_to_pixel(src, lat, lng):
    """Convert WGS84 lat/lng to pixel row/col in the source raster."""
    col, row = ~src.transform * (lng, lat)
    return int(row), int(col)


def lat_lng_to_float_pixel(src, lat, lng):
    """Convert WGS84 lat/lng to fractional pixel row/col in the source raster."""
    col, row = ~src.transform * (lng, lat)
    return row, col


def crop_band(src, row0, col0, row1, col1):
    """Read a window from source, return numpy array (bands, h, w)."""
    h = row1 - row0
    w = col1 - col0
    window = Window(col0, row0, w, h)
    return src.read(window=window)


RGB_BANDS = [1, 2, 3]


def arr_to_pil(arr):
    """Convert (bands, h, w) uint8 array to PIL RGB Image."""
    rgb = np.stack([arr[0], arr[1], arr[2]], axis=2)
    return Image.fromarray(rgb.astype(np.uint8))


def read_xyz_tile(src, lat_n, lat_s, lng_w, lng_e):
    """Read a full XYZ tile extent and pad areas outside the source raster."""
    r0, c0 = lat_lng_to_float_pixel(src, lat_n, lng_w)
    r1, c1 = lat_lng_to_float_pixel(src, lat_s, lng_e)
    row0, row1 = min(r0, r1), max(r0, r1)
    col0, col1 = min(c0, c1), max(c0, c1)
    window = Window(col0, row0, col1 - col0, row1 - row0)
    arr = src.read(
        RGB_BANDS,
        window=window,
        out_shape=(3, MAP_TILE_PX, MAP_TILE_PX),
        boundless=True,
        fill_value=0,
        resampling=Resampling.bilinear,
    )
    outside_source = np.all(arr == 0, axis=0)
    if outside_source.any():
        for band, value in enumerate(OUTSIDE_TILE_FILL):
            arr[band, outside_source] = value
    return arr


def deg2tile(lat, lng, zoom):
    """Return (x, y) tile coordinates for a lat/lng at given zoom."""
    n = 2**zoom
    x = int((lng + 180) / 360 * n)
    lat_r = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n)
    return x, y


def tile_bounds(x, y, zoom):
    """Return (lat_N, lat_S, lng_W, lng_E) for an XYZ tile."""
    n = 2**zoom
    lng_w = x / n * 360 - 180
    lng_e = (x + 1) / n * 360 - 180

    def merc_to_lat(merc_y):
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * merc_y / n))))

    lat_n = merc_to_lat(y)
    lat_s = merc_to_lat(y + 1)
    return lat_n, lat_s, lng_w, lng_e


def point_in_polygon(lat, lng, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def point_in_rect(lat, lng, rect):
    return rect["latS"] <= lat <= rect["latN"] and rect["lngW"] <= lng <= rect["lngE"]


def plot_overlaps_rect(plot, rect):
    return (
        plot["latS"] < rect["latN"] - GEOMETRY_EPSILON
        and plot["latN"] > rect["latS"] + GEOMETRY_EPSILON
        and plot["lngW"] < rect["lngE"] - GEOMETRY_EPSILON
        and plot["lngE"] > rect["lngW"] + GEOMETRY_EPSILON
    )


def orientation(a, b, c):
    value = (b["lng"] - a["lng"]) * (c["lat"] - b["lat"]) - (b["lat"] - a["lat"]) * (c["lng"] - b["lng"])
    if abs(value) < 1e-12:
        return 0
    return 1 if value > 0 else 2


def on_segment(a, b, c):
    return (
        b["lng"] <= max(a["lng"], c["lng"]) + 1e-12
        and b["lng"] >= min(a["lng"], c["lng"]) - 1e-12
        and b["lat"] <= max(a["lat"], c["lat"]) + 1e-12
        and b["lat"] >= min(a["lat"], c["lat"]) - 1e-12
    )


def segments_intersect(a, b, c, d):
    o1 = orientation(a, b, c)
    o2 = orientation(a, b, d)
    o3 = orientation(c, d, a)
    o4 = orientation(c, d, b)
    if o1 != o2 and o3 != o4:
        return True
    if o1 == 0 and on_segment(a, c, b):
        return True
    if o2 == 0 and on_segment(a, d, b):
        return True
    if o3 == 0 and on_segment(c, a, d):
        return True
    if o4 == 0 and on_segment(c, b, d):
        return True
    return False


def plot_corners(plot):
    return [
        {"lat": plot["latN"], "lng": plot["lngW"]},
        {"lat": plot["latN"], "lng": plot["lngE"]},
        {"lat": plot["latS"], "lng": plot["lngE"]},
        {"lat": plot["latS"], "lng": plot["lngW"]},
    ]


def plot_overlaps_polygon(plot, poly):
    corners = plot_corners(plot)
    if any(point_in_polygon(pt["lat"], pt["lng"], poly) for pt in corners):
        return True
    if any(point_in_rect(lat, lng, plot) for lat, lng in poly):
        return True

    for i, a in enumerate(corners):
        b = corners[(i + 1) % len(corners)]
        for j in range(len(poly)):
            c = {"lat": poly[j][0], "lng": poly[j][1]}
            d = {"lat": poly[(j + 1) % len(poly)][0], "lng": poly[(j + 1) % len(poly)][1]}
            if segments_intersect(a, b, c, d):
                return True
    return False


def build_outside_plots():
    plot_lat = (AMBASSADOR_GRID_BOUNDS["latN"] - AMBASSADOR_GRID_BOUNDS["latS"]) / AMBASSADOR_GRID_ROWS
    plot_lng = (AMBASSADOR_GRID_BOUNDS["lngE"] - AMBASSADOR_GRID_BOUNDS["lngW"]) / AMBASSADOR_GRID_COLS
    row_start = math.ceil((AMBASSADOR_GRID_BOUNDS["latN"] - TUBLAY_BBOX_N) / plot_lat)
    row_end = math.floor((AMBASSADOR_GRID_BOUNDS["latN"] - TUBLAY_BBOX_S) / plot_lat)
    col_start = math.ceil((TUBLAY_BBOX_W - AMBASSADOR_GRID_BOUNDS["lngW"]) / plot_lng)
    col_end = math.floor((TUBLAY_BBOX_E - AMBASSADOR_GRID_BOUNDS["lngW"]) / plot_lng)
    plots = []
    for r in range(row_start, row_end):
        lat_n = AMBASSADOR_GRID_BOUNDS["latN"] - r * plot_lat
        lat_s = lat_n - plot_lat
        for c in range(col_start, col_end):
            lng_w = AMBASSADOR_GRID_BOUNDS["lngW"] + c * plot_lng
            lng_e = lng_w + plot_lng
            center_lat = (lat_n + lat_s) / 2
            center_lng = (lng_w + lng_e) / 2
            candidate = {
                "latS": lat_s,
                "latN": lat_n,
                "lngW": lng_w,
                "lngE": lng_e,
                "centerLat": center_lat,
                "centerLng": center_lng,
            }
            if plot_overlaps_rect(candidate, AMBASSADOR_GRID_BOUNDS):
                continue
            if plot_overlaps_polygon(candidate, AMBASSADOR_POLY):
                continue
            outside_seq = len(plots)
            plots.append({
                **candidate,
                "idx": len(PLOTS) + outside_seq,
                "outsideSeq": outside_seq,
            })
    return plots


def generate_plot_crops(src):
    # Tiles are sampled directly from the EPSG:4326 source raster by converting
    # lat/lng bounds to pixel coordinates. At latitude ~16.5 and zoom 12-16,
    # the distortion is small enough for this field app.
    PLOT_OUT_DIR.mkdir(parents=True, exist_ok=True)
    plot_jobs = [(p, "plot_", p["idx"]) for p in PLOTS]
    plot_jobs += [(p, OUTSIDE_PLOT_PREFIX, p["outsideSeq"]) for p in build_outside_plots()]
    for p, prefix, file_idx in plot_jobs:
        row0, col0 = lat_lng_to_pixel(src, p["latN"], p["lngW"])
        row1, col1 = lat_lng_to_pixel(src, p["latS"], p["lngE"])
        row0, row1 = max(0, min(row0, row1)), min(src.height, max(row0, row1))
        col0, col1 = max(0, min(col0, col1)), min(src.width, max(col0, col1))
        if row1 - row0 < 2 or col1 - col0 < 2:
            print(f"  WARNING: {prefix}{file_idx:03d} has insufficient coverage in TIF - skipping")
            continue
        arr = crop_band(src, row0, col0, row1, col1)
        img = arr_to_pil(arr).resize((PLOT_SIZE, PLOT_SIZE), Image.LANCZOS)
        out = PLOT_OUT_DIR / f"{prefix}{file_idx:03d}.jpg"
        img.save(out, "JPEG", quality=JPEG_QUALITY)
        print(f"  {prefix}{file_idx:03d}.jpg  {img.size}")
    print(f"Done: {len(plot_jobs)} plot images -> {PLOT_OUT_DIR}/")


def generate_map_tiles(src, out_dir, min_zoom, max_zoom, bounds, quality, label):
    out_dir.mkdir(parents=True, exist_ok=True)

    empty = Image.new("RGB", (MAP_TILE_PX, MAP_TILE_PX), color=OUTSIDE_TILE_FILL)
    empty.save(out_dir / "empty.jpg", "JPEG", quality=60)

    lat_n, lat_s, lng_e, lng_w = bounds
    total = 0
    for zoom in range(min_zoom, max_zoom + 1):
        x0, y0 = deg2tile(lat_n, lng_w, zoom)
        x1, y1 = deg2tile(lat_s, lng_e, zoom)
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        count = (x1 - x0 + 1) * (y1 - y0 + 1)
        print(f"{label} zoom {zoom}: x {x0}-{x1}, y {y0}-{y1}  ({count} tiles)")
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                out_path = out_dir / str(zoom) / str(tx) / f"{ty}.jpg"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                tile_lat_n, tile_lat_s, tile_lng_w, tile_lng_e = tile_bounds(tx, ty, zoom)
                arr = read_xyz_tile(src, tile_lat_n, tile_lat_s, tile_lng_w, tile_lng_e)
                img = arr_to_pil(arr)
                img.save(out_path, "JPEG", quality=quality)
                total += 1
    print(f"Done: {total} {label} tiles -> {out_dir}/")


def generate_detail_map_tiles(src):
    generate_map_tiles(
        src,
        DETAIL_MAP_OUT_DIR,
        DETAIL_MIN_ZOOM,
        DETAIL_MAX_ZOOM,
        (TILE_BBOX_N, TILE_BBOX_S, TILE_BBOX_E, TILE_BBOX_W),
        DETAIL_TILE_QUALITY,
        "detail",
    )


def generate_context_map_tiles(src):
    generate_map_tiles(
        src,
        CONTEXT_MAP_OUT_DIR,
        CONTEXT_MIN_ZOOM,
        CONTEXT_MAX_ZOOM,
        (CONTEXT_BBOX_N, CONTEXT_BBOX_S, CONTEXT_BBOX_E, CONTEXT_BBOX_W),
        CONTEXT_TILE_QUALITY,
        "context",
    )


if __name__ == "__main__":
    print(f"Opening detail source {DETAIL_SOURCE_TIF}...")
    with rasterio.open(DETAIL_SOURCE_TIF) as detail_src:
        print(f"  {detail_src.width}x{detail_src.height} px, {detail_src.count} bands, CRS={detail_src.crs}")
        print("\n-- Generating plot crops --")
        generate_plot_crops(detail_src)
        print("\n-- Generating detail map tiles --")
        generate_detail_map_tiles(detail_src)

    print(f"\nOpening context source {CONTEXT_SOURCE_TIF}...")
    with rasterio.open(CONTEXT_SOURCE_TIF) as context_src:
        print(f"  {context_src.width}x{context_src.height} px, {context_src.count} bands, CRS={context_src.crs}")
        print("\n-- Generating context map tiles --")
        generate_context_map_tiles(context_src)

    print("\nAll done. Commit the tiles/ directory.")
