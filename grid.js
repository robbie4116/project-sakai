// Sentinel-2 aligned grid math. One label cell = one 10 m Sentinel-2 pixel.
// Constants from Sentinel2_CSPlus_2024_01_H1.tif (see spec section 1).
(function (root) {
  'use strict';

  const CRS = 'EPSG:32651';
  const ORIGIN_X = 258690;
  const ORIGIN_Y = 1841210;
  const PIXEL_M = 10;
  const S2_WIDTH = 571;
  const S2_HEIGHT = 494;
  const CELLS = 50;
  const PLOT_COLS = Math.ceil(S2_WIDTH / CELLS);
  const PLOT_ROWS = Math.ceil(S2_HEIGHT / CELLS);

  function plotPosition(plotIdx) {
    return { pr: Math.floor(plotIdx / PLOT_COLS), pc: plotIdx % PLOT_COLS };
  }

  function cellPosition(cellIdx) {
    return { cell_row: Math.floor(cellIdx / CELLS), cell_col: cellIdx % CELLS };
  }

  function cellToS2(plotIdx, cellIdx) {
    const { pr, pc } = plotPosition(plotIdx);
    const { cell_row, cell_col } = cellPosition(cellIdx);
    return { cell_row, cell_col, s2_row: pr * CELLS + cell_row, s2_col: pc * CELLS + cell_col };
  }

  function s2ToCell(s2Row, s2Col) {
    const pr = Math.floor(s2Row / CELLS);
    const pc = Math.floor(s2Col / CELLS);
    return { plotIdx: pr * PLOT_COLS + pc, cellIdx: (s2Row % CELLS) * CELLS + (s2Col % CELLS) };
  }

  function isCellInBounds(plot, cellIdx) {
    if (!plot || !Number.isInteger(cellIdx) || cellIdx < 0 || cellIdx >= CELLS * CELLS) return false;
    const { cell_row, cell_col } = cellPosition(cellIdx);
    return cell_col < plot.validCols && cell_row < plot.validRows;
  }

  function validCellCount(plot) {
    return plot ? plot.validCols * plot.validRows : 0;
  }

  // Cell indexes under a size x size brush centred on (row, col), skipping
  // cells outside the plot or the Sentinel-2 composite.
  function brushCells(plot, row, col, size) {
    const half = Math.floor(size / 2);
    const out = [];
    for (let dr = -half; dr <= half; dr++) {
      for (let dc = -half; dc <= half; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= CELLS || c >= CELLS) continue;
        const cellIdx = r * CELLS + c;
        if (isCellInBounds(plot, cellIdx)) out.push(cellIdx);
      }
    }
    return out;
  }

  function cellUtmCenter(plotIdx, cellIdx) {
    const { s2_row, s2_col } = cellToS2(plotIdx, cellIdx);
    return {
      utm_x: ORIGIN_X + s2_col * PIXEL_M + PIXEL_M / 2,
      utm_y: ORIGIN_Y - s2_row * PIXEL_M - PIXEL_M / 2,
    };
  }

  function round8(n) {
    return Number(n.toFixed(8));
  }

  // Bilinear interpolation of the plot's WGS84 corners [NW, NE, SE, SW].
  // Error vs. a true UTM->WGS84 projection is < 1 cm over a 500 m plot.
  function cellLatLng(plot, cellIdx) {
    const { cell_row, cell_col } = cellPosition(cellIdx);
    const u = (cell_col + 0.5) / CELLS;
    const v = (cell_row + 0.5) / CELLS;
    const [nw, ne, se, sw] = plot.corners;
    const mix = i => (1 - u) * (1 - v) * nw[i] + u * (1 - v) * ne[i] + u * v * se[i] + (1 - u) * v * sw[i];
    return { center_lat: round8(mix(0)), center_lng: round8(mix(1)) };
  }

  function gridBoundsLatLng(plots) {
    const bounds = { latS: Infinity, latN: -Infinity, lngW: Infinity, lngE: -Infinity };
    for (const plot of plots || []) {
      for (const [lat, lng] of plot.corners) {
        bounds.latS = Math.min(bounds.latS, lat);
        bounds.latN = Math.max(bounds.latN, lat);
        bounds.lngW = Math.min(bounds.lngW, lng);
        bounds.lngE = Math.max(bounds.lngE, lng);
      }
    }
    return bounds;
  }

  const api = {
    CRS, ORIGIN_X, ORIGIN_Y, PIXEL_M, S2_WIDTH, S2_HEIGHT, CELLS, PLOT_COLS, PLOT_ROWS,
    plotPosition, cellPosition, cellToS2, s2ToCell, isCellInBounds, validCellCount,
    brushCells, cellUtmCenter, cellLatLng, gridBoundsLatLng,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TANIMAN_GRID = api;
})(typeof window !== 'undefined' ? window : globalThis);
