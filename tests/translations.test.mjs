import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Classes = require('../classes.js');

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
  const data = loadData();
  const { STRINGS, STRINGS_LEGACY } = data;
  const supported = ['en', 'il', 'tl'];

  assert.deepEqual(sortedKeys(STRINGS), supported);
  assert.deepEqual(sortedKeys(STRINGS_LEGACY), supported);
  assert.equal('CROPS' in data, false, 'crops are classes now; data.js no longer defines CROPS');

  for (const cls of Classes.ALL) {
    assert.deepEqual(sortedKeys(cls.name), supported, `${cls.key} should only define EN, IL, and TL names`);
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

test('planting-harvest control strings exist in every supported language', () => {
  const { STRINGS } = loadData();
  const required = [
    'schedulePlantingHarvest',
    'seasonPlanted',
    'seasonHarvest',
    'seasonMonth',
    'seasonDay',
    'seasonPresentFromTo',
    'seasonContinuesNextYear',
    'seasonDateResetAllYear',
  ];

  for (const lang of ['en', 'tl', 'il']) {
    for (const key of required) {
      assert.equal(typeof STRINGS[lang][key], 'string', `${lang}.${key} should exist`);
      assert.notEqual(STRINGS[lang][key].trim(), '', `${lang}.${key} should not be blank`);
    }
    assert.match(STRINGS[lang].seasonPresentFromTo, /\{crop\}/);
    assert.match(STRINGS[lang].seasonPresentFromTo, /\{start\}/);
    assert.match(STRINGS[lang].seasonPresentFromTo, /\{end\}/);
  }
});
