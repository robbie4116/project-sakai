import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const catalogSource = await readFile(new URL('../crop-catalog.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const CUSTOM_UUID = '123e4567-e89b-12d3-a456-426614174000';
const CUSTOM_NAME = '<img src=x onerror=alert(1)>';
const UNKNOWN_ID = 'field<&" onmouseover=alert(1)>';

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const openParen = source.indexOf('(', start);
  let parenDepth = 0;
  let openBrace = -1;
  for (let i = openParen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    if (source[i] === ')') parenDepth -= 1;
    if (parenDepth === 0) {
      openBrace = source.indexOf('{', i);
      break;
    }
  }
  assert.notEqual(openBrace, -1, `${name} body should exist`);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} block was not closed`);
}

async function makeHarness() {
  const targetCrops = [
    { id: 'lettuce', hex: '#22C55E', name: { en: 'Lettuce', tl: 'Letsugas', il: 'Letsugas' } },
    { id: 'potato', hex: '#FFC629', name: { en: 'Potato', tl: 'Patatas', il: 'Patatas' } },
    { id: 'carrot', hex: '#FF6A1F', name: { en: 'Carrot', tl: 'Karot', il: 'Karot' } },
  ];
  const window = { CROPS: targetCrops };
  const localStorage = {
    getItem() {
      return JSON.stringify({ version: 1, rows: [{ id: CUSTOM_UUID, name: CUSTOM_NAME, hex: '#AABBCC' }] });
    },
    setItem() {},
  };
  window.localStorage = localStorage;
  window.fetchCustomCrops = async () => { throw new Error('catalog unavailable'); };
  vm.runInNewContext(catalogSource, { window, localStorage }, { filename: 'crop-catalog.js' });

  const plot = {
    seasons: [
      { cropId: `crop_${CUSTOM_UUID}`, start: '01-01', end: '12-31', cells: [1, 2] },
      { cropId: UNKNOWN_ID, start: '01-01', end: '12-31', cells: [2, 3] },
    ],
    farmerId: 'F-1',
    farmer: 'Field Farmer',
  };
  const state = { plots: { 0: plot }, plotIdx: 0, viewMonths: 4095, lang: 'en', mixedStyle: 'diagonal' };
  const catalog = window.TANIMAN_CROP_CATALOG;
  catalog.registerReferences(state.plots);
  assert.deepEqual(Array.from(catalog.all(), crop => crop.id).slice(0, 3), ['lettuce', 'potato', 'carrot']);
  await assert.rejects(catalog.refresh(), /catalog unavailable/);

  const document = {
    root: null,
    getElementById() { return this.root; },
    createElement() {
      return { className: '', innerHTML: '', children: [], appendChild(child) { this.children.push(child); } };
    },
  };
  const context = {
    CROPS: catalog.all(),
    CropCatalog: catalog,
    state,
    PLOTS: [{ idx: 0 }],
    GRID: 50,
    ALL_MONTHS: 4095,
    document,
    tr: key => key,
    ensurePlot: () => plot,
    isValidMmdd: value => /^\d{2}-\d{2}$/.test(value),
    rangeWrapsYear: () => false,
    plotHasPaint: () => true,
    plotDisplayLabel: () => 'Plot 1',
    updateMapPlot() {},
    closeRoster() {},
    openPlot() {},
    scrim: { classList: { add() {} } },
    map: {},
  };
  const functionNames = [
    'cropIndexFromId', 'escapeHtml', 'cellVisibleCropIds', 'cellVisibleCrops',
    'plotCompositionForView', 'drawMixedCell', 'compositionBarHtml', 'updateLegend',
    'renderScheduleSummary', 'buildRosterData', 'renderRoster',
  ];
  const funcs = functionNames.map(name => extractFunction(appSource, name)).join('\n');
  const helpers = `
    function seasonIntersectsViewMonths() { return true; }
  `;
  vm.createContext(context);
  vm.runInContext(`${helpers}\n${funcs}`, context, { filename: 'app-view-functions.js' });
  return { context, catalog, state, plot, document, crops: catalog.all() };
}

test('map composition and bar count custom and unresolved crop seasons after catalog fetch failure', async () => {
  const { context, catalog, plot, crops } = await makeHarness();
  const composition = vm.runInContext('plotCompositionForView(0)', context);
  const customIndex = crops.findIndex(crop => crop.id === `crop_${CUSTOM_UUID}`);
  const unknownIndex = crops.findIndex(crop => crop.id === UNKNOWN_ID);

  assert.ok(customIndex >= 0);
  assert.ok(unknownIndex >= 0);
  assert.equal(composition.counts[customIndex], 2);
  assert.equal(composition.counts[unknownIndex], 2);
  assert.equal(composition.visiblePaintedCells, 3);
  assert.equal(composition.isMixed, true);
  assert.equal(catalog.byId(UNKNOWN_ID).hex, '#9CA3AF');
  assert.equal(plot.seasons.length, 2, 'failed catalog refresh must not discard season records');

  const barHtml = vm.runInContext('compositionBarHtml(plotCompositionForView(0))', context);
  assert.equal((barHtml.match(/class="mix-seg"/g) || []).length, 2);
  assert.ok(barHtml.includes('#AABBCC'));
  assert.ok(barHtml.includes('#9CA3AF'));
});

test('legend and schedule summary show all crop labels as text, including an unresolved raw ID', async () => {
  const { context, document, crops } = await makeHarness();
  const root = { innerHTML: '', children: [], appendChild(child) { this.children.push(child); } };
  document.root = root;
  vm.runInContext('updateLegend()', context);
  const legendMarkup = root.children.map(row => row.innerHTML).join('\n');

  assert.ok(legendMarkup.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(legendMarkup.includes('Unknown crop (field&lt;&amp;&quot; onmouseover=alert(1)&gt;)'));
  assert.ok(legendMarkup.includes('2 cells · 1 plots'));
  assert.ok(!legendMarkup.includes(CUSTOM_NAME), 'custom crop name must not be inserted as markup');
  assert.ok(!legendMarkup.includes(UNKNOWN_ID), 'raw unresolved ID must be escaped before HTML insertion');
  assert.ok(crops.some(crop => crop.id === UNKNOWN_ID));

  root.innerHTML = '';
  vm.runInContext('renderScheduleSummary()', context);
  assert.ok(root.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(root.innerHTML.includes('Unknown crop (field&lt;&amp;&quot; onmouseover=alert(1)&gt;)'));
  assert.ok(root.innerHTML.includes('· 01-01-12-31'));
  assert.ok(!root.innerHTML.includes(CUSTOM_NAME));
  assert.ok(!root.innerHTML.includes(UNKNOWN_ID));
});

test('farmer roster counts and safely renders custom and unresolved crop classes', async () => {
  const { context, document, crops } = await makeHarness();
  const roster = vm.runInContext('buildRosterData()', context);
  const farmer = roster.find(row => row.id === 'F-1');
  const customIndex = crops.findIndex(crop => crop.id === `crop_${CUSTOM_UUID}`);
  const unknownIndex = crops.findIndex(crop => crop.id === UNKNOWN_ID);
  assert.equal(farmer.cropTotals[customIndex], 2);
  assert.equal(farmer.cropTotals[unknownIndex], 2);
  assert.equal(farmer.patchTotal, 4);

  const root = { innerHTML: '', querySelectorAll: () => [] };
  const elements = new Map([
    ['roster-stats', { textContent: '' }],
    ['roster-list', root],
  ]);
  document.getElementById = id => elements.get(id) || null;
  vm.runInContext('renderRoster("")', context);
  assert.ok(root.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(root.innerHTML.includes('Unknown crop (field&lt;&amp;&quot; onmouseover=alert(1)&gt;)'));
  assert.ok(!root.innerHTML.includes(CUSTOM_NAME));
  assert.ok(!root.innerHTML.includes(UNKNOWN_ID));
});

test('mixed cell draw uses catalog colors for custom and unresolved crop IDs', async () => {
  const { context, crops } = await makeHarness();
  const customIndex = crops.findIndex(crop => crop.id === `crop_${CUSTOM_UUID}`);
  const unknownIndex = crops.findIndex(crop => crop.id === UNKNOWN_ID);
  const drawnColors = [];
  const ctx = {
    set fillStyle(value) { this._fillStyle = value; },
    get fillStyle() { return this._fillStyle; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { drawnColors.push(this.fillStyle); }, fillRect() { drawnColors.push(this.fillStyle); },
  };
  context.ctx = ctx;
  context.drawnColors = drawnColors;
  context.customIndex = customIndex;
  context.unknownIndex = unknownIndex;
  vm.runInContext('drawMixedCell(ctx, 0, 0, 10, 10, [customIndex, unknownIndex], "diagonal")', context);
  assert.deepEqual(drawnColors, ['#AABBCC', '#9CA3AF']);
});

test('five overlapping crop classes all appear in the mixed-cell drawing used for label PNGs', async () => {
  const { context, catalog, plot, crops } = await makeHarness();
  vm.runInContext(`state.plots[0].seasons.push(
    { cropId: 'lettuce', start: '01-01', end: '12-31', cells: [2] },
    { cropId: 'potato', start: '01-01', end: '12-31', cells: [2] },
    { cropId: 'carrot', start: '01-01', end: '12-31', cells: [2] },
  )`, context);
  catalog.registerReferences(context.state.plots);
  assert.deepEqual(
    Array.from(vm.runInContext('cellVisibleCropIds(state.plots[0], 2)', context)),
    [`crop_${CUSTOM_UUID}`, UNKNOWN_ID, 'lettuce', 'potato', 'carrot'],
  );

  const drawnColors = [];
  const ctx = {
    set fillStyle(value) { this._fillStyle = value; },
    get fillStyle() { return this._fillStyle; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { drawnColors.push(this.fillStyle); }, fillRect() { drawnColors.push(this.fillStyle); },
  };
  context.ctx = ctx;
  vm.runInContext('drawMixedCell(ctx, 0, 0, 10, 10, cellVisibleCropIds(state.plots[0], 2).map(cropIndexFromId).filter(i => i >= 0), "diagonal")', context);

  const expectedColors = ['#AABBCC', '#9CA3AF', '#22C55E', '#FFC629', '#FF6A1F'];
  assert.equal(crops.length, 5);
  assert.deepEqual(drawnColors, expectedColors);
});

test('many-class composition bars allocate at most 100 percent and do not force overflow', async () => {
  const { context } = await makeHarness();
  const classCount = 30;
  const counts = Array(classCount).fill(1);
  const percentages = Array(classCount).fill(1 / classCount);
  context.CROPS.push(...Array.from({ length: classCount - context.CROPS.length }, (_, index) => ({
    id: `many-${index}`,
    hex: `#${String(index + 1).padStart(6, '0')}`,
    name: { en: `Many ${index}` },
  })));
  context.composition = { totalVisibleCells: classCount, counts, percentages };

  const markup = vm.runInContext('compositionBarHtml(composition)', context);
  const widths = Array.from(markup.matchAll(/width:([\d.]+)%/g), match => Number(match[1]));
  assert.equal(widths.length, classCount, 'each crop class should have a segment');
  assert.ok(widths.every(width => width > 0));
  assert.ok(widths.reduce((sum, width) => sum + width, 0) <= 100.000001);
  assert.match(cssSource, /\.mix-seg\s*\{[^}]*min-width:\s*0(?:px)?\s*;/s);
});
