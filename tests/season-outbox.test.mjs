import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Outbox = require('../season-outbox.js');

const meta = { id: 'p0|2||03-01|06-30|', plotIdx: 0, classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30' };

test('adds and removes coalesce per season; latest action wins', () => {
  const box = Outbox.create();
  box.record(meta, [1, 2, 3], []);
  box.record(meta, [], [2]);
  box.record(meta, [2], []);        // erase then repaint before flush -> painted
  box.record(meta, [], [9]);
  const [delta] = box.drain();
  assert.deepEqual(delta.add, [1, 2, 3]);
  assert.deepEqual(delta.remove, [9]);
  assert.equal(delta.id, meta.id);
  assert.equal(delta.classId, 2);
  assert.equal(box.size(), 0);
});

test('requeued deltas never override newer edits', () => {
  const box = Outbox.create();
  box.record(meta, [1, 2], []);
  const [sent] = box.drain();
  box.record(meta, [], [2]);        // user erased 2 while the request was in flight
  box.requeue(sent);                // request failed; put it back underneath
  const [delta] = box.drain();
  assert.deepEqual(delta.add, [1]);
  assert.deepEqual(delta.remove, [2]);
});

test('outbox survives JSON round trips and can drop by plot or crop', () => {
  const box = Outbox.create();
  box.record(meta, [1], []);
  box.record({ ...meta, id: 'p1|4|abc|01-01|02-01|', plotIdx: 1, classId: 4, cropId: 'abc' }, [5], []);
  const copy = Outbox.create(JSON.parse(JSON.stringify(box.toJSON())));
  assert.equal(copy.size(), 2);
  assert.equal(copy.has(meta.id), true);
  copy.dropCrop('abc');
  assert.equal(copy.size(), 1);
  copy.dropPlot(0);
  assert.equal(copy.size(), 0);
});

test('diffSeasons turns an undo snapshot into deltas', () => {
  const current = [
    { id: 'a', classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30', cells: [1, 2, 3] },
    { id: 'b', classId: 5, cropId: null, remark: '', start: '01-01', end: '12-31', cells: [7] },
  ];
  const target = [
    { id: 'a', classId: 2, cropId: null, remark: '', start: '03-01', end: '06-30', cells: [1, 4] },
    { id: 'c', classId: 1, cropId: null, remark: '', start: '05-01', end: '08-01', cells: [9] },
  ];
  const deltas = Outbox.diffSeasons(0, current, target);
  assert.deepEqual(deltas.map(d => [d.meta.id, d.add, d.remove]), [
    ['a', [4], [2, 3]],
    ['b', [], [7]],
    ['c', [9], []],
  ]);
  assert.equal(deltas[2].meta.classId, 1);
  assert.equal(deltas[2].meta.plotIdx, 0);
});

test('remote seasons replace local ones unless the local season is pending', () => {
  const local = [
    { id: 'a', cells: [1] },      // pending -> kept
    { id: 'b', cells: [2] },      // not pending, gone remotely -> dropped
    { id: 'c', cells: [3] },      // not pending, replaced by remote
  ];
  const remote = [{ id: 'a', cells: [99] }, { id: 'c', cells: [3, 4] }, { id: 'd', cells: [5] }];
  const merged = Outbox.mergeRemoteSeasons(local, remote, id => id === 'a');
  assert.deepEqual(merged, [{ id: 'a', cells: [1] }, { id: 'c', cells: [3, 4] }, { id: 'd', cells: [5] }]);
});

test('server rows become local seasons', () => {
  assert.deepEqual(Outbox.seasonFromRow({
    id: 'x', plot_idx: 3, class_id: null, crop_id: null, remark: 'weeds',
    start_mmdd: '03-01', end_mmdd: '06-30', cells: [5, 2],
  }), { id: 'x', classId: null, cropId: null, remark: 'weeds', start: '03-01', end: '06-30', cells: [2, 5] });
});

test('in-flight deltas stay pending and are persisted until acknowledged', () => {
  const box = Outbox.create();
  box.record(meta, [1, 2], []);
  const [sending] = box.begin();
  assert.equal(box.size(), 0);
  assert.equal(box.has(meta.id), true);           // still pending while in flight
  box.record(meta, [], [2]);                      // newer edit during the request
  const saved = Outbox.create(JSON.parse(JSON.stringify(box.toJSON())));
  const [delta] = saved.drain();
  assert.deepEqual(delta.add, [1]);               // in-flight add survives a reload
  assert.deepEqual(delta.remove, [2]);            // newer erase wins
  box.ack(sending.id);
  assert.equal(box.isSending(meta.id), false);
});

test('flush sends each delta and reports rows, retries and permanent errors', async () => {
  const other = { ...meta, id: 'p0|5||01-01|12-31|', classId: 5, start: '01-01', end: '12-31' };
  const third = { ...meta, id: 'p1|1||02-01|05-01|', plotIdx: 1, classId: 1, start: '02-01', end: '05-01' };
  const box = Outbox.create();
  box.record(meta, [1], []);
  box.record(other, [2], []);
  box.record(third, [3], []);
  const rows = [];
  const permanent = [];
  const result = await Outbox.flush(box, {
    send: async delta => {
      if (delta.id === other.id) throw Object.assign(new Error('offline'), { status: 0 });
      if (delta.id === third.id) throw Object.assign(new Error('fk'), { code: '23503' });
      return { id: delta.id, cells: delta.add };
    },
    onRow: (delta, row) => rows.push([delta.id, row.cells]),
    onPermanent: delta => permanent.push(delta.id),
  });
  assert.deepEqual(rows, [[meta.id, [1]]]);
  assert.deepEqual(permanent, [third.id]);
  assert.equal(result.retry, true);
  assert.equal(box.size(), 1);                    // only the network failure is requeued
  assert.equal(box.has(other.id), true);
  assert.equal(box.has(third.id), false);
});

test('rows for deltas dropped mid-flight are ignored', async () => {
  const box = Outbox.create();
  box.record(meta, [1], []);
  const rows = [];
  await Outbox.flush(box, {
    send: async delta => { box.dropPlot(0); return { id: delta.id, cells: [1] }; },
    onRow: (delta, row) => rows.push(row),
  });
  assert.deepEqual(rows, []);
  assert.equal(box.has(meta.id), false);
});

test('error classification: data errors are permanent, network errors retry', () => {
  assert.equal(Outbox.classifySyncError({ code: '23503' }), 'permanent');
  assert.equal(Outbox.classifySyncError({ code: '23514' }), 'permanent');
  assert.equal(Outbox.classifySyncError({ code: '22023' }), 'permanent');
  assert.equal(Outbox.classifySyncError({ status: 400 }), 'permanent');
  assert.equal(Outbox.classifySyncError({ status: 408 }), 'retry');
  assert.equal(Outbox.classifySyncError({ status: 429 }), 'retry');
  assert.equal(Outbox.classifySyncError({ status: 503 }), 'retry');
  assert.equal(Outbox.classifySyncError({ status: 0, message: 'offline' }), 'retry');
  assert.equal(Outbox.classifySyncError(new TypeError('Failed to fetch')), 'retry');
});
