import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const cropExportSource = await readFile(new URL('../crop-export.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');
const tauriStageSource = await readFile(new URL('../src-tauri/scripts/prepare-dist.mjs', import.meta.url), 'utf8');

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
  assert.match(appSource, /schema_version:\s*5/);
  assert.match(appSource, /recurring annual/);
  assert.match(appSource, /inclusive/);
});

test('export includes a crop lookup, sparse crop counts, and all non-target season rows', () => {
  assert.match(appSource, /CropExport\.buildCropLookupRows\(/);
  assert.match(appSource, /CropExport\.buildPlotCropCounts\(/);
  assert.match(appSource, /folder\.file\('crops\.csv'/);
  assert.match(appSource, /folder\.file\('plot_crop_counts\.csv'/);
  assert.match(appSource, /other_crop_cells/);
  assert.match(appSource, /is_resolved/);
});

test('all season and label text fields are CSV escaped, including raw crop IDs', () => {
  assert.match(appSource, /csvEscape\(row\.season_id\)/);
  assert.match(appSource, /csvEscape\(row\.crop_id\)/);
  assert.match(appSource, /csvEscape\(row\.farmer_id\)/);
  assert.match(cropExportSource, /csvEscape\(crop\.crop_name\)/);
  assert.match(cropExportSource, /csvEscape\(count\.crop_id\)/);
});

test('crop export helpers load before app.js in web and Tauri builds', () => {
  assert.match(htmlSource, /<script src="crop-export\.js"><\/script>[\s\S]*s1\.src = 'app\.js'/);
  assert.match(tauriStageSource, /'crop-picker\.js',\s*'crop-export\.js'/);
});

test('export releases temporary season rows after building compact crop aggregates', () => {
  const lookupBuiltAt = appSource.indexOf('const cropLookupRows = CropExport.buildCropLookupRows');
  const countsBuiltAt = appSource.indexOf('const plotCropCountRows = CropExport.buildPlotCropCounts');
  const releasedAt = appSource.indexOf('allSeasonExportRows.length = 0');
  const zipGenerationAt = appSource.indexOf("zip.generateAsync({type:'blob'})");

  assert.notEqual(lookupBuiltAt, -1);
  assert.notEqual(countsBuiltAt, -1);
  assert.notEqual(releasedAt, -1);
  assert.ok(releasedAt > lookupBuiltAt && releasedAt > countsBuiltAt);
  assert.ok(releasedAt < zipGenerationAt, 'release retained season-row objects before ZIP serialization');
});
