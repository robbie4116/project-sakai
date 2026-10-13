import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Classes = require('../classes.js');

const LETTUCE = '11111111-1111-4111-8111-111111111111';

test('eight classes plus Other, in class_id order', () => {
  assert.deepEqual(Classes.ALL.map(c => c.id), [1, 2, 3, 4, 5, 6, 7, 8, null]);
  assert.deepEqual(Classes.ALL.map(c => c.key), [
    'carrot', 'cabbage', 'potato', 'other_cultivated',
    'forest', 'built_up', 'bare_fallow', 'grass_shrub', 'other',
  ]);
  for (const cls of Classes.ALL) {
    assert.deepEqual(Object.keys(cls.name).sort(), ['en', 'il', 'tl']);
    assert.match(cls.hex, /^#[0-9A-F]{6}$/);
  }
  assert.equal(Classes.byId(null).key, 'other');
  assert.equal(Classes.byId(2).key, 'cabbage');
  assert.equal(Classes.byKey('forest').id, 5);
  assert.equal(Classes.byKey('nope'), null);
});

test('reserved crop names are the three target classes in en/tl/il', () => {
  assert.deepEqual(Classes.RESERVED_CROP_NAMES, ['carrot', 'karot', 'cabbage', 'repolyo', 'potato', 'patatas']);
});

test('non-crop classes default to all year; crops do not', () => {
  assert.deepEqual(Classes.defaultDates('forest'), { start: '01-01', end: '12-31' });
  assert.deepEqual(Classes.defaultDates('grass_shrub'), { start: '01-01', end: '12-31' });
  assert.equal(Classes.defaultDates('cabbage'), null);
  assert.equal(Classes.defaultDates('other'), null);
});

test('selection status blocks painting until complete', () => {
  const resolved = id => id === LETTUCE;
  const s = (sel) => Classes.selectionStatus(sel, resolved);
  assert.deepEqual(s({ classKey: null }), { ready: false, missing: 'class' });
  assert.deepEqual(s({ classKey: 'cabbage', start: null, end: null }), { ready: false, missing: 'dates' });
  assert.deepEqual(s({ classKey: 'cabbage', start: '03-01', end: '06-30' }), { ready: true, missing: null });
  assert.deepEqual(s({ classKey: 'other_cultivated', cropId: null, start: '03-01', end: '06-30' }), { ready: false, missing: 'cropName' });
  assert.deepEqual(s({ classKey: 'other_cultivated', cropId: 'deleted', start: '03-01', end: '06-30' }), { ready: false, missing: 'cropName' });
  assert.deepEqual(s({ classKey: 'other_cultivated', cropId: LETTUCE, start: '03-01', end: '06-30' }), { ready: true, missing: null });
  assert.deepEqual(s({ classKey: 'other', remark: '   ', start: '03-01', end: '06-30' }), { ready: false, missing: 'remark' });
  assert.deepEqual(s({ classKey: 'other', remark: 'weeds', start: null, end: null }), { ready: false, missing: 'dates' });
  assert.deepEqual(s({ classKey: 'forest', start: '01-01', end: '12-31' }), { ready: true, missing: null });
});

test('paint meta keeps only the fields that belong to the class', () => {
  const ok = () => true;
  assert.deepEqual(
    Classes.paintMeta({ classKey: 'cabbage', cropId: LETTUCE, remark: 'x', start: '03-01', end: '06-30' }, ok),
    { classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30' });
  assert.deepEqual(
    Classes.paintMeta({ classKey: 'other', remark: '  Weeds   here ', start: '03-01', end: '06-30' }, ok),
    { classId: null, cropId: null, remark: 'Weeds here', start: '03-01', end: '06-30' });
  assert.equal(Classes.paintMeta({ classKey: 'cabbage', start: null, end: null }, ok), null);
});

test('season ids are deterministic and case-insensitive on remarks', () => {
  const a = Classes.seasonId(14, { classId: null, cropId: null, remark: 'Weeds', start: '03-01', end: '06-30' });
  const b = Classes.seasonId(14, { classId: null, cropId: null, remark: ' weeds ', start: '03-01', end: '06-30' });
  assert.equal(a, 'p14|other||03-01|06-30|weeds');
  assert.equal(a, b);
  assert.equal(
    Classes.seasonId(3, { classId: 4, cropId: LETTUCE, remark: '', start: '11-15', end: '02-10' }),
    `p3|4|${LETTUCE}|11-15|02-10|`);
  assert.equal(
    Classes.seasonKey({ classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30' }),
    '2||03-01|06-30|');
});

test('colors: class 4 uses its crop color, everything else the class color', () => {
  const catalog = { byId: id => (id === LETTUCE ? { id, hex: '#22C55E' } : null) };
  assert.equal(Classes.seasonColor({ classId: 2 }, catalog), '#A855F7');
  assert.equal(Classes.seasonColor({ classId: 4, cropId: LETTUCE }, catalog), '#22C55E');
  assert.equal(Classes.seasonColor({ classId: 4, cropId: 'missing' }, catalog), '#14B8A6');
  assert.equal(Classes.seasonColor({ classId: null }, catalog), '#F472B6');
  assert.equal(Classes.legendIndex(1), 0);
  assert.equal(Classes.legendIndex(8), 7);
  assert.equal(Classes.legendIndex(null), 8);
});

test('selection label and color describe the brush', () => {
  const catalog = { byId: id => (id === LETTUCE ? { id, hex: '#22C55E', name: { en: 'Lettuce' } } : null) };
  assert.equal(Classes.selectionLabel({ classKey: 'cabbage' }, catalog, 'en'), 'Cabbage');
  assert.equal(Classes.selectionLabel({ classKey: 'other_cultivated', cropId: LETTUCE }, catalog, 'en'), 'Lettuce');
  assert.equal(Classes.selectionLabel({ classKey: 'other', remark: 'weeds' }, catalog, 'en'), 'Other: weeds');
  assert.equal(Classes.selectionColor({ classKey: 'other_cultivated', cropId: LETTUCE }, catalog), '#22C55E');
});
