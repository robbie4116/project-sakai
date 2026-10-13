import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Fields = require('../field-ids.js');

const full = idx => ({ idx, validCols: 50, validRows: 50 });
const plots = [full(0), full(1), full(12)];
const cabbage = (plotIdx, cells) => ({
  id: `p${plotIdx}|2||03-01|06-30|`, classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30', cells,
});

test('connected same-season cells form one field; separate patches get separate ids', () => {
  const plotData = { 0: { seasons: [cabbage(0, [0, 1, 51, 200, 201])] } };
  const { fields, fieldIdFor } = Fields.computeFields(plotData, plots);
  assert.equal(fields.length, 2);
  assert.equal(fieldIdFor('p0|2||03-01|06-30|', 0), 'F0001');
  assert.equal(fieldIdFor('p0|2||03-01|06-30|', 51), 'F0001');
  assert.equal(fieldIdFor('p0|2||03-01|06-30|', 200), 'F0002');
  assert.equal(fields[0].cell_count, 3);
  assert.deepEqual(fields[0].plot_idxs, [0]);
});

test('diagonal contact does not join cells', () => {
  const plotData = { 0: { seasons: [cabbage(0, [0, 51])] } };
  assert.equal(Fields.computeFields(plotData, plots).fields.length, 2);
});

test('a field crossing a plot border keeps one id', () => {
  // plot 0 col 49 touches plot 1 col 0; plot 0 row 49 touches plot 12 row 0
  const plotData = {
    0: { seasons: [cabbage(0, [49, 49 * 50 + 49])] },
    1: { seasons: [cabbage(1, [0])] },
    12: { seasons: [cabbage(12, [49])] },
  };
  const { fields } = Fields.computeFields(plotData, plots);
  assert.equal(fields.length, 2);
  assert.deepEqual(fields[0].plot_idxs, [0, 1]);
  assert.deepEqual(fields[1].plot_idxs, [0, 12]);
});

test('different seasons on the same cells are different fields', () => {
  const potato = { ...cabbage(0, [0, 1]), id: 'p0|3||07-01|10-30|', classId: 3, start: '07-01', end: '10-30' };
  const plotData = { 0: { seasons: [cabbage(0, [0, 1]), potato] } };
  const { fields, fieldIdFor } = Fields.computeFields(plotData, plots);
  assert.equal(fields.length, 2);
  assert.notEqual(fieldIdFor('p0|2||03-01|06-30|', 0), fieldIdFor('p0|3||07-01|10-30|', 0));
});

test('out-of-bounds cells are ignored and ids are deterministic', () => {
  const partial = [{ idx: 0, validCols: 21, validRows: 50 }];
  const plotData = { 0: { seasons: [cabbage(0, [20, 21, 22])] } };
  const first = Fields.computeFields(plotData, partial);
  const second = Fields.computeFields(plotData, partial);
  assert.equal(first.fields.length, 1);
  assert.equal(first.fields[0].cell_count, 1);
  assert.equal(first.fieldIdFor('p0|2||03-01|06-30|', 21), '');
  assert.deepEqual(first.fields.map(f => f.field_id), second.fields.map(f => f.field_id));
});
