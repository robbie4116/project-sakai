import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const grid = fs.existsSync(new URL('../grid.js', import.meta.url)) ? require('../grid.js') : {};
const last = { idx: 119, pr: 9, pc: 11, validRows: 44, validCols: 21 };

test('reference constants identify the exact Sentinel-2 raster', () => {
  assert.deepEqual(grid.DEFAULT_GRID, { id: 's2-32651-258690-1841210-10-571-494-v1', crs: 'EPSG:32651', originX: 258690, originY: 1841210, pixelM: 10, s2Width: 571, s2Height: 494, cells: 50, plotCols: 12, plotRows: 10 });
});
test('last valid pixel retains its exact UTM footprint and identity', () => {
  const cell = grid.cellGeometry(last, 43 * 50 + 20);
  assert.equal(cell.pixel_id, 'r493_c570');
  assert.deepEqual([cell.cell_row, cell.cell_col, cell.s2_row, cell.s2_col], [43, 20, 493, 570]);
  assert.deepEqual([cell.utm_x, cell.utm_y, cell.utm_x_min, cell.utm_x_max, cell.utm_y_min, cell.utm_y_max], [264395, 1836275, 264390, 264400, 1836270, 1836280]);
  assert.ok(Math.abs(cell.center_lat - 16.597032476881786) < 1e-8);
  assert.ok(Math.abs(cell.center_lng - 120.79169334769858) < 1e-8);
  assert.equal(cell.lat_s, Math.min(...cell.corners.map(p => p[0])));
  assert.equal(cell.lng_e, Math.max(...cell.corners.map(p => p[1])));
});
test('partial plot cells outside the raster cannot produce geometry', () => {
  for (const idx of [-1, 2500, 0.5, NaN, 21, 44 * 50]) {
    assert.equal(grid.isValidCell(last, idx), false);
    assert.equal(grid.cellGeometry(last, idx), null);
  }
  assert.equal(grid.validCellCount(last), 21 * 44);
  assert.equal(grid.validCellCount(0), 2500);
  assert.equal(grid.isValidCell(120, 0), false);
  assert.equal(grid.isValidCell(null, 0), false);
});
test('projected positions match independent pyproj reference points to under 1 cm', () => {
  const points = [[258690,1841210,16.64103485375798,120.73772837202759], [258695,1841205,16.640990200807856,120.73777575032676], [264400,1836270,16.59698780860907,120.79174070297411], [259195,1840705,16.63652483661224,120.74251346963176]];
  for (const [x,y,lat,lng] of points) {
    const actual = grid.utmToLatLng(x,y);
    const errorM = Math.hypot((actual[0] - lat) * 111320, (actual[1] - lng) * 111320 * Math.cos(lat * Math.PI / 180));
    assert.ok(errorM < 0.01, `projection error ${errorM} m`);
  }
  assert.deepEqual(grid.plotPoint(13, 0.5, 0.5), grid.utmToLatLng(259195, 1840705));
});
test('corners distinguish full plot imagery from its valid raster area', () => {
  assert.deepEqual(grid.plotCorners(last)[2], grid.utmToLatLng(264690, 1836210));
  assert.deepEqual(grid.plotCorners(last, true)[2], grid.utmToLatLng(264400, 1836270));
  const b = grid.gridBounds();
  assert.deepEqual(b.corners[0], grid.utmToLatLng(258690, 1841210));
  assert.deepEqual(b.corners[2], grid.utmToLatLng(264400, 1836270));
  assert.equal(b.latN, Math.max(...b.corners.map(p => p[0])));
});
test('boundary outline includes edges and vertices', () => {
  const poly = [[0,0], [0,2], [2,2], [2,0]];
  for (const point of [[1,1], [0,1], [0,0]]) assert.equal(grid.isInsidePaoay(...point, poly), true);
  assert.equal(grid.isInsidePaoay(3,1,poly), false);
});
test('browser exposes the same standalone API', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../grid.js', import.meta.url), 'utf8'), context);
  assert.equal(context.window.TANIMAN_GRID.DEFAULT_GRID.id, grid.DEFAULT_GRID.id);
});

test('generated browser grid and imagery metadata agree with exact pixel math', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../s2-grid-data.js', import.meta.url),'utf8'),context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.GRID)),grid.DEFAULT_GRID);
  const plots = context.window.PLOTS;
  assert.equal(plots.length,120);
  assert.equal(plots.reduce((count,p)=>count+grid.validCellCount(p),0),571*494);
  for (const p of plots) {
    assert.equal(p.utmX0,258690+p.pc*500);
    assert.equal(p.utmY0,1841210-p.pr*500);
    assert.ok(fs.existsSync(new URL('../'+p.tilePath.split('?')[0],import.meta.url)));
    for (let i=0;i<4;i++) for (let j=0;j<2;j++) assert.ok(Math.abs(p.corners[i][j]-grid.plotCorners(p)[i][j])<1e-8);
  }
});
