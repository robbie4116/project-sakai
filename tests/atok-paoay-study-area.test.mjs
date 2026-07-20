import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const dataSource = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');

function loadData() {
  const sandbox = { window: {} };
  vm.runInNewContext(dataSource, sandbox);
  return sandbox.window;
}

test('data exposes Atok and Paoay study-area globals', () => {
  const data = loadData();
  assert.ok(Array.isArray(data.ATOK_POLY), 'ATOK_POLY should be an array');
  assert.ok(Array.isArray(data.PAOAY_POLY), 'PAOAY_POLY should be an array');
  assert.ok(Array.isArray(data.PAOAY_PLOTS), 'PAOAY_PLOTS should be an array');
  assert.ok(data.PAOAY_PLOTS.length > 0);
  assert.equal(data.PAOAY_PLOTS[0].area, 'paoay');
  assert.equal(data.PAOAY_PLOTS[0].source, 'field_grid');
  assert.match(data.PAOAY_PLOTS[0].tilePath, /^tiles\/plots\/plot_000\.jpg$/);
});

test('Paoay and Atok polygons have expected coordinate ranges', () => {
  const data = loadData();
  const bbox = (poly) => ({
    s: Math.min(...poly.map(([lat]) => lat)),
    n: Math.max(...poly.map(([lat]) => lat)),
    w: Math.min(...poly.map(([, lng]) => lng)),
    e: Math.max(...poly.map(([, lng]) => lng)),
  });
  const atok = bbox(data.ATOK_POLY);
  const paoay = bbox(data.PAOAY_POLY);
  assert.ok(atok.s <= paoay.s && paoay.n <= atok.n);
  assert.ok(atok.w <= paoay.w && paoay.e <= atok.e);
  assert.ok(paoay.s > 16.59 && paoay.n < 16.65);
  assert.ok(paoay.w > 120.72 && paoay.e < 120.79);
});

test('app uses the Atok/Paoay storage namespace and zone names', () => {
  assert.match(appSource, /const\s+STORAGE_KEY\s*=\s*'taniman_v4_atok_paoay'/);
  assert.doesNotMatch(appSource, /localStorage\.getItem\('taniman_v3'\)|STORAGE_KEY\s*=\s*'taniman_v3'/);
  assert.match(appSource, /function\s+classifyZone\s*\(\s*lat,\s*lng\s*\)/);
  assert.match(appSource, /return\s+'paoay'/);
  assert.match(appSource, /return\s+'atok'/);
  assert.match(appSource, /return\s+'outside'/);
});

test('classifyZone returns paoay, atok, and outside for known coordinates', () => {
  const end = appSource.indexOf('// month mask helpers');
  assert.notEqual(end, -1, 'classifyZone must appear before state setup');
  const sandbox = { window: loadData() };
  vm.runInNewContext(`${appSource.slice(0, end)}
globalThis.__zones = [
  classifyZone(16.624, 120.755),
  classifyZone(16.570, 120.690),
  classifyZone(16.700, 120.900),
];`, sandbox);
  assert.deepEqual(Array.from(sandbox.__zones), ['paoay', 'atok', 'outside']);
});

test('active app no longer references Ambassador/Tublay plot models', () => {
  assert.doesNotMatch(appSource, /AMBASSADOR_PLOTS|AMBASSADOR_GRID_BOUNDS|TUBLAY_PLOTS|isTublayPlot|buildOutsidePlots/);
  assert.doesNotMatch(dataSource, /window\.AMBASSADOR_POLY|window\.AMBASSADOR_PLOTS|window\.TUBLAY_POLY/);
});

test('Add Plot control is not active in the Paoay-only workflow', () => {
  assert.doesNotMatch(htmlSource, /id="add-outside-btn"/);
  assert.doesNotMatch(appSource, /handleOutsideMapClick|createOutsidePlotAt|registerCustomOutsidePlot|enabledOutsidePlots/);
  assert.doesNotMatch(appSource, /document\.getElementById\('add-outside-btn'\)/);
  assert.doesNotMatch(appSource, /document\.getElementById\('btn-remove-outside'\)/);
  assert.doesNotMatch(appSource, /setOutsideAddMode|removeOutsidePlot/);
});

test('old taniman_v3 data cannot hydrate active Atok/Paoay state', () => {
  assert.match(appSource, /const\s+STORAGE_KEY\s*=\s*'taniman_v4_atok_paoay'/);
  assert.doesNotMatch(appSource, /taniman_v3/);
});

test('exports and UI copy use Paoay, Atok, Benguet', () => {
  assert.match(appSource, /survey_area:\s*'Paoay, Atok, Benguet'/);
  assert.match(dataSource, /mapTitle:\s*'Paoay'/);
  assert.doesNotMatch(dataSource, /Ambassador|Tublay/);
  const exportStart = appSource.indexOf("document.getElementById('btn-save').onclick");
  assert.notEqual(exportStart, -1, 'save export handler should exist');
  const exportBlock = appSource.slice(exportStart, appSource.indexOf('// ── ROSTER', exportStart));
  assert.match(exportBlock, /plotArea[^\n]+paoay|plot_area,plot_source/);
  assert.doesNotMatch(exportBlock, /ambassador|tublay|outside_tublay|outside_custom/i);
});

test('generated plot crop files match PAOAY_PLOTS entries', async () => {
  const data = loadData();
  const files = await readdir(new URL('../tiles/plots', import.meta.url));
  const plotJpegs = files.filter(name => /^plot_\d{3}\.jpg$/.test(name));
  assert.equal(plotJpegs.length, data.PAOAY_PLOTS.length);
});

test('plot crop directory contains no obsolete outside-area JPEGs', async () => {
  const files = await readdir(new URL('../tiles/plots', import.meta.url));
  assert.deepEqual(files.filter(name => /^outside_\d+\.jpg$/i.test(name)), []);
});
