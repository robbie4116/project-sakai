"""Import the NAMRIA Paoay barangay boundary into boundaries/.

Usage:
    python scripts/import_paoay_boundary.py path/to/paoay_namria.geojson

The source is the panel-supplied "Atok, Benguet" KMZ converted to GeoJSON,
carrying PSA/NAMRIA admin boundary attributes. It replaces the earlier 2019
faeldon/philippines-json-maps polygon, which sits ~780 m west and ~70 m south
of the NAMRIA outline. The Sentinel-2 reference grid was cut to this boundary,
so the import refuses any polygon that leaves that grid.
"""
import json
import sys
from pathlib import Path

from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import plot_grid  # noqa: E402

OUT_PATH = Path("boundaries/Benguet_Atok_Paoay_boundary.geojson")
PAOAY_PCODE = "PH1401101005"


def load_single_polygon(path: Path) -> dict:
    collection = json.loads(path.read_text(encoding="utf-8"))
    features = collection.get("features", []) if collection.get("type") == "FeatureCollection" else []
    if len(features) != 1:
        raise SystemExit(f"{path} must be a FeatureCollection with exactly one Feature")
    feature = features[0]
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "Polygon" or len(geometry.get("coordinates") or []) != 1:
        raise SystemExit("Expected a single-ring Polygon")
    ring = geometry["coordinates"][0]
    if len(ring) < 4 or ring[0] != ring[-1]:
        raise SystemExit("Polygon exterior ring must be closed with at least 4 positions")
    return feature


def check_identity(properties: dict) -> None:
    if properties.get("ADM4_EN") != "Paoay" or properties.get("ADM4_PCODE") != PAOAY_PCODE:
        raise SystemExit(f"Not Paoay ({PAOAY_PCODE}): {properties.get('ADM4_EN')} {properties.get('ADM4_PCODE')}")


def check_inside_grid(ring: list) -> dict:
    to_utm = Transformer.from_crs(4326, 32651, always_xy=True)
    xs, ys = zip(*(to_utm.transform(lng, lat) for lng, lat in ring))
    west, north = plot_grid.ORIGIN_X, plot_grid.ORIGIN_Y
    east = west + plot_grid.S2_WIDTH * plot_grid.PIXEL_M
    south = north - plot_grid.S2_HEIGHT * plot_grid.PIXEL_M
    bbox = {"w": min(xs), "s": min(ys), "e": max(xs), "n": max(ys)}
    if bbox["w"] < west or bbox["e"] > east or bbox["s"] < south or bbox["n"] > north:
        raise SystemExit(f"Paoay UTM bbox {bbox} leaves the Sentinel-2 grid {(west, south, east, north)}")
    return bbox


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    feature = load_single_polygon(Path(sys.argv[1]))
    check_identity(feature.get("properties") or {})
    bbox = check_inside_grid(feature["geometry"]["coordinates"][0])
    feature["properties"] = {
        **feature["properties"],
        "psgc": "1401101005",
        "parent_psgc": "1401101000",
        "source_dataset": "PSA/NAMRIA barangay admin boundary (panel-supplied Atok, Benguet KMZ)",
        "note": "Replaces the 2019 faeldon/philippines-json-maps polygon (offset ~780 m W, ~70 m S).",
    }
    OUT_PATH.write_text(json.dumps({
        "type": "FeatureCollection",
        "name": "Benguet_Atok_Paoay_boundary",
        "features": [feature],
    }, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH}")
    print("Paoay UTM bbox: " + ", ".join(f"{k}={v:.0f}" for k, v in bbox.items()))


if __name__ == "__main__":
    main()
