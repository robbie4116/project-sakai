import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Classes = require('../classes.js');
const GridMath = require('../grid.js');

const catalogSource = await readFile(new URL('../crop-catalog.js', import.meta.url), 'utf8');
const seasonSource = await readFile(new URL('../season-utils.js', import.meta.url), 'utf8');
const classesSource = await readFile(new URL('../classes.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const CUSTOM_UUID = '123e4567-e89b-12d3-a456-426614174000';
const CUSTOM_NAME = '<img src=x onerror=alert(1)>';
const UNKNOWN_ID = 'field<&" onmouseover=alert(1)>';
const REMARK = '<b>weeds</b>';

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
  const window = {};
  const localStorage = {
    getItem() {
      return JSON.stringify({ version: 1, rows: [{ id: CUSTOM_UUID, name: CUSTOM_NAME, hex: '#AABBCC' }] });
    },
    setItem() {},
  };
  window.localStorage = localStorage;
  window.fetchCustomCrops = async () => { throw new Error('catalog unavailable'); };
  const catalogContext = vm.createContext({ window, localStorage });
  vm.runInContext(seasonSource, catalogContext, { filename: 'season-utils.js' });
  vm.runInContext(classesSource, catalogContext, { filename: 'classes.js' });
  vm.runInContext(catalogSource, catalogContext, { filename: 'crop-catalog.js' });

  const plot = {
    seasons: [
      { id: 'a', classId: 4, cropId: CUSTOM_UUID, remark: '', start: '01-01', end: '12-31', cells: [1, 2] },
      { id: 'b', classId: 4, cropId: UNKNOWN_ID, remark: '', start: '01-01', end: '12-31', cells: [2, 3] },
      { id: 'c', classId: null, cropId: null, remark: REMARK, start: '01-01', end: '12-31', cells: [5] },
    ],
  };
  const state = { plots: { 0: plot }, plotIdx: 0, viewMonths: 4095, lang: 'en', mixedStyle: 'diagonal' };
  const catalog = window.TANIMAN_CROP_CATALOG;
  catalog.registerReferences(state.plots);
  await assert.rejects(catalog.refresh(), /catalog unavailable/);

  const document = {
    root: null,
    getElementById() { return this.root; },
  };
  const context = {
    Classes,
    RFLabels: require('../rf-labels.js'),
    GridMath,
    CropCatalog: catalog,
    state,
    PLOTS: [{ idx: 0, validCols: 50, validRows: 50 }],
    GRID: 50,
    ALL_MONTHS: 4095,
    document,
    tr: key => key,
    ensurePlot: () => plot,
    isValidMmdd: value => /^\d{2}-\d{2}$/.test(value),
    rangeWrapsYear: () => false,
  };
  const functionNames = [
    'escapeHtml', 'seasonHex', 'cellVisibleColors', 'plotCompositionForView',
    'drawMixedCell', 'compositionBarHtml', 'updateLegend', 'renderScheduleSummary',
  ];
  const funcs = functionNames.map(name => extractFunction(appSource, name)).join('\n');
  const helpers = `
    function seasonIntersectsViewMonths() { return true; }
  `;
  vm.createContext(context);
  vm.runInContext(`${helpers}\n${funcs}`, context, { filename: 'app-view-functions.js' });
  return { context, catalog, state, plot, document };
}

function recordingCtx(drawnColors) {
  return {
    set fillStyle(value) { this._fillStyle = value; },
    get fillStyle() { return this._fillStyle; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { drawnColors.push(this.fillStyle); }, fillRect() { drawnColors.push(this.fillStyle); },
  };
}

test('map composition counts cells per class, including unresolved crop names, after catalog fetch failure', async () => {
  const { context, catalog, plot } = await makeHarness();
  const composition = vm.runInContext('plotCompositionForView(0)', context);

  assert.equal(composition.counts[Classes.legendIndex(4)], 3, 'class-4 cells are counted once each');
  assert.equal(composition.counts[Classes.legendIndex(null)], 1);
  assert.equal(composition.visiblePaintedCells, 4);
  assert.equal(composition.emptyCells, 2500 - 4);
  assert.equal(composition.isMixed, true);
  assert.equal(composition.top.key, 'other_cultivated');
  assert.equal(catalog.byId(UNKNOWN_ID).hex, '#9CA3AF');
  assert.equal(plot.seasons.length, 3, 'failed catalog refresh must not discard season records');

  const barHtml = vm.runInContext('compositionBarHtml(plotCompositionForView(0))', context);
  assert.equal((barHtml.match(/class="mix-seg"/g) || []).length, 2);
  assert.ok(barHtml.includes('#14B8A6'));
  assert.ok(barHtml.includes('#F472B6'));
});

test('legend lists every class; schedule summary shows crop names and remarks as escaped text', async () => {
  const { context, document } = await makeHarness();
  const root = { innerHTML: '' };
  document.root = root;
  vm.runInContext('updateLegend()', context);

  for (const cls of Classes.ALL) assert.ok(root.innerHTML.includes(cls.name.en), cls.key);
  assert.ok(root.innerHTML.includes('3 cells · 1 plots'));

  root.innerHTML = '';
  vm.runInContext('renderScheduleSummary()', context);
  assert.ok(root.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(root.innerHTML.includes('Unknown crop (field&lt;&amp;&quot; onmouseover=alert(1)&gt;)'));
  assert.ok(root.innerHTML.includes('Other: &lt;b&gt;weeds&lt;/b&gt;'));
  assert.ok(root.innerHTML.includes('· 01-01-12-31'));
  assert.ok(!root.innerHTML.includes(CUSTOM_NAME));
  assert.ok(!root.innerHTML.includes(UNKNOWN_ID));
  assert.ok(!root.innerHTML.includes(REMARK));
});

test('mixed cell draw uses the crop-name color for class 4 and grey for an unresolved crop name', async () => {
  const { context } = await makeHarness();
  const drawnColors = [];
  context.ctx = recordingCtx(drawnColors);
  vm.runInContext('drawMixedCell(ctx, 0, 0, 10, 10, cellVisibleColors(state.plots[0], 2), "diagonal")', context);
  assert.deepEqual(drawnColors, ['#AABBCC', '#9CA3AF']);
});

test('five overlapping seasons all appear in the mixed-cell drawing used for label PNGs', async () => {
  const { context } = await makeHarness();
  vm.runInContext(`state.plots[0].seasons.push(
    { id: 'd', classId: 2, cropId: null, remark: '', start: '01-01', end: '12-31', cells: [2] },
    { id: 'e', classId: 5, cropId: null, remark: '', start: '01-01', end: '12-31', cells: [2] },
    { id: 'f', classId: null, cropId: null, remark: 'x', start: '01-01', end: '12-31', cells: [2] },
  )`, context);
  const colors = Array.from(vm.runInContext('cellVisibleColors(state.plots[0], 2)', context));
  assert.deepEqual(colors, ['#AABBCC', '#9CA3AF', '#A855F7', '#166534', '#F472B6']);

  const drawnColors = [];
  context.ctx = recordingCtx(drawnColors);
  vm.runInContext('drawMixedCell(ctx, 0, 0, 10, 10, cellVisibleColors(state.plots[0], 2), "diagonal")', context);
  assert.deepEqual(drawnColors, colors);
});

test('composition bars with every class present allocate at most 100 percent', async () => {
  const { context } = await makeHarness();
  const classCount = Classes.ALL.length;
  context.composition = {
    totalVisibleCells: classCount,
    counts: Array(classCount).fill(1),
    percentages: Array(classCount).fill(1 / classCount),
  };

  const markup = vm.runInContext('compositionBarHtml(composition)', context);
  const widths = Array.from(markup.matchAll(/width:([\d.]+)%/g), match => Number(match[1]));
  assert.equal(widths.length, classCount, 'each class should have a segment');
  assert.ok(widths.every(width => width > 0));
  assert.ok(widths.reduce((sum, width) => sum + width, 0) <= 100.000001);
  assert.match(cssSource, /\.mix-seg\s*\{[^}]*min-width:\s*0(?:px)?\s*;/s);
});
