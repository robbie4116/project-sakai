import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const prepareDistSource = await readFile(new URL('../src-tauri/scripts/prepare-dist.mjs', import.meta.url), 'utf8');

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

test('plot composition helper exposes visible cell coverage, empty cells, and mixed state', () => {
  const composition = extractFunctionBlock(appSource, 'plotCompositionForView');

  assert.match(composition, /counts\s*=\s*new Array\(CROPS\.length\)\.fill\(0\)/);
  assert.match(composition, /emptyCells/);
  assert.match(composition, /totalVisibleCells/);
  assert.match(composition, /nonZeroCropCount/);
  assert.match(composition, /isMixed/);
  assert.match(composition, /percentages/);
  assert.match(composition, /maskIntersects\(v,\s*viewMonths\)/);
});

test('dominant crop remains a compatibility wrapper over composition metadata', () => {
  const dominant = extractFunctionBlock(appSource, 'dominantCropForView');

  assert.match(dominant, /plotCompositionForView\(idx\)/);
  assert.doesNotMatch(dominant, /new Array\(CROPS\.length\)\.fill\(0\)/);
});

test('map style no longer fills painted plots with the dominant crop color', () => {
  const style = extractFunctionBlock(appSource, 'plotStyle');

  assert.match(style, /plotCompositionForView\(idx\)/);
  assert.match(style, /--mixed-fill/);
  assert.doesNotMatch(style, /composition\.isMixed/);
  assert.doesNotMatch(style, /fillColor:\s*crop\.hex/);
  assert.doesNotMatch(style, /plotIsMixed\(idx\)/);
});

test('map renders proportional crop bar overlays for any painted plot', () => {
  const draw = extractFunctionBlock(appSource, 'drawPlotsOnMap');
  const update = extractFunctionBlock(appSource, 'updateMapPlot');
  const barHtml = extractFunctionBlock(appSource, 'compositionBarHtml');
  const compositionBar = extractFunctionBlock(appSource, 'updateCompositionBar');

  assert.match(appSource, /plotCompositionBars/);
  assert.match(draw, /updateCompositionBar\(plot\)/);
  assert.match(update, /updateCompositionBar\(plot\)/);
  assert.match(compositionBar, /composition\.totalVisibleCells\s*<=\s*0/);
  assert.doesNotMatch(compositionBar, /composition\.isMixed/);
  assert.doesNotMatch(barHtml, /composition\.isMixed/);
  assert.match(barHtml, /composition\.percentages\[i\]\s*\*\s*100/);
  assert.match(barHtml, /mix-seg/);
});

test('crop bar segments render in crop palette order', () => {
  const barHtml = extractFunctionBlock(appSource, 'compositionBarHtml');

  assert.match(barHtml, /composition\.counts\.map\(\(count,\s*i\)/);
  assert.match(barHtml, /background:\$\{CROPS\[i\]\.hex\}/);
});

test('legend aggregates visible cell coverage rather than dominant plot counts', () => {
  const legend = extractFunctionBlock(appSource, 'updateLegend');

  assert.match(legend, /plotCompositionForView\(plot\.idx\)/);
  assert.match(legend, /visibleCellsByCrop/);
  assert.match(legend, /totalVisibleCells/);
  assert.match(legend, /coveragePct/);
  assert.doesNotMatch(legend, /tally\[cropIdx\]\+\+/);
  assert.doesNotMatch(legend, /dominantCropForView\(plot\.idx\)/);
});

test('coverage legend starts as a compact pull-down tab', () => {
  assert.match(htmlSource, /class="map-legend collapsed"/);
  assert.match(htmlSource, /aria-label="Show visible crop coverage"/);
  assert.match(htmlSource, /<span id="lgd-head-txt"[^>]*>Coverage<\/span>/);
  assert.match(cssSource, /\.map-legend\.collapsed\{/);
  assert.match(cssSource, /border-radius:0 0 9px 9px/);
  assert.match(cssSource, /border-top:0/);
});

test('expanded coverage legend stays attached to the pull-down tab anchor', () => {
  const legendCss = cssSource.slice(
    cssSource.indexOf('.map-legend{'),
    cssSource.indexOf('.map-legend .lgd-head{'),
  );
  const setLegendCollapsed = extractFunctionBlock(appSource, 'setLegendCollapsed');

  assert.match(legendCss, /position:absolute;left:16px;top:55px;bottom:auto/);
  assert.match(legendCss, /border-top:0/);
  assert.match(legendCss, /border-radius:0 0 9px 9px/);
  assert.match(setLegendCollapsed, /headText\.textContent\s*=\s*headText\.dataset\.collapsedLabel/);
  assert.doesNotMatch(setLegendCollapsed, /headText\.textContent\s*=\s*collapsed\s*\?/);
});

test('offline desktop staging includes the shared legend source files', () => {
  assert.match(prepareDistSource, /cpSync\(tanimanSrc, join\(DIST, 'index\.html'\)\)/);
  assert.match(prepareDistSource, /'app\.js', 'data\.js', 'styles\.css', 'config\.js'/);
});
