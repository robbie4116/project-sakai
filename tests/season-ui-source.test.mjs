import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');
const calendarSource = await readFile(new URL('../calendar.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('schedule UI exposes planted and harvest month-day selectors', () => {
  assert.match(htmlSource, /id="season-planted-month"/);
  assert.match(htmlSource, /id="season-planted-day"/);
  assert.match(htmlSource, /id="season-harvest-month"/);
  assert.match(htmlSource, /id="season-harvest-day"/);
  assert.match(htmlSource, /id="season-preset-month"/);
  assert.match(htmlSource, /data-season-shortcut="whole"/);
  assert.match(htmlSource, /data-season-shortcut="early"/);
  assert.match(htmlSource, /data-season-shortcut="mid"/);
  assert.match(htmlSource, /data-season-shortcut="late"/);
  assert.doesNotMatch(htmlSource, /id="season-start"/);
  assert.doesNotMatch(htmlSource, /id="season-end"/);
  assert.doesNotMatch(htmlSource, /id="sched-track"/);
});

test('date selectors defer distinct accessible names to runtime aria labels', () => {
  for (const id of [
    'season-planted-month',
    'season-planted-day',
    'season-harvest-month',
    'season-harvest-day',
  ]) {
    assert.doesNotMatch(htmlSource, new RegExp(`<select[^>]*id="${id}"[^>]*aria-labelledby=`));
  }
});

test('calendar wires planting-harvest selectors through one range update path', () => {
  assert.match(calendarSource, /function setPaintSeasonRange/);
  assert.match(calendarSource, /function syncSeasonSelectors/);
  assert.match(calendarSource, /function updateDayOptions/);
  assert.match(calendarSource, /function updateShortcutLabels/);
  assert.match(calendarSource, /function updateSelectedShortcut/);
  assert.match(calendarSource, /season-planted-month/);
  assert.match(calendarSource, /season-planted-day/);
  assert.match(calendarSource, /season-harvest-month/);
  assert.match(calendarSource, /season-harvest-day/);
  assert.match(calendarSource, /season-preset-month/);
  assert.match(calendarSource, /shortcutRange/);
  assert.match(calendarSource, /state\.paintStartDate/);
  assert.match(calendarSource, /state\.paintEndDate/);
  assert.doesNotMatch(calendarSource, /season-start/);
  assert.doesNotMatch(calendarSource, /season-end/);
  assert.doesNotMatch(calendarSource, /['"`#.]season-month\b/);
});

test('app language binding does not target removed quarter filter ids', () => {
  assert.doesNotMatch(appSource, /getElementById\('q-(all|rainy|cool|hot)'\)/);
});

test('app exposes startup active paint date recovery to calendar', () => {
  assert.match(appSource, /invalidActivePaintRangeAtStartup/);
  assert.match(appSource, /!isValidMmdd\(state\.paintStartDate\)\s*\|\|\s*!isValidMmdd\(state\.paintEndDate\)/);
});

test('schedule editor stylesheet targets the date selector markup', () => {
  assert.match(styleSource, /\.season-editor\b/);
  assert.match(styleSource, /\.season-date-group\b/);
  assert.match(styleSource, /\.season-preset-group\b/);
  assert.match(styleSource, /\.sched-readout\s+\.rng-helper\b/);
  assert.match(styleSource, /\.sched-quick button\.on\b/);
});

test('schedule editor switches to touch layout before 720px can overflow', () => {
  assert.match(styleSource, /@media\s*\(max-width:\s*780px\)\s*\{[\s\S]*\.schedule-bar\{[^}]*flex-direction:column/);
  assert.match(styleSource, /@media\s*\(max-width:\s*780px\)\s*\{[\s\S]*\.season-editor\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('schedule editor touch controls meet minimum mobile target height', () => {
  assert.match(styleSource, /@media\s*\(max-width:\s*780px\)\s*\{[\s\S]*\.season-editor select\{[^}]*height:44px/);
  assert.match(styleSource, /@media\s*\(max-width:\s*780px\)\s*\{[\s\S]*\.sched-quick button\{[^}]*height:44px/);
});

test('obsolete schedule track styles are removed from production CSS', () => {
  assert.doesNotMatch(styleSource, /\.sched-track\b/);
  assert.doesNotMatch(styleSource, /\.sched-track-fill\b/);
  assert.doesNotMatch(styleSource, /\.sched-month\b/);
  assert.doesNotMatch(styleSource, /\.sched-handle\b/);
});
