import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const grid = require('../grid.js');
const seasons = require('../season-utils.js');
const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
const html = await readFile(new URL('../taniman.html',import.meta.url),'utf8');

test('exported label geometry is the exact raster pixel and invalid edge cells are omitted', () => {
  const plot = {idx:119,pr:9,pc:11,utmX0:264190,utmY0:1836710,validCols:21,validRows:44};
  const rows = seasons.seasonExportRows({plotIdx:119,plot,grid:50,plotData:{seasons:[{id:'a',cropId:'carrot',start:'01-01',end:'03-01',referenceYear:2024,fieldId:'F1',cells:[0,20,21,43*50+20,44*50]}]}});
  assert.equal(rows.length,3);
  assert.deepEqual(rows.map(row=>[row.s2_row,row.s2_col]),[[450,550],[450,570],[493,570]]);
  assert.equal(rows[0].utm_x,264195);
  assert.equal(rows[0].utm_y,1836705);
  assert.equal(rows[0].reference_year,2024);
  assert.equal(rows[0].field_id,'F1');
});

test('app paints and draws only the reference grid', () => {
  assert.match(app,/const PLOTS = window\.PLOTS/);
  assert.match(app,/L\.polygon\(GridMath\.plotCorners\(plot, true\)/);
  assert.match(app,/GridMath\.isValidCell\(PLOTS\[state\.plotIdx\]/);
  assert.match(app,/reference_grid:/);
  assert.match(html,/s2-grid-data\.js/);
  assert.ok(html.indexOf('grid.js') < html.indexOf('season-utils.js'));
});

test('corrected grid never loads old label storage and requires verified dates', () => {
  assert.match(app,/taniman_v5_sentinel2/);
  assert.match(app,/s\.gridId !== GridMath\.DEFAULT_GRID\.id/);
  assert.match(html,/id="reference-year"/);
  assert.match(html,/id="reference-confirmed"/);
});
