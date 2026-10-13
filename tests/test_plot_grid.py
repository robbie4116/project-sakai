import importlib.util
from pathlib import Path
import unittest
from pyproj import Transformer

path = Path(__file__).parents[1] / 'plot_grid.py'
plot_grid = None
if path.exists():
    spec = importlib.util.spec_from_file_location('plot_grid', path)
    plot_grid = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plot_grid)


class PlotGridTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(plot_grid, 'Sentinel-2 plot-grid implementation is missing')

    def test_all_120_plots_cover_every_training_pixel_once(self):
        plots = plot_grid.build_plots()
        self.assertEqual(len(plots), 120)
        self.assertEqual(sum(p['validCols'] * p['validRows'] for p in plots), 571 * 494)
        for idx, p in enumerate(plots):
            self.assertEqual((p['idx'], p['pr'], p['pc'], p['r'], p['c']), (idx, idx // 12, idx % 12, idx // 12, idx % 12))
            self.assertEqual((p['utmX0'], p['utmY0']), (258690 + p['pc'] * 500, 1841210 - p['pr'] * 500))
            self.assertEqual(p['tilePath'], f'tiles/s2-plots/plot_{idx:03d}.jpg?v=s2-v1')
            self.assertEqual((p['area'], p['source']), ('reference_grid', 'sentinel2_grid'))
        self.assertEqual((plots[-1]['validCols'], plots[-1]['validRows']), (21, 44))

    def test_corners_are_full_500_meter_projected_squares(self):
        transformer = Transformer.from_crs(4326, 32651, always_xy=True)
        for p in plot_grid.build_plots():
            x, y = p['utmX0'], p['utmY0']
            expected = [(x,y), (x+500,y), (x+500,y-500), (x,y-500)]
            for (lat,lng), (ex,ey) in zip(p['corners'], expected):
                ax, ay = transformer.transform(lng, lat)
                self.assertLess(abs(ax-ex), .001)
                self.assertLess(abs(ay-ey), .001)
            self.assertEqual(p['latS'], min(c[0] for c in p['corners']))
            self.assertEqual(p['lngE'], max(c[1] for c in p['corners']))

    def test_constants_and_origin_helpers(self):
        self.assertEqual(plot_grid.grid_constants(), dict(id='s2-32651-258690-1841210-10-571-494-v1', crs='EPSG:32651', originX=258690, originY=1841210, pixelM=10, s2Width=571, s2Height=494, cells=50, plotCols=12, plotRows=10))
        self.assertEqual(plot_grid.plot_origin(119), (264190,1836710))
        self.assertEqual(plot_grid.valid_size(119), (21,44))
        for idx in [-1,120,.5]:
            with self.assertRaises(ValueError):
                plot_grid.plot_origin(idx)


if __name__ == '__main__':
    unittest.main()
