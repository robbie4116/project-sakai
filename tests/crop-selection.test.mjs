import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Classes = require('../classes.js');

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');
const prepareDistSource = await readFile(new URL('../src-tauri/scripts/prepare-dist.mjs', import.meta.url), 'utf8');
const calendarSource = await readFile(new URL('../calendar.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `expected ${name}() to exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`expected ${name}() to have a complete body`);
}

function runFunction(source, name, globals = {}) {
  const context = { ...globals };
  vm.createContext(context);
  vm.runInContext(`${extractFunction(source, name)}; this.result = ${name};`, context);
  return context.result;
}

const LETTUCE = '11111111-1111-4111-8111-111111111111';

test('the brush selection starts empty on every load and is never restored', () => {
  assert.match(appSource, /state\.selection = \{ classKey: null, cropId: null, remark: '' \};/);
  assert.match(appSource, /state\.paintStartDate = null;\s*state\.paintEndDate = null;/);
  assert.match(appSource, /delete state\.selectedCropId;/);
  const saveState = extractFunction(appSource, 'saveState');
  assert.match(saveState, /delete out\.selection;/);
  assert.match(saveState, /delete out\.paintStartDate;/);
  assert.match(saveState, /delete out\.paintEndDate;/);
});

test('picking a crop name selects class 4 with that crop id', () => {
  const selectCrop = extractFunction(appSource, 'selectCrop');
  assert.match(selectCrop, /state\.selection\.classKey = 'other_cultivated';/);
  assert.match(selectCrop, /state\.selection\.cropId = crop\.id;/);
  assert.doesNotMatch(appSource, /state\.crop\s*=|CROPS\[state\.crop\]|state\.selectedCropId\s*=/);
});

test('an unresolved class-4 crop name blocks new paint; a resolved one paints', () => {
  const run = (cropResolved) => runFunction(appSource, 'activePaintSeasonData', {
    state: {
      selection: { classKey: 'other_cultivated', cropId: LETTUCE, remark: '' },
      paintStartDate: '06-01',
      paintEndDate: '06-30',
      referenceYear:2024, fieldId:'', plotIdx:0,
    },
    Classes,
    CropCatalog: { isResolved: id => cropResolved && id === LETTUCE },
    currentSelectionStatus:()=>({ready:cropResolved}),
  })();

  assert.equal(run(false), null);
  assert.deepEqual(JSON.parse(JSON.stringify(run(true))), {
    classId: 4, cropId: LETTUCE, remark: '', start: '06-01', end: '06-30', referenceYear:2024, fieldId:'',
  });
});

test('catalog selection refresh starts asynchronously and repeats when the window regains focus', async () => {
  let focusListener;
  let refreshes = 0;
  const eventTarget = {
    addEventListener(type, listener) { if (type === 'focus') focusListener = listener; },
    removeEventListener() {},
  };
  const wire = runFunction(appSource, 'wireCropCatalogRefresh', {
    console: { warn() {} },
  });
  const result = wire({ refresh() { refreshes++; return Promise.resolve(); } }, eventTarget);

  assert.equal(refreshes, 1);
  assert.equal(typeof focusListener, 'function');
  focusListener();
  assert.equal(refreshes, 2);
  assert.equal(typeof result, 'function');
});

test('catalog refresh wiring makes no call and installs no focus handler in Tauri', () => {
  let refreshes = 0;
  let listeners = 0;
  const eventTarget = {
    __TAURI__: {},
    addEventListener() { listeners++; },
  };
  const wire = runFunction(appSource, 'wireCropCatalogRefresh', {
    console: { warn() {} },
  });

  wire({ refresh() { refreshes++; } }, eventTarget);

  assert.equal(refreshes, 0);
  assert.equal(listeners, 0);
});

test('catalog script loads after data and Supabase adapter before app, and is staged for Tauri', () => {
  const dataIndex = htmlSource.indexOf('<script src="data.js"></script>');
  const supabaseIndex = htmlSource.indexOf('<script src="supabase-sync.js"></script>');
  const catalogIndex = htmlSource.indexOf('<script src="crop-catalog.js"></script>');
  const appIndex = htmlSource.indexOf("s1.src = 'app.js'");

  assert.ok(dataIndex >= 0 && supabaseIndex > dataIndex);
  assert.ok(catalogIndex > supabaseIndex && catalogIndex < appIndex);
  assert.match(prepareDistSource, /'crop-catalog\.js'/);
});

test('plot crop references register before startup render and after remote changes', () => {
  const startup = appSource.indexOf('// ── INIT ──');
  const firstRegistration = appSource.indexOf('CropCatalog.registerReferences(state.plots)');
  const remoteChange = extractFunction(appSource, 'afterRemoteChange');

  assert.ok(firstRegistration >= 0 && firstRegistration < startup);
  assert.ok(remoteChange.indexOf('CropCatalog.registerReferences(state.plots)') < remoteChange.indexOf('updateMapPlot(idx)'));
  assert.match(appSource, /CropCatalog\.subscribe\(/);
  assert.match(calendarSource, /CropCatalog\.subscribe\(/);
});
