import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataSource = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');
const prepareDistSource = await readFile(new URL('../src-tauri/scripts/prepare-dist.mjs', import.meta.url), 'utf8');

test('target crops are exactly lettuce, potato, carrot', () => {
  assert.match(dataSource, /id:'lettuce'/);
  assert.match(dataSource, /id:'potato'/);
  assert.match(dataSource, /id:'carrot'/);
  assert.doesNotMatch(dataSource, /id:'cabbage'|id:'wombok'/);
});

test('season utilities load before app startup', () => {
  assert.ok(htmlSource.indexOf('season-utils.js') > -1);
  assert.ok(htmlSource.indexOf('season-utils.js') < htmlSource.indexOf('app.js'));
});

test('desktop static bundle includes season utilities', () => {
  assert.match(prepareDistSource, /season-utils\.js/);
});

test('keyboard crop shortcuts are bounded by the active crop list', () => {
  assert.match(appSource, /\+e\.key\s*<=\s*CROPS\.length/);
  assert.doesNotMatch(appSource, /e\.key === '4'/);
});
