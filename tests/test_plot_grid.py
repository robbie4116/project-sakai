import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

import plot_grid


def test_grid_has_120_plots_in_12_columns():
    plots = plot_grid.build_plots()
    assert plot_grid.PLOT_COLS == 12
    assert plot_grid.PLOT_ROWS == 10
    assert len(plots) == 120
    assert [p["idx"] for p in plots] == list(range(120))


def test_plot_origins_follow_the_sentinel2_grid():
    assert plot_grid.plot_origin(0) == (258690, 1841210)
    assert plot_grid.plot_origin(13) == (259190, 1840710)
    assert plot_grid.plot_origin(119) == (264190, 1836710)


def test_partial_plots_on_the_last_column_and_row():
    assert plot_grid.valid_size(0) == (50, 50)
    assert plot_grid.valid_size(11) == (21, 50)
    assert plot_grid.valid_size(108) == (50, 44)
    assert plot_grid.valid_size(119) == (21, 44)


def test_plot_record_shape_and_corners():
    plot = plot_grid.build_plots()[0]
    assert plot["pr"] == 0 and plot["pc"] == 0
    assert plot["utmX0"] == 258690 and plot["utmY0"] == 1841210
    assert plot["tilePath"] == "tiles/plots/plot_000.jpg?v=s2"
    nw, ne, se, sw = plot["corners"]
    assert nw == pytest.approx([16.64103485, 120.73772837], abs=1e-7)
    assert ne == pytest.approx([16.6410859, 120.74241321], abs=1e-7)
    assert se == pytest.approx([16.63656949, 120.74246609], abs=1e-7)
    assert sw == pytest.approx([16.63651846, 120.73778136], abs=1e-7)


def test_grid_constants_for_data_js():
    assert plot_grid.grid_constants() == {
        "crs": "EPSG:32651",
        "originX": 258690,
        "originY": 1841210,
        "pixelM": 10,
        "s2Width": 571,
        "s2Height": 494,
        "cells": 50,
        "plotCols": 12,
        "plotRows": 10,
    }
