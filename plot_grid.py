"""Pure geometry for the fixed Sentinel2_CSPlus_2024_01_H1 training raster."""
from pyproj import Transformer

GRID_ID = 's2-32651-258690-1841210-10-571-494-v1'
CRS = 'EPSG:32651'
ORIGIN_X, ORIGIN_Y = 258690, 1841210
PIXEL_M = 10
S2_WIDTH, S2_HEIGHT = 571, 494
CELLS = 50
PLOT_M = CELLS * PIXEL_M
PLOT_COLS, PLOT_ROWS = 12, 10
_TO_WGS84 = Transformer.from_crs(CRS, 'EPSG:4326', always_xy=True)


def _position(idx):
    if not isinstance(idx, int) or isinstance(idx, bool) or not 0 <= idx < PLOT_COLS * PLOT_ROWS:
        raise ValueError('plot index must be an integer from 0 to 119')
    return divmod(idx, PLOT_COLS)


def plot_origin(idx):
    pr, pc = _position(idx)
    return ORIGIN_X + pc * PLOT_M, ORIGIN_Y - pr * PLOT_M


def valid_size(idx):
    pr, pc = _position(idx)
    return min(CELLS, S2_WIDTH - pc * CELLS), min(CELLS, S2_HEIGHT - pr * CELLS)


def utm_to_latlng(x, y):
    lng, lat = _TO_WGS84.transform(x, y)
    return lat, lng


def build_plots():
    plots = []
    for idx in range(PLOT_COLS * PLOT_ROWS):
        pr, pc = _position(idx)
        x, y = plot_origin(idx)
        cols, rows = valid_size(idx)
        corners = [list(utm_to_latlng(px, py)) for px, py in
                   [(x, y), (x + PLOT_M, y), (x + PLOT_M, y - PLOT_M), (x, y - PLOT_M)]]
        lat, lng = utm_to_latlng(x + PLOT_M / 2, y - PLOT_M / 2)
        plots.append(dict(idx=idx, pr=pr, pc=pc, r=pr, c=pc, utmX0=x, utmY0=y,
                          validCols=cols, validRows=rows, corners=corners,
                          centerLat=lat, centerLng=lng,
                          latS=min(p[0] for p in corners), latN=max(p[0] for p in corners),
                          lngW=min(p[1] for p in corners), lngE=max(p[1] for p in corners),
                          tilePath=f'tiles/s2-plots/plot_{idx:03d}.jpg?v=s2-v1',
                          area='reference_grid', source='sentinel2_grid'))
    return plots


def grid_constants():
    return dict(id=GRID_ID, crs=CRS, originX=ORIGIN_X, originY=ORIGIN_Y, pixelM=PIXEL_M,
                s2Width=S2_WIDTH, s2Height=S2_HEIGHT, cells=CELLS,
                plotCols=PLOT_COLS, plotRows=PLOT_ROWS)
