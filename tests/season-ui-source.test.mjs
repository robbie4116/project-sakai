import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const htmlSource = await readFile(new URL('../taniman.html', import.meta.url), 'utf8');

test('schedule UI exposes exact month-day fields and shortcuts', () => {
  assert.match(htmlSource, /id="season-start"/);
  assert.match(htmlSource, /id="season-end"/);
  assert.match(htmlSource, /data-season-shortcut="whole"/);
  assert.match(htmlSource, /data-season-shortcut="early"/);
  assert.match(htmlSource, /data-season-shortcut="mid"/);
  assert.match(htmlSource, /data-season-shortcut="late"/);
  assert.doesNotMatch(htmlSource, /id="sched-track"/);
});
