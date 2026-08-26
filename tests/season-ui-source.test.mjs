import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');
const calendarSource = await readFile(new URL('../calendar.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

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
