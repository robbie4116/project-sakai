from pathlib import Path
import json
import urllib.request

SOURCE_URL = "https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2019/geojson/barangays/hires/barangays-municity-ph141101000.0.1.json"
ATOK_PATH = Path("boundaries/Benguet_Atok_boundary.geojson")
OUT_PATH = Path("boundaries/Benguet_Atok_Paoay_boundary.geojson")
BOUNDARY_TOLERANCE_DEGREES = 1e-8


def bbox_for_feature(feature):
    coords = feature["geometry"]["coordinates"]
    points = []

    def walk(value):
        if (
            isinstance(value, list)
            and len(value) == 2
            and all(isinstance(n, (int, float)) for n in value)
        ):
            points.append(value)
        else:
            for item in value:
                walk(item)

    walk(coords)
    lngs = [p[0] for p in points]
    lats = [p[1] for p in points]
    return {"w": min(lngs), "e": max(lngs), "s": min(lats), "n": max(lats)}


def point_on_segment(px, py, ax, ay, bx, by, eps=1e-10):
    cross = (py - ay) * (bx - ax) - (px - ax) * (by - ay)
    if abs(cross) > eps:
        return False
    return (
        min(ax, bx) - eps <= px <= max(ax, bx) + eps
        and min(ay, by) - eps <= py <= max(ay, by) + eps
    )


def point_in_polygon(lat, lng, ring):
    inside = False
    j = len(ring) - 1
    for i, point in enumerate(ring):
        xi, yi = point
        xj, yj = ring[j]
        if point_on_segment(lng, lat, xi, yi, xj, yj):
            return True
        intersects = ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / (yj - yi) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def distance_to_segment(px, py, ax, ay, bx, by):
    dx = bx - ax
    dy = by - ay
    if dx == 0 and dy == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0, min(1, t))
    return ((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2) ** 0.5


def point_inside_or_on_boundary(lat, lng, ring):
    if point_in_polygon(lat, lng, ring):
        return True
    return any(
        distance_to_segment(lng, lat, ax, ay, bx, by) <= BOUNDARY_TOLERANCE_DEGREES
        for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1])
    )


def exterior_ring(feature):
    geometry = feature["geometry"]
    if geometry["type"] != "Polygon":
        raise SystemExit(f"Expected Polygon geometry, got {geometry['type']}")
    return geometry["coordinates"][0]


def main():
    with urllib.request.urlopen(SOURCE_URL, timeout=30) as response:
        source = json.loads(response.read().decode("utf-8"))
    matches = [
        f
        for f in source.get("features", [])
        if f.get("properties", {}).get("ADM3_EN", "").upper() == "ATOK"
        and f.get("properties", {}).get("ADM4_EN") == "Paoay"
    ]
    if len(matches) != 1:
        raise SystemExit(f"Expected exactly one Paoay feature, found {len(matches)}")
    feature = matches[0]
    if feature["properties"].get("ADM4_PCODE") != "PH141101005":
        raise SystemExit(
            f"Unexpected Paoay p-code: {feature['properties'].get('ADM4_PCODE')}"
        )
    if feature["properties"].get("ADM3_PCODE") != "PH141101000":
        raise SystemExit(
            f"Unexpected Atok p-code: {feature['properties'].get('ADM3_PCODE')}"
        )
    if feature["properties"].get("ADM3_EN") != "ATOK":
        raise SystemExit(
            f"Unexpected Atok parent name: {feature['properties'].get('ADM3_EN')}"
        )

    atok = json.loads(ATOK_PATH.read_text(encoding="utf-8"))
    if len(atok.get("features", [])) != 1:
        raise SystemExit("Expected existing Atok boundary file to contain exactly one feature")
    atok_ring = exterior_ring(atok["features"][0])
    paoay_ring = exterior_ring(feature)
    atok_bbox = bbox_for_feature(atok["features"][0])
    paoay_bbox = bbox_for_feature(feature)
    if not (
        atok_bbox["w"] <= paoay_bbox["w"] <= paoay_bbox["e"] <= atok_bbox["e"]
        and atok_bbox["s"] <= paoay_bbox["s"] <= paoay_bbox["n"] <= atok_bbox["n"]
    ):
        raise SystemExit(f"Paoay bbox {paoay_bbox} is not inside Atok bbox {atok_bbox}")
    outside_vertices = [
        point
        for point in paoay_ring
        if not point_inside_or_on_boundary(point[1], point[0], atok_ring)
    ]
    if outside_vertices:
        raise SystemExit(f"Paoay has {len(outside_vertices)} exterior vertices outside Atok")

    feature["properties"] = {
        **feature["properties"],
        "psgc": "1401101005",
        "parent_psgc": "1401101000",
        "source_url": SOURCE_URL,
        "source_dataset": "faeldon/philippines-json-maps 2019 barangay hires GeoJSON",
        "note": "Extracted for Taniman Atok/Paoay study-area migration.",
    }
    OUT_PATH.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "name": "Benguet_Atok_Paoay_boundary",
                "features": [feature],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {OUT_PATH}")
    print(f"Paoay bbox: {paoay_bbox}")


if __name__ == "__main__":
    main()
