import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');
const tauriStageSource = await readFile(new URL('../src-tauri/scripts/prepare-dist.mjs', import.meta.url), 'utf8');

test('plot state stores seasons instead of crop-index month mask cells', () => {
  assert.match(appSource, /function emptySeasons\(/);
  assert.match(appSource, /seasons:\s*emptySeasons\(\)/);
  assert.doesNotMatch(appSource, /function emptyCells\(\)/);
});

test('painting adds cells to the deterministic season for the selection and queues a delta', () => {
  assert.match(appSource, /function addCellsToPaintSeason\(idx, p, cellIds\)/);
  assert.match(appSource, /const id = Classes\.seasonId\(idx, meta\);/);
  assert.match(appSource, /queueSeasonChange\(idx, season, added, \[\]\)/);
});

test('painting only touches in-bounds cells under the brush', () => {
  assert.match(appSource, /GridMath\.brushCells\(plot, cell\.r, cell\.c, size\)/);
});

test('erase removes cells from all seasons, queues removals and prunes empty seasons', () => {
  assert.match(appSource, /function eraseCellsFromSeasons\(idx, p, cellIds\)/);
  assert.match(appSource, /queueSeasonChange\(idx, season, \[\], removed\)/);
  assert.match(appSource, /p\.seasons\s*=\s*p\.seasons\.filter\(season => season\.cells && season\.cells\.length\)/);
});

test('visible colors read seasons and active view months', () => {
  assert.match(appSource, /function cellVisibleColors/);
  assert.match(appSource, /seasonIntersectsViewMonths/);
  assert.doesNotMatch(appSource, /p\.cells\[c\]\[cellIdx\]/);
});

test('plot details schedule summary renders season ranges by class', () => {
  assert.match(appSource, /function renderScheduleSummary/);
  assert.match(appSource, /Classes\.className\(season\.classId, state\.lang\)/);
  assert.match(appSource, /season\.start/);
  assert.match(appSource, /season\.end/);
});

test('export writes the label-export files', () => {
  for (const name of ['seasons.csv', 'fields.csv', 'classes.csv', 'plots.csv', 'metadata.json']) {
    assert.match(appSource, new RegExp(`folder\\.file\\('${name.replace('.', '\\.')}'`));
  }
  assert.match(appSource, /LabelExport\.buildExport\(/);
  assert.doesNotMatch(appSource, /farmers\.csv|plot_crop_counts\.csv|crops\.csv|labels\.csv/);
});

test('export flushes pending edits before building', () => {
  const handler = appSource.slice(appSource.indexOf("document.getElementById('btn-save').onclick"));
  assert.ok(handler.indexOf('await flushCloudSync()') < handler.indexOf('LabelExport.buildExport('));
});

test('label PNGs grey out-of-bounds cells', () => {
  assert.match(appSource, /oct\.fillStyle = '#404040';/);
});

test('new modules load before app.js in web and Tauri builds', () => {
  const modules = ['grid.js', 'classes.js', 'season-outbox.js', 'field-ids.js', 'label-export.js', 'class-picker.js'];
  for (const name of modules) {
    assert.match(htmlSource, new RegExp(`<script src="${name.replace('.', '\\.')}"><\\/script>[\\s\\S]*s1\\.src = 'app\\.js'`));
    assert.match(tauriStageSource, new RegExp(`'${name.replace('.', '\\.')}'`));
  }
  assert.doesNotMatch(htmlSource + tauriStageSource, /crop-export\.js/);
});
