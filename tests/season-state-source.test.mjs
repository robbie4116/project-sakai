import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('plot state stores seasons instead of crop-index month mask cells', () => {
  assert.match(appSource, /function emptySeasons\(/);
  assert.match(appSource, /seasons:\s*emptySeasons\(\)/);
  assert.doesNotMatch(appSource, /function emptyCells\(\)/);
});

test('painting adds cropId date seasons and does not OR month masks', () => {
  assert.match(appSource, /function addCellsToPaintSeason/);
  assert.match(appSource, /cropId:\s*crop\.id/);
  assert.doesNotMatch(appSource, /p\.cells\[state\.crop\]\[k\]\s*\|=/);
});

test('erase removes cells from all seasons and prunes empty seasons', () => {
  assert.match(appSource, /function eraseCellsFromSeasons/);
  assert.match(appSource, /season\.cells\.filter/);
  assert.match(appSource, /p\.seasons\s*=\s*\(p\.seasons\s*\|\|\s*\[\]\)\.filter/);
});

test('visible crop calculations read seasons and active view months', () => {
  assert.match(appSource, /function cellVisibleCropIds/);
  assert.match(appSource, /seasonIntersectsViewMonths/);
  assert.doesNotMatch(appSource, /p\.cells\[c\]\[cellIdx\]/);
});

test('plot details schedule summary renders season ranges', () => {
  assert.match(appSource, /function renderScheduleSummary/);
  assert.match(appSource, /season\.start/);
  assert.match(appSource, /season\.end/);
});

test('export writes ML-ready seasons csv with georeferenced rows', () => {
  assert.match(appSource, /let seasonsCsv\s*=/);
  assert.match(appSource, /season_id,cell_idx,cell_row,cell_col,crop_id,start_mmdd,end_mmdd,wraps_year/);
  assert.match(appSource, /seasonExportRows,\s*\n\}\s*=\s*SeasonUtils/);
  assert.match(appSource, /seasonExportRows/);
  assert.match(appSource, /folder\.file\('seasons\.csv',\s*seasonsCsv\)/);
});

test('metadata documents recurring inclusive date windows', () => {
  assert.match(appSource, /schema_version:\s*4/);
  assert.match(appSource, /recurring annual/);
  assert.match(appSource, /inclusive/);
});
