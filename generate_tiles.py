"""
generate_tiles.py - one-time asset generation from source rasters

Sources:
  atok_satellite.tif     - Full Atok municipality detail imagery
  benguet_satellite.tif  - Benguet province context imagery

Outputs:
  tiles/plots/plot_000.jpg ...     (Paoay plot images)
  tiles/map/{z}/{x}/{y}.jpg        (XYZ Atok detail tiles, zoom 12-17)
  tiles/map/empty.jpg              (fallback tile)
  tiles/context/{z}/{x}/{y}.jpg    (XYZ context tiles, zoom 10-13)
  tiles/context/empty.jpg          (fallback tile)
  data.js                          (Atok/Paoay polygon and plot metadata)

Run: python generate_tiles.py
Requires: pip install rasterio Pillow numpy
"""

import json
import math
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import Window

# CONFIG
DETAIL_SOURCE_TIF = "atok_satellite.tif"
CONTEXT_SOURCE_TIF = "benguet_satellite.tif"
ATOK_BOUNDARY_PATH = Path("boundaries/Benguet_Atok_boundary.geojson")
PAOAY_BOUNDARY_PATH = Path("boundaries/Benguet_Atok_Paoay_boundary.geojson")
DATA_JS_PATH = Path("data.js")
PLOT_OUT_DIR = Path("tiles/plots")
DETAIL_MAP_OUT_DIR = Path("tiles/map")
CONTEXT_MAP_OUT_DIR = Path("tiles/context")
PLOT_SIZE = 512
MAP_TILE_PX = 256
JPEG_QUALITY = 85
DETAIL_TILE_QUALITY = 80
CONTEXT_TILE_QUALITY = 74
DETAIL_MIN_ZOOM = 14
DETAIL_MAX_ZOOM = 14
CONTEXT_MIN_ZOOM = 10
CONTEXT_MAX_ZOOM = 13
PLOT_LAT_DEGREES = 0.0041364375
PLOT_LNG_DEGREES = 0.0040060625
OUTSIDE_TILE_FILL = (14, 26, 14)
GEOMETRY_EPSILON = 1e-12

# Wider satellite-looking context bounds from benguet_satellite.tif.
# At zooms 10-13 this is about 346 tiles, which is practical for an
# offline static bundle while giving field users meaningful orientation.
CONTEXT_BBOX_N = 16.93070509876553
CONTEXT_BBOX_S = 16.1724728083975
CONTEXT_BBOX_E = 120.9375
CONTEXT_BBOX_W = 120.43212890625

RGB_BANDS = [1, 2, 3]


def load_feature(path: Path) -> dict:
    """Return the only Feature in a FeatureCollection, or raise SystemExit."""
    collection = json.loads(path.read_text(encoding="utf-8"))
    if collection.get("type") != "FeatureCollection":
        raise SystemExit(f"{path} must be a GeoJSON FeatureCollection")
    features = collection.get("features", [])
    if len(features) != 1:
        raise SystemExit(f"{path} must contain exactly one Feature, found {len(features)}")
    return features[0]


def geometry_to_latlng_poly(feature: dict) -> list[list[float]]:
    """Return the Polygon exterior ring as [lat, lng] pairs."""
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "Polygon":
        raise SystemExit(f"Expected Polygon geometry, got {geometry.get('type')}")
    rings = geometry.get("coordinates") or []
    if not rings or not rings[0]:
        raise SystemExit("Expected Polygon geometry with a non-empty exterior ring")
    if len(rings) > 1:
        print("WARNING: Polygon has interior rings; display uses the exterior ring only")
    return [[lat, lng] for lng, lat in rings[0]]


def bbox_for_feature(feature: dict) -> dict[str, float]:
    """Return {"n", "s", "e", "w"} from every exterior coordinate."""
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "Polygon":
        raise SystemExit(f"Expected Polygon geometry, got {geometry.get('type')}")
    ring = (geometry.get("coordinates") or [[]])[0]
    if not ring:
        raise SystemExit("Expected Polygon geometry with a non-empty exterior ring")
    lngs = [lng for lng, _lat in ring]
    lats = [lat for _lng, lat in ring]
    return {"n": max(lats), "s": min(lats), "e": max(lngs), "w": min(lngs)}


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


def build_paoay_plots(paoay_feature: dict) -> list[dict]:
    """Return contiguous Paoay plot metadata using the fixed plot-size rule."""
    bbox = bbox_for_feature(paoay_feature)
    paoay_poly = geometry_to_latlng_poly(paoay_feature)
    plots = []
    row_count = math.ceil((bbox["n"] - bbox["s"]) / PLOT_LAT_DEGREES)
    col_count = math.ceil((bbox["e"] - bbox["w"]) / PLOT_LNG_DEGREES)
    for r in range(row_count):
        lat_n = bbox["n"] - r * PLOT_LAT_DEGREES
        lat_s = lat_n - PLOT_LAT_DEGREES
        for c in range(col_count):
            lng_w = bbox["w"] + c * PLOT_LNG_DEGREES
            lng_e = lng_w + PLOT_LNG_DEGREES
            candidate = {
                "latS": lat_s,
                "latN": lat_n,
                "lngW": lng_w,
                "lngE": lng_e,
                "centerLat": (lat_n + lat_s) / 2,
                "centerLng": (lng_w + lng_e) / 2,
            }
            if not plot_overlaps_polygon(candidate, paoay_poly):
                continue
            idx = len(plots)
            plots.append(
                {
                    **candidate,
                    "idx": idx,
                    "r": r,
                    "c": c,
                    "area": "paoay",
                    "source": "field_grid",
                    "tilePath": f"tiles/plots/plot_{idx:03d}.jpg",
                }
            )
    if not 1 <= len(plots) <= 500:
        raise SystemExit(f"Unexpected Paoay plot count from fixed grid: {len(plots)}")
    return plots


def js_assignment(name, value):
    return f"window.{name} = {json.dumps(value, separators=(',', ':'))};"


def write_geography_to_data_js(atok_poly: list, paoay_poly: list, paoay_plots: list) -> None:
    """Replace the generated study-area block in data.js and preserve crops/translations."""
    source = DATA_JS_PATH.read_text(encoding="utf-8")
    block = "\n".join(
        [
            "// BEGIN GENERATED STUDY AREA DATA",
            js_assignment("ATOK_POLY", atok_poly),
            js_assignment("PAOAY_POLY", paoay_poly),
            js_assignment("PAOAY_PLOTS", paoay_plots),
            "// END GENERATED STUDY AREA DATA",
            "",
        ]
    )
    begin = source.find("// BEGIN GENERATED STUDY AREA DATA")
    end = source.find("// END GENERATED STUDY AREA DATA")
    if begin != -1 and end != -1:
        end_line = source.find("\n", end)
        end_line = len(source) if end_line == -1 else end_line + 1
        updated = source[:begin] + block + source[end_line:]
    else:
        crops_start = source.find("window.CROPS")
        if crops_start == -1:
            raise SystemExit("Could not find window.CROPS in data.js")
        updated = block + source[crops_start:]
    DATA_JS_PATH.write_text(updated, encoding="utf-8")


def clean_generated_outputs():
    PLOT_OUT_DIR.mkdir(parents=True, exist_ok=True)
    for path in PLOT_OUT_DIR.glob("*.jpg"):
        path.unlink()

    for tile_dir in (DETAIL_MAP_OUT_DIR, CONTEXT_MAP_OUT_DIR):
        if not tile_dir.exists():
            continue
        for child in tile_dir.iterdir():
            if child.name == "empty.jpg":
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    DETAIL_MAP_OUT_DIR.mkdir(parents=True, exist_ok=True)
    CONTEXT_MAP_OUT_DIR.mkdir(parents=True, exist_ok=True)


def generate_plot_crops(src, plots):
    # Tiles are sampled directly from the EPSG:4326 source raster by converting
    # lat/lng bounds to pixel coordinates. At latitude ~16.6 and zoom 14,
    # the distortion is small enough for this field app.
    PLOT_OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    for plot in plots:
        row0, col0 = lat_lng_to_pixel(src, plot["latN"], plot["lngW"])
        row1, col1 = lat_lng_to_pixel(src, plot["latS"], plot["lngE"])
        row0, row1 = max(0, min(row0, row1)), min(src.height, max(row0, row1))
        col0, col1 = max(0, min(col0, col1)), min(src.width, max(col0, col1))
        if row1 - row0 < 2 or col1 - col0 < 2:
            print(f"  WARNING: plot_{plot['idx']:03d} has insufficient coverage in TIF - skipping")
            continue
        arr = crop_band(src, row0, col0, row1, col1)
        img = arr_to_pil(arr).resize((PLOT_SIZE, PLOT_SIZE), Image.LANCZOS)
        out = PLOT_OUT_DIR / f"plot_{plot['idx']:03d}.jpg"
        img.save(out, "JPEG", quality=JPEG_QUALITY)
        written += 1
    print(f"Done: {written} Paoay plot images -> {PLOT_OUT_DIR}/")
    return written


def generate_map_tiles(src, out_dir, min_zoom, max_zoom, bounds, quality, label):
    out_dir.mkdir(parents=True, exist_ok=True)

    empty = Image.new("RGB", (MAP_TILE_PX, MAP_TILE_PX), color=OUTSIDE_TILE_FILL)
    empty.save(out_dir / "empty.jpg", "JPEG", quality=60)

    lat_n, lat_s, lng_e, lng_w = bounds
    total = 0
    fallback_tiles = 0
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
                if np.all(arr == np.array(OUTSIDE_TILE_FILL, dtype=arr.dtype)[:, None, None]):
                    fallback_tiles += 1
                img = arr_to_pil(arr)
                img.save(out_path, "JPEG", quality=quality)
                total += 1
    print(f"Done: {total} {label} tiles -> {out_dir}/")
    return total, fallback_tiles


def generate_detail_map_tiles(src, atok_feature):
    bounds = bbox_for_feature(atok_feature)
    return generate_map_tiles(
        src,
        DETAIL_MAP_OUT_DIR,
        DETAIL_MIN_ZOOM,
        DETAIL_MAX_ZOOM,
        (bounds["n"], bounds["s"], bounds["e"], bounds["w"]),
        DETAIL_TILE_QUALITY,
        "Atok detail",
    )


def generate_context_map_tiles(src):
    return generate_map_tiles(
        src,
        CONTEXT_MAP_OUT_DIR,
        CONTEXT_MIN_ZOOM,
        CONTEXT_MAX_ZOOM,
        (CONTEXT_BBOX_N, CONTEXT_BBOX_S, CONTEXT_BBOX_E, CONTEXT_BBOX_W),
        CONTEXT_TILE_QUALITY,
        "context",
    )


def require_source_rasters():
    if not Path(DETAIL_SOURCE_TIF).exists():
        raise SystemExit(
            "Missing atok_satellite.tif. Full Atok offline support requires a "
            "georeferenced raster covering Atok/Paoay at this path before tile generation can run."
        )
    if not Path(CONTEXT_SOURCE_TIF).exists():
        raise SystemExit(
            "Missing benguet_satellite.tif. The existing app requires context tiles from this raster."
        )


def main():
    atok_feature = load_feature(ATOK_BOUNDARY_PATH)
    paoay_feature = load_feature(PAOAY_BOUNDARY_PATH)
    atok_poly = geometry_to_latlng_poly(atok_feature)
    paoay_poly = geometry_to_latlng_poly(paoay_feature)
    paoay_plots = build_paoay_plots(paoay_feature)
    print(f"Paoay plot count: {len(paoay_plots)}")

    require_source_rasters()
    clean_generated_outputs()

    print(f"Opening detail source {DETAIL_SOURCE_TIF}...")
    with rasterio.open(DETAIL_SOURCE_TIF) as detail_src:
        print(f"  {detail_src.width}x{detail_src.height} px, {detail_src.count} bands, CRS={detail_src.crs}")
        print("\n-- Generating Paoay plot crops --")
        plot_count = generate_plot_crops(detail_src, paoay_plots)
        print("\n-- Generating Atok detail map tiles --")
        detail_count, detail_fallback_count = generate_detail_map_tiles(detail_src, atok_feature)

    print(f"\nOpening context source {CONTEXT_SOURCE_TIF}...")
    with rasterio.open(CONTEXT_SOURCE_TIF) as context_src:
        print(f"  {context_src.width}x{context_src.height} px, {context_src.count} bands, CRS={context_src.crs}")
        print("\n-- Generating context map tiles --")
        context_count, context_fallback_count = generate_context_map_tiles(context_src)

    write_geography_to_data_js(atok_poly, paoay_poly, paoay_plots)
    print(f"\nGenerated Paoay plot count: {plot_count}")
    print(f"Generated Atok map tile count: {detail_count}")
    print(f"Generated context tile count: {context_count}")
    print(f"Fallback tile status: detail={detail_fallback_count} context={context_fallback_count}")
    print("All done. Commit data.js and tiles/.")


if __name__ == "__main__":
    main()
