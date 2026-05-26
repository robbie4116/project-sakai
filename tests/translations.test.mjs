import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const dataSource = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');

function loadData() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(dataSource, context);
  return context.window;
}

function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

test('supported language data is limited to English, Tagalog, and Ilocano', () => {
  const { CROPS, STRINGS, STRINGS_LEGACY } = loadData();
  const supported = ['en', 'il', 'tl'];

  assert.deepEqual(sortedKeys(STRINGS), supported);
  assert.deepEqual(sortedKeys(STRINGS_LEGACY), supported);

  for (const crop of CROPS) {
    assert.deepEqual(sortedKeys(crop.name), supported, `${crop.id} should only define EN, IL, and TL names`);
  }
});

test('language switcher only exposes English, Tagalog, and Ilocano', () => {
  const matches = [...htmlSource.matchAll(/data-lang="([^"]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(matches, ['en', 'il', 'tl']);
  assert.doesNotMatch(htmlSource, />IB</);
});

test('unsupported saved or URL languages normalize to English', () => {
  assert.match(appSource, /if\s*\(!Object\.prototype\.hasOwnProperty\.call\(T,\s*state\.lang\)\)\s*state\.lang\s*=\s*'en';/);
});

test('Ilocano translations cover the complete English string surface', () => {
  const { STRINGS } = loadData();

  assert.deepEqual(sortedKeys(STRINGS.il), sortedKeys(STRINGS.en));

  for (const key of Object.keys(STRINGS.en)) {
    const value = STRINGS.il[key];
    assert.equal(typeof value, 'string', `IL ${key} should be a string`);
    assert.notEqual(value.trim(), '', `IL ${key} should not be blank`);
  }
});
