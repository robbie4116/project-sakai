import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const dataSource = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const generatorSource = await readFile(new URL('../generate_tiles.py', import.meta.url), 'utf8');

function extractFunctionBlock(source, name) {
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
    if (depth === 0) return source.slice(openBrace + 1, i);
  }
  throw new Error(`${name} block was not closed`);
}

function loadOutsideGeometry() {
  const end = appSource.indexOf('const PLOTS = AMBASSADOR_PLOTS');
  assert.notEqual(end, -1, 'outside geometry should be defined before PLOTS');
  const sandbox = { window: {} };
  vm.runInNewContext(dataSource, sandbox);
  vm.runInNewContext(`${appSource.slice(0, end)}
globalThis.__geometry = { AMBASSADOR_GRID_BOUNDS, OUTSIDE_PLOTS };`, sandbox);
  return sandbox.__geometry;
}

function loadOutsidePlacementRuntime() {
  const end = appSource.indexOf('// ── PERSISTENCE');
  assert.notEqual(end, -1, 'outside placement helpers should be defined before persistence');
  const sandbox = {
    window: {
      TANIMAN_MONTH_VIEW: {
        ALL_MONTHS: 0xfff,
        monthsBetween: () => [],
        maskList: () => [],
        maskIntersects: () => false,
        maskContains: () => false,
        normalizeViewMonths: () => 0xfff,
        viewMonthFromMask: () => -1,
        maskToDisplayLabel: () => 'all year',
        shouldAutoSwitchViewMonths: () => false,
        isBrushHiddenOnMap: () => false,
      },
    },
    location: { search: '' },
    URLSearchParams,
    loadState: () => null,
    localStorage: {
      _store: new Map(),
      getItem(key) {
        return this._store.get(key) ?? null;
      },
      setItem(key, value) {
        this._store.set(key, String(value));
      },
    },
  };
  vm.runInNewContext(dataSource, sandbox);
  vm.runInNewContext(`${appSource.slice(0, end)}
globalThis.__placement = {
  createOutsidePlotAt,
  plotOverlapsRect,
  AMBASSADOR_GRID_BOUNDS,
  AMBASSADOR_PLOT_LAT,
  AMBASSADOR_PLOT_LNG,
  CORE_PLOT_COUNT,
  PLOTS,
  state,
};`, sandbox);
  return sandbox.__placement;
}

function nearlyEqual(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) <= epsilon;
}

function hasPositiveOverlap(plot, rect) {
  return plot.latS < rect.latN &&
    plot.latN > rect.latS &&
    plot.lngW < rect.lngE &&
    plot.lngE > rect.lngW;
}

test('app builds hidden Tublay outside candidate plots separately from Ambassador plots', () => {
  assert.match(appSource, /const\s+CORE_PLOT_COUNT\s*=\s*AMBASSADOR_PLOTS\.length/);
  assert.match(appSource, /function\s+buildOutsidePlots\s*\(/);
  assert.match(appSource, /area:\s*'outside_tublay'/);
  assert.match(appSource, /function\s+visiblePlots\s*\(/);
  assert.match(appSource, /state\.enabledOutsidePlots/);
});

test('outside candidate generation excludes any plot rectangle that overlaps Ambassador', () => {
  const buildBlock = extractFunctionBlock(appSource, 'buildOutsidePlots');
  const generatorBlock = generatorSource.slice(
    generatorSource.indexOf('def build_outside_plots'),
    generatorSource.indexOf('\n\ndef generate_plot_crops'),
  );

  assert.match(appSource, /function\s+plotOverlapsPolygon\s*\(/);
  assert.match(buildBlock, /plotOverlapsPolygon\(candidate,\s*POLY\)/);
  assert.doesNotMatch(buildBlock, /pointInPolygon\(centerLat,\s*centerLng,\s*POLY\)/);
  assert.match(generatorSource, /def plot_overlaps_polygon/);
  assert.match(generatorBlock, /plot_overlaps_polygon\(candidate,\s*AMBASSADOR_POLY\)/);
  assert.doesNotMatch(generatorBlock, /point_in_polygon\(center_lat,\s*center_lng,\s*AMBASSADOR_POLY\)/);
});

test('outside candidate generation excludes plots overlapping the full 8x8 Ambassador grid', () => {
  const buildBlock = extractFunctionBlock(appSource, 'buildOutsidePlots');
  const generatorBlock = generatorSource.slice(
    generatorSource.indexOf('def build_outside_plots'),
    generatorSource.indexOf('\n\ndef generate_plot_crops'),
  );

  assert.match(appSource, /const\s+AMBASSADOR_GRID_BOUNDS\s*=/);
  assert.match(appSource, /function\s+plotOverlapsRect\s*\(/);
  assert.match(buildBlock, /plotOverlapsRect\(candidate,\s*AMBASSADOR_GRID_BOUNDS\)/);
  assert.match(generatorSource, /AMBASSADOR_GRID_BOUNDS\s*=/);
  assert.match(generatorSource, /def plot_overlaps_rect/);
  assert.match(generatorBlock, /plot_overlaps_rect\(candidate,\s*AMBASSADOR_GRID_BOUNDS\)/);
});

test('outside candidates can sit directly beside the 8x8 grid without overlapping it', () => {
  const { AMBASSADOR_GRID_BOUNDS, OUTSIDE_PLOTS } = loadOutsideGeometry();

  assert.ok(
    OUTSIDE_PLOTS.some(plot =>
      nearlyEqual(plot.lngE, AMBASSADOR_GRID_BOUNDS.lngW) &&
      plot.latS < AMBASSADOR_GRID_BOUNDS.latN &&
      plot.latN > AMBASSADOR_GRID_BOUNDS.latS),
    'expected at least one outside candidate touching the west edge of the 8x8 grid',
  );
  assert.ok(
    OUTSIDE_PLOTS.some(plot =>
      nearlyEqual(plot.lngW, AMBASSADOR_GRID_BOUNDS.lngE) &&
      plot.latS < AMBASSADOR_GRID_BOUNDS.latN &&
      plot.latN > AMBASSADOR_GRID_BOUNDS.latS),
    'expected at least one outside candidate touching the east edge of the 8x8 grid',
  );
  assert.ok(
    OUTSIDE_PLOTS.every(plot => !hasPositiveOverlap(plot, AMBASSADOR_GRID_BOUNDS)),
    'outside candidates must not overlap the 8x8 grid with positive area',
  );
});

test('outside farm map mode creates a custom plot centered on the clicked location', () => {
  assert.match(htmlSource, /id="add-outside-btn"/);
  assert.match(cssSource, /\.map-tool-btn/);

  const enableBlock = extractFunctionBlock(appSource, 'enableOutsidePlot');
  const clickBlock = extractFunctionBlock(appSource, 'handleOutsideMapClick');
  const createBlock = extractFunctionBlock(appSource, 'createOutsidePlotAt');
  const registerBlock = extractFunctionBlock(appSource, 'registerCustomOutsidePlot');

  assert.match(enableBlock, /state\.enabledOutsidePlots\.push\(idx\)/);
  assert.match(enableBlock, /drawPlotsOnMap\(\)/);
  assert.match(enableBlock, /openPlot\(idx\)/);
  assert.match(clickBlock, /createOutsidePlotAt\(e\.latlng\)/);
  assert.match(clickBlock, /registerCustomOutsidePlot\(plot\)/);
  assert.match(clickBlock, /enableOutsidePlot\(plot\.idx\)/);
  assert.doesNotMatch(clickBlock, /outsideCandidateAt\(e\.latlng\)/);
  assert.doesNotMatch(createBlock, /OUTSIDE_PLOTS\.find/);
  assert.doesNotMatch(createBlock, /pointInPolygon|plotOverlapsPolygon|POLY/);
  assert.match(registerBlock, /state\.customOutsidePlots\.push/);
});

test('outside farm placement snaps beside the 8x8 grid without positive overlap', () => {
  const {
    createOutsidePlotAt,
    plotOverlapsRect,
    AMBASSADOR_GRID_BOUNDS,
    AMBASSADOR_PLOT_LAT,
    AMBASSADOR_PLOT_LNG,
  } = loadOutsidePlacementRuntime();

  const plot = createOutsidePlotAt({
    lat: (AMBASSADOR_GRID_BOUNDS.latS + AMBASSADOR_GRID_BOUNDS.latN) / 2,
    lng: AMBASSADOR_GRID_BOUNDS.lngE - AMBASSADOR_PLOT_LNG * 0.2,
  });

  assert.ok(plot, 'expected a nearby legal outside plot instead of rejecting the click');
  assert.ok(nearlyEqual(plot.lngW, AMBASSADOR_GRID_BOUNDS.lngE));
  assert.ok(!plotOverlapsRect(plot, AMBASSADOR_GRID_BOUNDS));
  assert.ok(nearlyEqual(plot.latN - plot.latS, AMBASSADOR_PLOT_LAT));
  assert.ok(nearlyEqual(plot.lngE - plot.lngW, AMBASSADOR_PLOT_LNG));
});

test('outside farm placement snaps beside an existing outside plot without positive overlap', () => {
  const {
    createOutsidePlotAt,
    plotOverlapsRect,
    AMBASSADOR_GRID_BOUNDS,
    AMBASSADOR_PLOT_LNG,
    CORE_PLOT_COUNT,
    PLOTS,
    state,
  } = loadOutsidePlacementRuntime();
  const existing = PLOTS.find(plot =>
    plot &&
    plot.idx >= CORE_PLOT_COUNT &&
    plot.lngW > AMBASSADOR_GRID_BOUNDS.lngE + AMBASSADOR_PLOT_LNG);
  assert.ok(existing, 'expected a visible outside plot with room beside it');
  state.enabledOutsidePlots.push(existing.idx);

  const plot = createOutsidePlotAt({
    lat: existing.centerLat,
    lng: existing.lngE - AMBASSADOR_PLOT_LNG * 0.1,
  });

  assert.ok(plot, 'expected placement to resolve overlap with the existing outside plot');
  assert.ok(nearlyEqual(plot.lngW, existing.lngE));
  assert.ok(!plotOverlapsRect(plot, existing));
});

test('outside farm placement does not show the obsolete outside-Ambassador rejection toast', () => {
  const clickBlock = extractFunctionBlock(appSource, 'handleOutsideMapClick');
  const applyLangBlock = extractFunctionBlock(appSource, 'applyLang');

  assert.doesNotMatch(clickBlock, /toast\(tr\('outsidePickHint'\)\)/);
  assert.doesNotMatch(applyLangBlock, /outsidePickHint/);
});

test('outside plot labels use the local add order instead of raw candidate sequence numbers', () => {
  const labelBlock = extractFunctionBlock(appSource, 'plotDisplayLabel');
  const visibleBlock = extractFunctionBlock(appSource, 'visiblePlots');

  assert.match(appSource, /function\s+outsideDisplayNumber\s*\(/);
  assert.match(labelBlock, /outsideDisplayNumber\(plot\.idx\)/);
  assert.doesNotMatch(labelBlock, /outsideSeq\s*\+\s*1/);
  assert.match(visibleBlock, /state\.enabledOutsidePlots\.map/);
  assert.doesNotMatch(visibleBlock, /\.sort\(/);
});

test('outside plots can be removed after accidental selection', () => {
  assert.match(htmlSource, /id="btn-remove-outside"/);
  assert.match(appSource, /function\s+removeOutsidePlot\s*\(/);
  assert.match(appSource, /state\.enabledOutsidePlots\s*=\s*state\.enabledOutsidePlots\.filter/);
  assert.match(appSource, /delete\s+state\.plots\[idx\]/);

  const headerBlock = extractFunctionBlock(appSource, 'updatePlotHeader');
  assert.match(headerBlock, /btn-remove-outside/);
  assert.match(headerBlock, /isOutsidePlot\(plot\)/);
});

test('map coverage and roster only aggregate visible plots, not every outside candidate', () => {
  const drawBlock = extractFunctionBlock(appSource, 'drawPlotsOnMap');
  const legendBlock = extractFunctionBlock(appSource, 'updateLegend');
  const rosterBlock = extractFunctionBlock(appSource, 'buildRosterData');

  assert.match(drawBlock, /visiblePlots\(\)\.forEach/);
  assert.match(legendBlock, /visiblePlots\(\)\.forEach/);
  assert.match(rosterBlock, /visiblePlots\(\)\.forEach/);
});

test('exports include plot area and tile source metadata for outside training records', () => {
  assert.match(appSource, /plot_area,plot_source/);
  assert.match(appSource, /area:\s*plot\.area\s*\|\|\s*'ambassador'/);
  assert.match(appSource, /source:\s*plot\.source\s*\|\|\s*'field_grid'/);
  assert.match(generatorSource, /OUTSIDE_PLOT_PREFIX\s*=\s*"outside_"/);
  assert.match(generatorSource, /build_outside_plots/);
});

test('canvas readouts are outside the image frame instead of overlaying the paintable canvas', () => {
  const frameStart = htmlSource.indexOf('<div class="canvas-frame" id="canvas-frame">');
  const frameEnd = htmlSource.indexOf('</div>', frameStart);
  const frameHtml = htmlSource.slice(frameStart, frameEnd);

  assert.doesNotMatch(frameHtml, /canvas-corner/);
  assert.doesNotMatch(frameHtml, /canvas-view-tag/);
  assert.match(htmlSource, /<div class="canvas-status"/);
  assert.match(cssSource, /\.canvas-status/);
  assert.doesNotMatch(cssSource, /\.canvas-corner\{\s*position:absolute/);
  assert.doesNotMatch(cssSource, /\.canvas-view-tag\{\s*position:absolute/);
});
