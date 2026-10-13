import json

import numpy as np
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_bounds


def generator():
    import importlib.util
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / 'generate_plots.py'
    assert path.exists(), 'UTM imagery generator must exist'
    spec = importlib.util.spec_from_file_location('generate_plots', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_reproject_mercator_coordinates_to_exact_utm_square():
    mod = generator()
    x0, y0 = 258690, 1841210
    project = Transformer.from_crs(32651, 3857, always_xy=True)
    corners = [project.transform(x, y) for x in (x0 - 10, x0 + 510) for y in (y0 - 510, y0 + 10)]
    bounds = (min(p[0] for p in corners), min(p[1] for p in corners), max(p[0] for p in corners), max(p[1] for p in corners))
    transform = from_bounds(*bounds, 600, 600)
    rows, cols = np.indices((600, 600))
    # Bands encode source eastings/northings so coordinate shifts are measurable.
    src = np.stack((transform.c + (cols + .5) * transform.a,
                    transform.f + (rows + .5) * transform.e)).astype('float64')
    actual = mod.reproject_plot(src, transform, {'utmX0': x0, 'utmY0': y0}, resampling=Resampling.bilinear)
    assert actual.shape == (2, 1000, 1000)
    for row, col in ((0, 0), (400, 600), (999, 999)):
        expected = project.transform(x0 + (col + .5) * .5, y0 - (row + .5) * .5)
        np.testing.assert_allclose(actual[:, row, col], expected, atol=.05, rtol=0)


def test_metadata_contains_full_grid_and_partial_plot():
    mod = generator()
    from plot_grid import build_plots, grid_constants
    plots = build_plots()
    source = mod.metadata_source(grid_constants(), plots)
    assert source.startswith('// Generated')
    assert 'window.GRID = ' in source
    assert 's2-32651-258690-1841210-10-571-494-v1' in source
    assert 'window.PLOTS = ' in source
    payload = source.split('window.PLOTS = ', 1)[1].rstrip().removesuffix(';')
    records = json.loads(payload)
    assert len(records) == 120
    assert records[-1]['validCols'] == 21
    assert records[-1]['validRows'] == 44
    assert records[-1]['tilePath'] == 'tiles/s2-plots/plot_119.jpg?v=s2-v1'
