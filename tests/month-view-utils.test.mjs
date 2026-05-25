import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const monthView = require('../month-view-utils.js');

const {
  ALL_MONTHS,
  monthsBetween,
  maskContains,
  maskIntersects,
  normalizeViewMonths,
  viewMonthFromMask,
  viewMonthsFromLegacy,
  maskToDisplayLabel,
  shouldAutoSwitchViewMonths,
  isBrushHiddenOnMap,
} = monthView;

test('month ranges support single, normal, and wrapped selections', () => {
  assert.equal(monthsBetween(0, 0), 1 << 0);
  assert.equal(monthsBetween(0, 1), (1 << 0) | (1 << 1));
  assert.equal(monthsBetween(11, 1), (1 << 11) | (1 << 0) | (1 << 1));
});

test('mask containment and intersection describe map visibility', () => {
  const janFeb = monthsBetween(0, 1);
  const febMar = monthsBetween(1, 2);
  const marApr = monthsBetween(2, 3);

  assert.equal(maskContains(janFeb, 1 << 0), true);
  assert.equal(maskContains(1 << 0, janFeb), false);
  assert.equal(maskIntersects(janFeb, febMar), true);
  assert.equal(maskIntersects(janFeb, marApr), false);
});

test('legacy single-month view state migrates into viewMonths', () => {
  assert.equal(viewMonthsFromLegacy(-1), ALL_MONTHS);
  assert.equal(viewMonthsFromLegacy(0), 1 << 0);
  assert.equal(viewMonthsFromLegacy(11), 1 << 11);
  assert.equal(viewMonthsFromLegacy(12), ALL_MONTHS);
});

test('new viewMonths is authoritative when both old and new fields exist', () => {
  assert.equal(normalizeViewMonths(monthsBetween(0, 1), 11), monthsBetween(0, 1));
});

test('invalid saved viewMonths values normalize safely', () => {
  assert.equal(normalizeViewMonths(undefined, -1), ALL_MONTHS);
  assert.equal(normalizeViewMonths('jan', 0), ALL_MONTHS);
  assert.equal(normalizeViewMonths(0, 0), ALL_MONTHS);
  assert.equal(normalizeViewMonths(4096, 0), ALL_MONTHS);
  assert.equal(normalizeViewMonths(0x1FFF, 0), ALL_MONTHS);
});

test('legacy mirror returns all, single month, or range sentinel', () => {
  assert.equal(viewMonthFromMask(ALL_MONTHS), -1);
  assert.equal(viewMonthFromMask(1 << 0), 0);
  assert.equal(viewMonthFromMask(monthsBetween(0, 1)), -2);
});

test('display labels distinguish all year, one month, ranges, wrapped ranges, and non-contiguous masks', () => {
  assert.equal(maskToDisplayLabel(ALL_MONTHS), 'All year');
  assert.equal(maskToDisplayLabel(1 << 0, { singleLong: true }), 'January');
  assert.equal(maskToDisplayLabel(monthsBetween(0, 1)), 'Jan-Feb');
  assert.equal(maskToDisplayLabel(monthsBetween(11, 1)), 'Dec-Feb');
  assert.equal(maskToDisplayLabel((1 << 0) | (1 << 2)), 'Jan, Mar');
});

test('painting auto-switches when map display does not fully cover brush months', () => {
  const janFeb = monthsBetween(0, 1);
  assert.equal(shouldAutoSwitchViewMonths(ALL_MONTHS, janFeb), false);
  assert.equal(shouldAutoSwitchViewMonths(janFeb, janFeb), false);
  assert.equal(shouldAutoSwitchViewMonths(1 << 0, janFeb), true);
  assert.equal(shouldAutoSwitchViewMonths(1 << 11, janFeb), true);
});

test('hidden brush indicator appears when map display does not fully cover brush months', () => {
  const janFeb = monthsBetween(0, 1);
  assert.equal(isBrushHiddenOnMap(ALL_MONTHS, janFeb), false);
  assert.equal(isBrushHiddenOnMap(janFeb, janFeb), false);
  assert.equal(isBrushHiddenOnMap(1 << 0, janFeb), true);
});
