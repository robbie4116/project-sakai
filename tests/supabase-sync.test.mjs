import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../supabase-sync.js', import.meta.url), 'utf8');
// Objects created inside the vm have a different Object.prototype; compare as plain JSON.
const plain = value => JSON.parse(JSON.stringify(value));

function load(fake) {
  const window = {};
  const context = {
    window, console, atob, Blob,
    navigator: { onLine: true },
    supabase: { createClient: () => fake },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return window;
}

function fakeClient({ rpc = async () => ({ data: null, error: null, status: 200 }), pages = [] } = {}) {
  const calls = [];
  let page = 0;
  const builder = {
    select() { return builder; },
    order() { return builder; },
    eq(...args) { calls.push(['eq', ...args]); return Promise.resolve({ data: pages[0] || [], error: null, status: 200 }); },
    range(from, to) { calls.push(['range', from, to]); return Promise.resolve({ data: pages[page++] || [], error: null, status: 200 }); },
  };
  return {
    calls,
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return rpc(name, args); },
    from: table => { calls.push(['from', table]); return builder; },
  };
}

const delta = {
  id: 'p0|2||03-01|06-30|', plotIdx: 0, classId: 2, cropId: null, remark: '',
  start: '03-01', end: '06-30', add: [1, 2], remove: [3],
};

test('applySeasonCells maps the delta to RPC arguments and returns the row', async () => {
  const fake = fakeClient({ rpc: async () => ({ data: { id: delta.id, cells: [1, 2] }, error: null, status: 200 }) });
  const row = await load(fake).applySeasonCells(delta);
  assert.deepEqual(plain(fake.calls[0]), ['rpc', 'apply_season_cells', {
    p_id: delta.id, p_plot_idx: 0, p_class_id: 2, p_crop_id: null, p_remark: null,
    p_start: '03-01', p_end: '06-30', p_add: [1, 2], p_remove: [3],
  }]);
  assert.deepEqual(row, { id: delta.id, cells: [1, 2] });
});

test('a deleted season comes back as null', async () => {
  const fake = fakeClient({ rpc: async () => ({ data: { id: null, cells: null }, error: null, status: 200 }) });
  assert.equal(await load(fake).applySeasonCells(delta), null);
});

test('errors carry the Postgres code and HTTP status', async () => {
  const fake = fakeClient({ rpc: async () => ({ data: null, error: { message: 'fk', code: '23503' }, status: 409 }) });
  await assert.rejects(load(fake).applySeasonCells(delta), err => err.code === '23503' && err.status === 409);
});

test('offline calls throw a retryable error', async () => {
  const window = {};
  const context = { window, console, navigator: { onLine: false }, supabase: { createClient: () => fakeClient() } };
  vm.createContext(context);
  vm.runInContext(source, context);
  await assert.rejects(window.applySeasonCells(delta), err => err.status === 0);
});

test('crop deletion uses the delete_crop RPC', async () => {
  const fake = fakeClient({ rpc: async () => ({ data: 4, error: null, status: 200 }) });
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(await load(fake).deleteCustomCrop(id), 4);
  assert.deepEqual(plain(fake.calls[0]), ['rpc', 'delete_crop', { p_crop_id: id }]);
});

test('fetchAllSeasons pages through more than 1000 rows', async () => {
  const fullPage = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}` }));
  const fake = fakeClient({ pages: [fullPage, [{ id: 'last' }]] });
  const rows = await load(fake).fetchAllSeasons();
  assert.equal(rows.length, 1001);
  assert.deepEqual(fake.calls.filter(c => c[0] === 'range'), [['range', 0, 999], ['range', 1000, 1999]]);
});

test('clear_plot is called with the plot index', async () => {
  const fake = fakeClient();
  await load(fake).clearPlotRemote(14);
  assert.deepEqual(plain(fake.calls[0]), ['rpc', 'clear_plot', { p_plot_idx: 14 }]);
});
