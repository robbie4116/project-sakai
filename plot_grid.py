"""Sentinel-2 aligned plot grid math (pure; no network or file I/O).

The constants come from the training composite Sentinel2_CSPlus_2024_01_H1.tif
(read 2026-10-13): EPSG:32651, 10 m pixels, origin (258690, 1841210), 571 x 494.
One label cell equals one Sentinel-2 pixel.
"""
from pyproj import Transformer

CRS = "EPSG:32651"
ORIGIN_X = 258690
ORIGIN_Y = 1841210
PIXEL_M = 10
S2_WIDTH = 571
S2_HEIGHT = 494
CELLS = 50
PLOT_M = CELLS * PIXEL_M
PLOT_COLS = -(-S2_WIDTH // CELLS)
PLOT_ROWS = -(-S2_HEIGHT // CELLS)

_TO_WGS84 = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)


def plot_origin(idx: int) -> tuple[int, int]:
    """Top-left UTM corner of a plot."""
    pr, pc = divmod(idx, PLOT_COLS)
    return ORIGIN_X + pc * PLOT_M, ORIGIN_Y - pr * PLOT_M


def valid_size(idx: int) -> tuple[int, int]:
    """(valid columns, valid rows) of a plot; the last column and row are partial."""
    pr, pc = divmod(idx, PLOT_COLS)
    return min(CELLS, S2_WIDTH - pc * CELLS), min(CELLS, S2_HEIGHT - pr * CELLS)


def utm_to_latlng(x: float, y: float) -> tuple[float, float]:
    lng, lat = _TO_WGS84.transform(x, y)
    return lat, lng


def _ll(x: float, y: float) -> list[float]:
    lat, lng = utm_to_latlng(x, y)
    return [round(lat, 8), round(lng, 8)]


def build_plots() -> list[dict]:
    plots = []
    for idx in range(PLOT_COLS * PLOT_ROWS):
        pr, pc = divmod(idx, PLOT_COLS)
        x0, y0 = plot_origin(idx)
        valid_cols, valid_rows = valid_size(idx)
        center = _ll(x0 + PLOT_M / 2, y0 - PLOT_M / 2)
        plots.append({
            "idx": idx,
            "pr": pr,
            "pc": pc,
            "corners": [
                _ll(x0, y0),
                _ll(x0 + PLOT_M, y0),
                _ll(x0 + PLOT_M, y0 - PLOT_M),
                _ll(x0, y0 - PLOT_M),
            ],
            "centerLat": center[0],
            "centerLng": center[1],
            "utmX0": x0,
            "utmY0": y0,
            "validCols": valid_cols,
            "validRows": valid_rows,
            "tilePath": f"tiles/plots/plot_{idx:03d}.jpg?v=s2",  # version busts the immutable /tiles cache
        })
    return plots


def grid_constants() -> dict:
    return {
        "crs": CRS,
        "originX": ORIGIN_X,
        "originY": ORIGIN_Y,
        "pixelM": PIXEL_M,
        "s2Width": S2_WIDTH,
        "s2Height": S2_HEIGHT,
        "cells": CELLS,
        "plotCols": PLOT_COLS,
        "plotRows": PLOT_ROWS,
    }
