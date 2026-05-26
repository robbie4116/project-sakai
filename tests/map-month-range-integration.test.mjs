import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const calendarSource = await readFile(new URL('../calendar.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');

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

test('HTML loads month view utilities before app startup', () => {
  assert.ok(htmlSource.indexOf('month-view-utils.js') < htmlSource.indexOf('app.js'));
});

test('app initializes canonical viewMonths and legacy mirror from month utility', () => {
  assert.match(appSource, /state\.viewMonths\s*=\s*normalizeViewMonths\(state\.viewMonths,\s*state\.viewMonth\)/);
  assert.match(appSource, /state\.viewMonth\s*=\s*viewMonthFromMask\(state\.viewMonths\)/);
});

test('visible crop and dominant crop calculations use viewMonths mask overlap', () => {
  const cellVisible = extractFunctionBlock(appSource, 'cellVisibleCrops');
  const composition = extractFunctionBlock(appSource, 'plotCompositionForView');
  const dominant = extractFunctionBlock(appSource, 'dominantCropForView');

  assert.match(cellVisible, /state\.viewMonths/);
  assert.match(cellVisible, /maskIntersects\(v,\s*viewMonths\)/);
  assert.doesNotMatch(cellVisible, /state\.viewMonth(?!s)/);

  assert.match(appSource, /function plotCompositionForView\(idx,\s*viewMonths\s*=\s*state\.viewMonths\)/);
  assert.match(composition, /maskIntersects\(v,\s*viewMonths\)/);
  assert.doesNotMatch(composition, /state\.viewMonth(?!s)/);

  assert.match(dominant, /plotCompositionForView\(idx\)/);
  assert.doesNotMatch(dominant, /state\.viewMonth(?!s)/);
});

test('painting calls the map display auto-switch for non-erase paint', () => {
  const paintAt = extractFunctionBlock(appSource, 'paintAt');
  assert.match(paintAt, /ensurePaintVisibleOnMap\(\)/);
});

test('calendar exposes range-capable setViewMonths and no longer uses setViewMonth', () => {
  assert.match(calendarSource, /function setViewMonths\(mask,\s*\{\s*source\s*=\s*'manual'\s*\}\s*=\s*\{\}\)/);
  assert.match(calendarSource, /window\.setViewMonths\s*=\s*setViewMonths/);
  assert.doesNotMatch(calendarSource, /function setViewMonth\(/);
});

test('scrubber renders range state and hidden brush warning', () => {
  assert.match(htmlSource, /id="scrub-hidden-warning"/);
  assert.match(calendarSource, /updateHiddenBrushIndicator/);
  assert.match(calendarSource, /scrubber-month.*in-range/s);
  assert.match(calendarSource, /scrubber-month.*endpoint/s);
  assert.match(calendarSource, /monthsBetween\(scrubStart,\s*m\)/);
  assert.doesNotMatch(calendarSource, /scrubber-indicator/);
  assert.match(appSource, /tag\.classList\.toggle\('hidden-brush'/);
  assert.match(appSource, /Hidden · \$\{maskToDisplayLabel\(state\.paintMonths\)\} brush/);
});

test('setViewMonths persists viewMonths and legacy viewMonth mirror', () => {
  const setViewMonths = extractFunctionBlock(calendarSource, 'setViewMonths');
  const saveState = extractFunctionBlock(appSource, 'saveState');

  assert.match(setViewMonths, /state\.viewMonths\s*=\s*normalizeViewMonths\(mask,\s*state\.viewMonth\)/);
  assert.match(setViewMonths, /state\.viewMonth\s*=\s*viewMonthFromMask\(state\.viewMonths\)/);
  assert.match(setViewMonths, /window\.TANIMAN\.saveState\(\)/);
  assert.match(saveState, /JSON\.stringify\(out\)/);
});
