import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const catalogSource = await readFile(new URL('../crop-catalog.js', import.meta.url), 'utf8').catch(() => '');
const CACHE_KEY = 'taniman_custom_crops_v1';
const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174001';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeContext({ cache, tauri = false, fetch, insert } = {}) {
  const store = new Map();
  if (cache !== undefined) store.set(CACHE_KEY, cache);
  const storageCalls = [];
  const apiCalls = { fetch: 0, insert: [] };
  const crops = [
    { id: 'lettuce', hex: '#22C55E', name: { en: 'Lettuce', tl: 'Letsugas', il: 'Letsugas' } },
    { id: 'potato', hex: '#FFC629', name: { en: 'Potato', tl: 'Patatas', il: 'Patatas' } },
    { id: 'carrot', hex: '#FF6A1F', name: { en: 'Carrot', tl: 'Karot', il: 'Karot' } },
  ];
  const window = { CROPS: crops };
  if (tauri) window.__TAURI__ = {};
  const localStorage = {
    getItem(key) { storageCalls.push(['get', key]); return store.get(key) ?? null; },
    setItem(key, value) { storageCalls.push(['set', key, value]); store.set(key, String(value)); },
  };
  window.localStorage = localStorage;
  window.fetchCustomCrops = async () => { apiCalls.fetch++; return fetch ? fetch() : []; };
  window.insertCustomCrop = async (name, hex) => {
    apiCalls.insert.push([name, hex]);
    if (insert) return insert(name, hex);
    return { id: UUID_B, name, hex };
  };
  const context = { window, localStorage };
  vm.runInNewContext(catalogSource, context, { filename: 'crop-catalog.js' });
  return { catalog: window.TANIMAN_CROP_CATALOG, crops, store, storageCalls, apiCalls };
}

function cache(rows) {
  return JSON.stringify({ version: 1, rows });
}

test('synchronously hydrates the original CROPS array from targets and versioned cache', () => {
  const rawRows = [{ id: UUID_A, name: 'Amaranth', hex: '#258C55' }];
  const { catalog, crops } = makeContext({ cache: cache(rawRows) });

  assert.strictEqual(catalog.all().length, 4);
  assert.deepEqual(Array.from(catalog.all(), crop => crop.id), ['lettuce', 'potato', 'carrot', `crop_${UUID_A}`]);
  assert.strictEqual(catalog.all(), crops);
  assert.strictEqual(catalog.byId(`crop_${UUID_A}`).name.en, 'Amaranth');
  assert.deepEqual(JSON.parse(JSON.stringify(catalog.byId(`crop_${UUID_A}`).name)), { en: 'Amaranth' });
  assert.strictEqual(catalog.byId(`crop_${UUID_A}`).isResolved, true);
  assert.strictEqual(catalog.isTarget('lettuce'), true);
  assert.strictEqual(catalog.isResolved('lettuce'), true);
});

test('ignores malformed cache JSON, unsupported cache versions, and invalid rows', () => {
  for (const badCache of [
    '{not json',
    JSON.stringify({ version: 2, rows: [{ id: UUID_A, name: 'Amaranth', hex: '#258C55' }] }),
    cache([
      { id: 'not-a-uuid', name: 'Wrong ID', hex: '#258C55' },
      { id: UUID_A, name: '  ', hex: '#258C55' },
      { id: UUID_B, name: 'Wrong color', hex: 'green' },
      null,
    ]),
  ]) {
    const { catalog } = makeContext({ cache: badCache });
    assert.deepEqual(Array.from(catalog.all(), crop => crop.id), ['lettuce', 'potato', 'carrot']);
  }
});

test('normalizes names across tabs and newlines, validates hex, and saves a custom UUID mapping', async () => {
  let inserted;
  const { catalog, crops, apiCalls } = makeContext({ insert: async (name, hex) => {
    inserted = { id: UUID_A, name, hex };
    return inserted;
  } });

  assert.strictEqual(catalog.normalizeName('  Sweet\t\n potato  '), 'Sweet potato');
  await assert.rejects(catalog.create('Corn', 'yellow'), /hex/i);
  assert.deepEqual(apiCalls.insert, []);

  const result = await catalog.create('  Sweet\t\n potato  ', '#a1B2c3');
  assert.strictEqual(result.status, 'created');
  assert.deepEqual(apiCalls.insert[0], ['Sweet potato', '#a1B2c3']);
  assert.strictEqual(catalog.all(), crops);
  assert.strictEqual(result.crop.id, `crop_${UUID_A}`);
  assert.deepEqual(JSON.parse(JSON.stringify(result.crop.name)), { en: 'Sweet potato' });
  assert.strictEqual(result.crop.hex, '#a1B2c3');
});

test('rejects target names in English, Tagalog, and Ilocano before insertion', async () => {
  const { catalog, apiCalls } = makeContext();
  for (const name of ['Lettuce', 'Letsugas', 'Potato', 'Patatas', 'Carrot', 'Karot']) {
    await assert.rejects(catalog.create(`\t${name}\n`, '#AABBCC'), /target/i);
  }
  assert.deepEqual(apiCalls.insert, []);
});

test('ordinary refresh calls share one in-flight request and replace custom rows in target-first order', async () => {
  const request = deferred();
  const { catalog, apiCalls } = makeContext({ fetch: () => request.promise });
  let notifications = 0;
  catalog.subscribe(() => notifications++);

  const first = catalog.refresh();
  const second = catalog.refresh();
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.strictEqual(apiCalls.fetch, 1);
  request.resolve([
    { id: UUID_B, name: 'Zucchini', hex: '#12AB34' },
    { id: UUID_A, name: 'Amaranth', hex: '#258C55' },
  ]);
  await Promise.all([first, second]);

  assert.deepEqual(Array.from(catalog.all(), crop => crop.id), [
    'lettuce', 'potato', 'carrot', `crop_${UUID_A}`, `crop_${UUID_B}`,
  ]);
  assert.strictEqual(notifications, 1);
});

test('a refresh started before a successful insert cannot remove the inserted row', async () => {
  const request = deferred();
  const { catalog } = makeContext({ fetch: () => request.promise, insert: async (name, hex) => ({ id: UUID_A, name, hex }) });
  const staleRefresh = catalog.refresh();
  const created = await catalog.create('Amaranth', '#258C55');
  request.resolve([]);
  await staleRefresh;

  assert.strictEqual(created.status, 'created');
  assert.strictEqual(catalog.byId(`crop_${UUID_A}`).name.en, 'Amaranth');
});

test('23505 waits for older refresh then fetches the authoritative duplicate', async () => {
  const oldRequest = deferred();
  let fetchCount = 0;
  const { catalog, apiCalls } = makeContext({
    fetch: () => ++fetchCount === 1 ? oldRequest.promise : [{ id: UUID_A, name: 'Rice', hex: '#E0C060' }],
    insert: async () => { throw Object.assign(new Error('duplicate'), { code: '23505' }); },
  });
  const olderRefresh = catalog.refresh();
  const duplicatePromise = catalog.create('Rice', '#BBBBBB');
  await Promise.resolve();
  assert.strictEqual(apiCalls.fetch, 1);

  oldRequest.resolve([]);
  await olderRefresh;
  const result = await duplicatePromise;

  assert.strictEqual(apiCalls.fetch, 2);
  assert.strictEqual(result.status, 'duplicate');
  assert.strictEqual(result.crop.id, `crop_${UUID_A}`);
  assert.strictEqual(catalog.byId(`crop_${UUID_A}`).name.en, 'Rice');
});

test('concurrent 23505 creates share one authoritative recovery refresh', async () => {
  const firstFetchStarted = deferred();
  const requests = [];
  const cropRow = { id: UUID_A, name: 'Rice', hex: '#E0C060' };
  const { catalog, apiCalls } = makeContext({
    fetch: () => {
      const request = deferred();
      requests.push(request);
      if (requests.length === 1) firstFetchStarted.resolve();
      return request.promise;
    },
    insert: async () => { throw Object.assign(new Error('duplicate'), { code: '23505' }); },
  });

  let statusA = 'pending';
  let statusB = 'pending';
  const createA = catalog.create('Rice', '#BBBBBB').then(
    value => { statusA = 'fulfilled'; return { status: 'fulfilled', value }; },
    error => { statusA = 'rejected'; return { status: 'rejected', error }; },
  );
  const createB = catalog.create('Rice', '#CCCCCC').then(
    value => { statusB = 'fulfilled'; return { status: 'fulfilled', value }; },
    error => { statusB = 'rejected'; return { status: 'rejected', error }; },
  );

  await firstFetchStarted.promise;
  await new Promise(resolve => setImmediate(resolve));
  requests[0].resolve([cropRow]);
  await new Promise(resolve => setImmediate(resolve));
  const statusesAfterFirstResponse = [statusA, statusB];
  for (const request of requests) request.resolve([cropRow]);
  const results = await Promise.all([createA, createB]);

  assert.ok(statusesAfterFirstResponse.every(status => status !== 'rejected'));
  assert.strictEqual(apiCalls.fetch, 1);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled']);
  assert.deepEqual(results.map(result => result.value.status), ['duplicate', 'duplicate']);
});

test('duplicate recovery uses its authoritative row when a later forced refresh supersedes it', async () => {
  const recoveryFetch = deferred();
  const laterFetch = deferred();
  const { catalog, apiCalls } = makeContext({
    fetch: () => apiCalls.fetch === 1 ? recoveryFetch.promise : laterFetch.promise,
    insert: async () => { throw Object.assign(new Error('duplicate'), { code: '23505' }); },
  });

  const duplicatePromise = catalog.create('Rice', '#BBBBBB');
  while (apiCalls.fetch < 1) await new Promise(resolve => setImmediate(resolve));
  const latestRefresh = catalog.refresh({ force: true });
  await new Promise(resolve => setImmediate(resolve));
  laterFetch.resolve([]);
  await latestRefresh;
  recoveryFetch.resolve([{ id: UUID_A, name: 'Rice', hex: '#E0C060' }]);

  const result = await duplicatePromise;
  assert.strictEqual(apiCalls.fetch, 2);
  assert.strictEqual(result.status, 'duplicate');
  assert.strictEqual(result.crop.id, `crop_${UUID_A}`);
  assert.strictEqual(catalog.isResolved(`crop_${UUID_A}`), false);
});

test('a duplicate with no locally matchable normalized name keeps refreshed crops and provides search guidance', async () => {
  const { catalog } = makeContext({
    fetch: async () => [{ id: UUID_A, name: 'Cafe\u0301', hex: '#E0C060' }],
    insert: async () => { throw Object.assign(new Error('duplicate'), { code: '23505' }); },
  });

  await assert.rejects(catalog.create('Caf\u00e9', '#BBBBBB'), /search/i);
  assert.strictEqual(catalog.byId(`crop_${UUID_A}`).name.en, 'Cafe\u0301');
});

test('subscribe returns an unsubscribe function and reference changes create unknown placeholders', () => {
  const { catalog } = makeContext();
  let notifications = 0;
  const unsubscribe = catalog.subscribe(() => notifications++);
  catalog.registerReferences([{ seasons: [{ cropId: 'missing-crop' }, { cropId: 'lettuce' }] }]);

  const placeholder = catalog.byId('missing-crop');
  assert.strictEqual(placeholder.isResolved, false);
  assert.strictEqual(placeholder.isTarget, false);
  assert.match(placeholder.name.en, /Unknown crop \(missing-crop\)/);
  assert.strictEqual(catalog.all().at(-1), placeholder);
  assert.strictEqual(catalog.byId('   '), null);
  assert.strictEqual(catalog.isResolved('missing-crop'), false);
  assert.strictEqual(notifications, 1);

  unsubscribe();
  catalog.registerReferences([{ seasons: [{ cropId: 'another-missing' }] }]);
  assert.strictEqual(notifications, 1);
});

test('registerReferences scans plot maps keyed by plot index', () => {
  const { catalog } = makeContext();

  catalog.registerReferences({ 0: { seasons: [{ cropId: 'missing-from-keyed-plots' }] } });

  assert.strictEqual(catalog.byId('missing-from-keyed-plots').isResolved, false);
  assert.strictEqual(catalog.all().at(-1).id, 'missing-from-keyed-plots');

  catalog.registerReferences({ plots: { 1: { seasons: [{ cropId: 'missing-from-state-wrapper' }] } } });
  assert.strictEqual(catalog.all().at(-1).id, 'missing-from-state-wrapper');
});

test('unknown crop IDs preserve raw whitespace while all-whitespace IDs remain blank', () => {
  const { catalog } = makeContext();
  const rawId = '  legacy crop  ';

  catalog.registerReferences([{ seasons: [{ cropId: rawId }, { cropId: ' \t\n ' }] }]);

  assert.strictEqual(catalog.byId(rawId).id, rawId);
  assert.strictEqual(catalog.byId('legacy crop').id, 'legacy crop');
  assert.strictEqual(catalog.isTarget(' lettuce '), false);
  assert.strictEqual(catalog.all().at(-1).id, rawId);
  assert.strictEqual(catalog.byId(' \t\n '), null);
});

test('catalog rebuild handles a large set of referenced unknown crops', () => {
  const { catalog } = makeContext();
  const plots = Array.from({ length: 150_000 }, (_, index) => ({
    seasons: [{ cropId: `unknown-${index}` }],
  }));

  catalog.registerReferences(plots);

  assert.strictEqual(catalog.all().length, 150_003);
  assert.strictEqual(catalog.byId('unknown-149999').isResolved, false);
});

test('failed Supabase refresh preserves cached rows', async () => {
  const { catalog } = makeContext({
    cache: cache([{ id: UUID_A, name: 'Amaranth', hex: '#258C55' }]),
    fetch: async () => { throw new Error('catalog unavailable'); },
  });

  await assert.rejects(catalog.refresh(), /catalog unavailable/);
  assert.strictEqual(catalog.byId(`crop_${UUID_A}`).name.en, 'Amaranth');
});

test('Tauri mode ignores cache and remote catalog calls and stays target-only', async () => {
  const { catalog, apiCalls, storageCalls } = makeContext({
    tauri: true,
    cache: cache([{ id: UUID_A, name: 'Amaranth', hex: '#258C55' }]),
    fetch: async () => [{ id: UUID_A, name: 'Amaranth', hex: '#258C55' }],
  });

  assert.deepEqual(Array.from(catalog.all(), crop => crop.id), ['lettuce', 'potato', 'carrot']);
  await catalog.refresh();
  await assert.rejects(catalog.create('Amaranth', '#258C55'), /unavailable|offline|Tauri/i);
  assert.deepEqual(apiCalls, { fetch: 0, insert: [] });
  assert.deepEqual(storageCalls, []);
});
