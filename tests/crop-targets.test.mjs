import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataSource = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');
const prepareDistSource = await readFile(new URL('../src-tauri/scripts/prepare-dist.mjs', import.meta.url), 'utf8');

test('default classes include the paper targets and non-crop land cover', () => {
  assert.match(dataSource, /id:'cabbage'/);
  assert.match(dataSource, /id:'potato'/);
  assert.match(dataSource, /id:'carrot'/);
  for (const id of ['other_cultivated','forest','built_up','bare_fallow']) assert.ok(dataSource.includes(`id:'${id}'`));
});

test('season utilities load before app startup', () => {
  assert.ok(htmlSource.indexOf('season-utils.js') > -1);
  assert.ok(htmlSource.indexOf('season-utils.js') < htmlSource.indexOf('app.js'));
});

test('desktop static bundle includes season utilities', () => {
  assert.match(prepareDistSource, /season-utils\.js/);
});

test('keyboard crop shortcuts select only the three target crops', () => {
  assert.match(appSource, /CROPS\.filter\(crop\s*=>\s*CropCatalog\.isTarget\(crop\.id\)\)/);
  assert.match(appSource, /state\.selectedCropId\s*=\s*targetCrops\[\+e\.key\s*-\s*1\]\.id/);
  assert.doesNotMatch(appSource, /e\.key === '4'/);
});

test('global keyboard shortcuts ignore focused form controls', () => {
  assert.match(appSource, /tagName\s*===\s*'INPUT'/);
  assert.match(appSource, /tagName\s*===\s*'TEXTAREA'/);
  assert.match(appSource, /tagName\s*===\s*'SELECT'/);
});
