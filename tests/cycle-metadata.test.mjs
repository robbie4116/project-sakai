import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Cycle = require('../cycle-metadata.js');

test('cycle IDs round trip Unicode and separators with an opaque base', () => {
  const base = 'p7|other||03-01|06-30|管|:🌾';
  const meta = { referenceYear: 2026, fieldId: '北|:🌾"field' };
  const encoded = Cycle.encodeId(base, meta);
  assert.ok(encoded.endsWith(base));
  assert.match(encoded, /^cycle-v1\|\d+:/);
  assert.deepEqual(Cycle.decodeId(encoded), meta);
  assert.equal(Cycle.encodeId(base, meta), encoded);
});

test('legacy IDs never infer a year', () => {
  for (const id of ['p1|2||03-01|06-30|', 'p2026|2025|field']) {
    assert.equal(Cycle.encodeId(id, {}), id);
    assert.deepEqual(Cycle.decodeId(id), {});
  }
  assert.deepEqual(Cycle.decodeId(Cycle.encodeId('p0|2', { referenceYear: 1980 })), { referenceYear: 1980 });
});

test('a field ID is stored without any year', () => {
  const encoded = Cycle.encodeId('p0|2', { fieldId: 'F-001' });
  assert.match(encoded, /^cycle-v1\|\d+:\[null,"F-001"\]p0\|2$/);
  assert.deepEqual(Cycle.decodeId(encoded), { fieldId: 'F-001' });
  assert.equal(Cycle.encodeId('p0|2', { fieldId: '' }), 'p0|2');
  assert.equal(Cycle.encodeId('p0|2', { referenceYear: null }), 'p0|2');
  assert.deepEqual(Cycle.decodeId('cycle-v1|11:[null,null]p0'), {});
});

test('invalid explicit metadata is blocked and malformed encoded IDs are legacy unknowns', () => {
  for (const year of [1979, 2101, 2026.5, '2026', NaN]) {
    assert.throws(() => Cycle.encodeId('p0|2', { referenceYear: year }), /year/i);
  }
  assert.throws(() => Cycle.encodeId('p0|2', { referenceYear: 2026, fieldId: 42 }), /field/i);
  for (const id of [null, 'cycle-v1|x:[]p0', 'cycle-v1|999:[2026,null]p0',
    'cycle-v1|11:[1979,null]p0', 'cycle-v1|12:["2026",null]p0',
    'cycle-v1|9:[2026,42]p0', 'cycle-v1|2:{}p0', 'cycle-v1|11:[2026,null]',
    'cycle-v2|11:[2026,null]p0', 'cycle-v1|011:[2026,null]p0']) {
    assert.deepEqual(Cycle.decodeId(id), {});
  }
});

test('IDs respect the server bound conservatively in JavaScript characters', () => {
  const overhead = Cycle.encodeId('x', { referenceYear: 2100 }).length - 1;
  const exact = Cycle.encodeId('x'.repeat(400 - overhead), { referenceYear: 2100 });
  assert.equal(exact.length, 400);
  assert.throws(() => Cycle.encodeId('x'.repeat(401 - overhead), { referenceYear: 2100 }), /400/);
  assert.throws(() => Cycle.encodeId('x'.repeat(401), {}), /400/);
  assert.deepEqual(Cycle.decodeId(exact + 'x'), {});
});
