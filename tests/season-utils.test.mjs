import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  parseMmdd,
  isValidMmdd,
  compareMmdd,
  rangeWrapsYear,
  seasonIncludesMmdd,
  shortcutRange,
  seasonsOverlap,
} = require('../season-utils.js');

test('validates recurring month-day values', () => {
  assert.deepEqual(parseMmdd('06-20'), { month: 6, day: 20, ordinal: 171 });
  assert.equal(isValidMmdd('02-29'), true);
  assert.equal(isValidMmdd('02-30'), false);
  assert.equal(isValidMmdd('00-10'), false);
  assert.equal(isValidMmdd('13-01'), false);
});

test('normal and same-day ranges are inclusive', () => {
  assert.equal(compareMmdd('06-20', '07-10') < 0, true);
  assert.equal(rangeWrapsYear('06-20', '07-10'), false);
  assert.equal(seasonIncludesMmdd('06-20', '07-10', '06-20'), true);
  assert.equal(seasonIncludesMmdd('06-20', '07-10', '07-10'), true);
  assert.equal(seasonIncludesMmdd('06-20', '06-20', '06-20'), true);
  assert.equal(seasonIncludesMmdd('06-20', '06-20', '06-21'), false);
});

test('month shortcuts produce exact month-day ranges', () => {
  assert.deepEqual(shortcutRange(2, 'whole'), { start: '02-01', end: '02-29' });
  assert.deepEqual(shortcutRange(6, 'early'), { start: '06-01', end: '06-10' });
  assert.deepEqual(shortcutRange(6, 'mid'), { start: '06-11', end: '06-20' });
  assert.deepEqual(shortcutRange(6, 'late'), { start: '06-21', end: '06-30' });
});

test('normal and wrapped date ranges can overlap without being rejected', () => {
  assert.equal(seasonsOverlap('06-20', '07-10', '07-01', '07-20'), true);
  assert.equal(seasonsOverlap('11-15', '05-05', '04-01', '04-30'), true);
  assert.equal(seasonsOverlap('11-15', '05-05', '06-01', '06-30'), false);
});
