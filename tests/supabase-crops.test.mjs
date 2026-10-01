import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const syncSource = await readFile(new URL('../supabase-sync.js', import.meta.url), 'utf8');

function loadAdapter({ online = true, result = { data: null, error: null } } = {}) {
  const calls = [];
  const client = {
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) {
          calls.push(['select', columns]);
          return this;
        },
        order(column) {
          calls.push(['order', column]);
          return Promise.resolve(result);
        },
        insert(values) {
          calls.push(['insert', values]);
          return this;
        },
        single() {
          calls.push(['single']);
          return Promise.resolve(result);
        },
      };
    },
  };
  const context = {
    window: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'test-key' },
    navigator: { onLine: online },
    supabase: {
      createClient(url, key) {
        calls.push(['createClient', url, key]);
        return client;
      },
    },
  };

  vm.runInNewContext(syncSource, context);
  return { api: context.window, calls };
}

test('fetchCustomCrops selects catalog fields ordered by name', async () => {
  const crops = [
    { id: 'crop-1', name: 'Amaranth', hex: '#258C55', created_at: '2026-10-01T00:00:00Z' },
  ];
  const { api, calls } = loadAdapter({ result: { data: crops, error: null } });

  const result = await api.fetchCustomCrops();

  assert.strictEqual(result, crops);
  assert.deepEqual(calls.slice(-3), [
    ['from', 'crops'],
    ['select', 'id,name,hex,created_at'],
    ['order', 'name'],
  ]);
});

test('fetchCustomCrops returns an empty list when Supabase data is null', async () => {
  const { api } = loadAdapter({ result: { data: null, error: null } });

  assert.deepEqual(Array.from(await api.fetchCustomCrops()), []);
});

test('fetchCustomCrops propagates Supabase read errors with their error code', async () => {
  const readError = Object.assign(new Error('catalog read denied'), { code: '42501' });
  const { api } = loadAdapter({ result: { data: null, error: readError } });

  await assert.rejects(api.fetchCustomCrops(), error => {
    assert.strictEqual(error, readError);
    assert.equal(error.code, '42501');
    return true;
  });
});

test('insertCustomCrop inserts only name and hex and returns the selected row', async () => {
  const crop = { id: 'crop-2', name: 'Ube', hex: '#714B9E', created_at: '2026-10-01T00:00:00Z' };
  const { api, calls } = loadAdapter({ result: { data: crop, error: null } });

  const result = await api.insertCustomCrop('Ube', '#714B9E');

  assert.strictEqual(result, crop);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(-4))), [
    ['from', 'crops'],
    ['insert', { name: 'Ube', hex: '#714B9E' }],
    ['select', 'id,name,hex,created_at'],
    ['single'],
  ]);
});

test('insertCustomCrop propagates Supabase errors with their error code', async () => {
  const duplicateError = Object.assign(new Error('duplicate crop name'), { code: '23505' });
  const { api } = loadAdapter({ result: { data: null, error: duplicateError } });

  await assert.rejects(api.insertCustomCrop('Ube', '#714B9E'), error => {
    assert.strictEqual(error, duplicateError);
    assert.equal(error.code, '23505');
    return true;
  });
});

test('catalog reads and inserts reject offline without creating a Supabase client', async () => {
  const { api, calls } = loadAdapter({ online: false });

  await assert.rejects(api.fetchCustomCrops(), { message: 'offline' });
  await assert.rejects(api.insertCustomCrop('Ube', '#714B9E'), { message: 'offline' });
  assert.deepEqual(calls, []);
});
