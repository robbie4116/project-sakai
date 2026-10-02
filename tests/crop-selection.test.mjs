import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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

const targets = [
  { id: 'lettuce' },
  { id: 'potato' },
  { id: 'carrot' },
];

function makeCatalog() {
  return {
    isTarget: id => targets.some(crop => crop.id === id),
  };
}

test('legacy crop indexes migrate to stable target IDs before first render', () => {
  const migrate = runFunction(appSource, 'migrateCropSelection');
  for (const [index, cropId] of ['lettuce', 'potato', 'carrot'].entries()) {
    const state = { crop: index };
    migrate(state, targets, makeCatalog());
    assert.equal(state.selectedCropId, cropId);
    assert.equal(Object.hasOwn(state, 'crop'), false);
  }
});

test('persisted selected crop ID wins over legacy index and unknown IDs are retained', () => {
  const migrate = runFunction(appSource, 'migrateCropSelection');
  const state = { crop: 1, selectedCropId: 'crop_custom-uuid' };

  migrate(state, targets, makeCatalog());

  assert.equal(state.selectedCropId, 'crop_custom-uuid');
  assert.equal(Object.hasOwn(state, 'crop'), false);
});

test('invalid or missing legacy selection defaults to lettuce', () => {
  const migrate = runFunction(appSource, 'migrateCropSelection');
  for (const state of [{}, { crop: 7 }, { crop: '1' }]) {
    migrate(state, targets, makeCatalog());
    assert.equal(state.selectedCropId, 'lettuce');
  }
  const blankSavedId = { selectedCropId: '   ', crop: 2 };
  migrate(blankSavedId, targets, makeCatalog());
  assert.equal(blankSavedId.selectedCropId, 'carrot');
});

test('selected custom ID remains stable when catalog ordering changes', () => {
  const isCropSelected = runFunction(appSource, 'isCropSelected');
  const selectedId = 'crop_custom-uuid';
  const initial = [{ id: 'carrot' }, { id: selectedId }, { id: 'lettuce' }];
  const refreshed = [{ id: 'lettuce' }, { id: 'carrot' }, { id: selectedId }];

  assert.deepEqual(initial.filter(crop => isCropSelected(crop, selectedId)).map(crop => crop.id), [selectedId]);
  assert.deepEqual(refreshed.filter(crop => isCropSelected(crop, selectedId)).map(crop => crop.id), [selectedId]);
  assert.match(appSource, /state\.selectedCropId\s*=\s*crop\.id/);
  assert.doesNotMatch(appSource, /state\.crop\s*=|CROPS\[state\.crop\]/);
});

test('a selected crop missing from the catalog stays visible as an unresolved placeholder', () => {
  const cropsForPalette = runFunction(appSource, 'cropsForPalette');
  const placeholder = { id: 'crop_missing', hex: '#9CA3AF', isResolved: false, name: { en: 'Unknown crop (crop_missing)' } };
  const visible = cropsForPalette(targets, 'crop_missing', { byId: () => placeholder });

  assert.equal(visible.length, targets.length + 1);
  assert.equal(visible.at(-1), placeholder);
});

test('unresolved selected crop blocks new paint while retaining its selected ID', () => {
  const activePaintSeasonData = runFunction(appSource, 'activePaintSeasonData', {
    state: { selectedCropId: 'crop_missing', paintStartDate: '06-01', paintEndDate: '06-30' },
    CROPS: targets,
    CropCatalog: {
      byId: id => ({ id, hex: '#9CA3AF', isResolved: false }),
      isResolved: () => false,
    },
    isValidMmdd: value => /^\d{2}-\d{2}$/.test(value),
  });
  const data = activePaintSeasonData();

  assert.equal(data, null);
  const resolved = runFunction(appSource, 'activePaintSeasonData', {
    state: { selectedCropId: 'crop_saved', paintStartDate: '06-01', paintEndDate: '06-30' },
    CropCatalog: {
      byId: id => ({ id, hex: '#118833', isResolved: true }),
      isResolved: id => id === 'crop_saved',
    },
    isValidMmdd: value => /^\d{2}-\d{2}$/.test(value),
  })();
  assert.deepEqual(JSON.parse(JSON.stringify(resolved)), {
    cropId: 'crop_saved', start: '06-01', end: '06-30',
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

test('plot crop references register before startup render and after remote merges', () => {
  const startup = appSource.indexOf('// ── INIT ──');
  const firstRegistration = appSource.indexOf('CropCatalog.registerReferences(state.plots)');
  const remoteMerge = extractFunction(appSource, 'afterRemoteMerge');

  assert.ok(firstRegistration >= 0 && firstRegistration < startup);
  assert.ok(remoteMerge.indexOf('CropCatalog.registerReferences(state.plots)') < remoteMerge.indexOf('updateMapPlot(idx)'));
  assert.match(appSource, /CropCatalog\.subscribe\(/);
  assert.match(calendarSource, /CropCatalog\.subscribe\(/);
});
