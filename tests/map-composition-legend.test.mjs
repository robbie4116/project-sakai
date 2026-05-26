import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

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

test('map style no longer fills mixed plots with the dominant crop color', () => {
  const style = extractFunctionBlock(appSource, 'plotStyle');

  assert.match(style, /plotCompositionForView\(idx\)/);
  assert.match(style, /composition\.isMixed/);
  assert.match(style, /--mixed-fill/);
  assert.doesNotMatch(style, /plotIsMixed\(idx\)/);
});

test('map renders proportional mixed crop bar overlays', () => {
  const draw = extractFunctionBlock(appSource, 'drawPlotsOnMap');
  const update = extractFunctionBlock(appSource, 'updateMapPlot');
  const barHtml = extractFunctionBlock(appSource, 'compositionBarHtml');

  assert.match(appSource, /plotCompositionBars/);
  assert.match(draw, /updateCompositionBar\(plot\)/);
  assert.match(update, /updateCompositionBar\(plot\)/);
  assert.match(barHtml, /composition\.percentages\[i\]\s*\*\s*100/);
  assert.match(barHtml, /mix-seg/);
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
