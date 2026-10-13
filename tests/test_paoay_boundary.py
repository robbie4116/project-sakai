import json
from pathlib import Path

from pyproj import Transformer

import plot_grid

ROOT = Path(__file__).resolve().parents[1]


def paoay_feature():
    collection = json.loads((ROOT / 'boundaries/Benguet_Atok_Paoay_boundary.geojson').read_text(encoding='utf-8'))
    assert len(collection['features']) == 1
    return collection['features'][0]


def test_boundary_is_namria_paoay():
    props = paoay_feature()['properties']
    assert props['ADM4_PCODE'] == 'PH1401101005'
    assert 'NAMRIA' in props['source_dataset']


def test_boundary_lies_inside_sentinel_grid():
    to_utm = Transformer.from_crs(4326, 32651, always_xy=True)
    ring = paoay_feature()['geometry']['coordinates'][0]
    xs, ys = zip(*(to_utm.transform(lng, lat) for lng, lat in ring))
    east = plot_grid.ORIGIN_X + plot_grid.S2_WIDTH * plot_grid.PIXEL_M
    south = plot_grid.ORIGIN_Y - plot_grid.S2_HEIGHT * plot_grid.PIXEL_M
    assert plot_grid.ORIGIN_X <= min(xs) and max(xs) <= east
    assert south <= min(ys) and max(ys) <= plot_grid.ORIGIN_Y


def test_data_js_draws_the_committed_boundary():
    source = (ROOT / 'data.js').read_text(encoding='utf-8')
    line = next(l for l in source.splitlines() if l.startswith('window.PAOAY_POLY = '))
    drawn = json.loads(line[len('window.PAOAY_POLY = '):].rstrip(';'))
    assert drawn == [[lat, lng] for lng, lat in paoay_feature()['geometry']['coordinates'][0]]
