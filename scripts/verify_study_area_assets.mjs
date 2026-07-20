import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import vm from 'node:vm';

const dataSource = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8').catch(() => '');
const sandbox = { window: {} };
vm.runInNewContext(dataSource, sandbox);
const { ATOK_POLY, PAOAY_POLY, PAOAY_PLOTS } = sandbox.window;

assert.ok(Array.isArray(ATOK_POLY) && ATOK_POLY.length > 0, 'ATOK_POLY missing');
assert.ok(Array.isArray(PAOAY_POLY) && PAOAY_POLY.length > 0, 'PAOAY_POLY missing');
assert.ok(Array.isArray(PAOAY_PLOTS) && PAOAY_PLOTS.length > 0, 'PAOAY_PLOTS missing');

for (const [idx, plot] of PAOAY_PLOTS.entries()) {
  assert.equal(plot.idx, idx, `plot idx mismatch at ${idx}`);
  assert.equal(plot.area, 'paoay', `plot ${idx} area`);
  assert.equal(plot.source, 'field_grid', `plot ${idx} source`);
  assert.equal(plot.tilePath, `tiles/plots/plot_${String(idx).padStart(3, '0')}.jpg`);
  for (const key of ['latS', 'latN', 'lngW', 'lngE', 'centerLat', 'centerLng', 'r', 'c']) {
    assert.equal(typeof plot[key], 'number', `plot ${idx} missing numeric ${key}`);
  }
}

const plotFiles = (await readdir(new URL('../tiles/plots', import.meta.url)))
  .filter(name => /^plot_\d{3}\.jpg$/.test(name))
  .sort();
assert.equal(plotFiles.length, PAOAY_PLOTS.length, 'plot JPEG count must match PAOAY_PLOTS');
for (let idx = 0; idx < PAOAY_PLOTS.length; idx += 1) {
  assert.equal(plotFiles[idx], `plot_${String(idx).padStart(3, '0')}.jpg`);
}

const generatedBlock = dataSource.match(/BEGIN GENERATED STUDY AREA DATA([\s\S]*?)END GENERATED STUDY AREA DATA/)?.[1]
  ?? dataSource.slice(0, dataSource.indexOf('window.CROPS'));
assert.doesNotMatch(generatedBlock, /ambassador|tublay|outside_tublay|outside_custom|outside_\d{3}\.jpg/i);
assert.doesNotMatch(JSON.stringify(PAOAY_PLOTS), /ambassador|tublay|outside_tublay|outside_custom|outside_\d{3}\.jpg/i);
let runtimeCount = 'not-refactored-yet';
if (appSource.includes('const PLOTS = PAOAY_PLOTS')) {
  const marker = appSource.indexOf('const MONTH_SHORT');
  assert.notEqual(marker, -1, 'expected app constants before MONTH_SHORT');
  const appSandbox = { window: sandbox.window, console };
  vm.runInNewContext(`${appSource.slice(0, marker)}
globalThis.__runtimeCounts = { plots: PLOTS.length, core: CORE_PLOT_COUNT };`, appSandbox);
  assert.equal(appSandbox.__runtimeCounts.plots, PAOAY_PLOTS.length, 'runtime PLOTS length must match PAOAY_PLOTS');
  assert.equal(appSandbox.__runtimeCounts.core, PAOAY_PLOTS.length, 'runtime CORE_PLOT_COUNT must match PAOAY_PLOTS');
  runtimeCount = appSandbox.__runtimeCounts.plots;
}

console.log(`study-area assets ok: plots=${PAOAY_PLOTS.length} files=${plotFiles.length} runtime=${runtimeCount}`);
