import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Grid = require('../grid.js');

// Corners and reference centers computed with pyproj (EPSG:32651 -> 4326).
const plot0 = {
  idx: 0, validCols: 50, validRows: 50,
  corners: [[16.64103485, 120.73772837], [16.6410859, 120.74241321], [16.63656949, 120.74246609], [16.63651846, 120.73778136]],
};
const plot119 = {
  idx: 119, validCols: 21, validRows: 44,
  corners: [[16.60094149, 120.789728], [16.60099124, 120.79441204], [16.59647465, 120.79446357], [16.59642492, 120.78977965]],
};

test('grid constants match the Sentinel-2 composite', () => {
  assert.equal(Grid.CRS, 'EPSG:32651');
  assert.equal(Grid.ORIGIN_X, 258690);
  assert.equal(Grid.ORIGIN_Y, 1841210);
  assert.equal(Grid.S2_WIDTH, 571);
  assert.equal(Grid.S2_HEIGHT, 494);
  assert.equal(Grid.PLOT_COLS, 12);
  assert.equal(Grid.PLOT_ROWS, 10);
});

test('cells map to Sentinel-2 rows and columns', () => {
  assert.deepEqual(Grid.cellToS2(0, 0), { cell_row: 0, cell_col: 0, s2_row: 0, s2_col: 0 });
  assert.deepEqual(Grid.cellToS2(13, 1275), { cell_row: 25, cell_col: 25, s2_row: 75, s2_col: 75 });
  assert.deepEqual(Grid.cellToS2(119, 2499), { cell_row: 49, cell_col: 49, s2_row: 499, s2_col: 599 });
  assert.deepEqual(Grid.s2ToCell(75, 75), { plotIdx: 13, cellIdx: 1275 });
});

test('UTM centers are exact', () => {
  assert.deepEqual(Grid.cellUtmCenter(0, 0), { utm_x: 258695, utm_y: 1841205 });
  assert.deepEqual(Grid.cellUtmCenter(13, 1275), { utm_x: 259445, utm_y: 1840455 });
});

test('cells outside the composite are out of bounds', () => {
  assert.equal(Grid.isCellInBounds(plot0, 2499), true);
  assert.equal(Grid.isCellInBounds(plot119, 20), true);        // col 20 < 21
  assert.equal(Grid.isCellInBounds(plot119, 21), false);       // col 21
  assert.equal(Grid.isCellInBounds(plot119, 43 * 50), true);   // row 43
  assert.equal(Grid.isCellInBounds(plot119, 44 * 50), false);  // row 44
  assert.equal(Grid.isCellInBounds(plot0, -1), false);
  assert.equal(Grid.isCellInBounds(plot0, 2500), false);
  assert.equal(Grid.validCellCount(plot119), 21 * 44);
});

test('brush cells stay inside the plot and the composite', () => {
  assert.deepEqual(Grid.brushCells(plot0, 0, 0, 1), [0]);
  assert.deepEqual(Grid.brushCells(plot0, 0, 0, 3), [0, 1, 50, 51]);       // clipped at the plot edge
  assert.deepEqual(Grid.brushCells(plot119, 0, 20, 3), [19, 20, 69, 70]);  // col 21 is out of bounds
  assert.deepEqual(Grid.brushCells(plot119, 44, 10, 1), []);               // row 44 is out of bounds
});

test('interpolated cell centers are within 0.5 m of the true projection', () => {
  const cases = [
    [plot0, 0, 16.6409902, 120.73777575],
    [plot0, 1275, 16.63875754, 120.74014464],
    [plot0, 2499, 16.63661415, 120.74241872],
    [plot119, 1275, 16.59866342, 120.79214317],
  ];
  for (const [plot, cell, lat, lng] of cases) {
    const got = Grid.cellLatLng(plot, cell);
    const dy = (got.center_lat - lat) * 111320;
    const dx = (got.center_lng - lng) * 111320 * Math.cos(lat * Math.PI / 180);
    assert.ok(Math.hypot(dx, dy) < 0.5, `plot ${plot.idx} cell ${cell} off by ${Math.hypot(dx, dy)} m`);
  }
});

test('grid bounds wrap every plot corner', () => {
  const b = Grid.gridBoundsLatLng([plot0, plot119]);
  assert.equal(b.latN, 16.6410859);
  assert.equal(b.latS, 16.59642492);
  assert.equal(b.lngW, 120.73772837);
  assert.equal(b.lngE, 120.79446357);
});
