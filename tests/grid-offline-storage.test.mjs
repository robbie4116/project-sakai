import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../offline-storage.js', import.meta.url), 'utf8');
const GRID_ID = 's2-32651-258690-1841210-10-571-494-v1';
const directory = '/test-data';
const current = `${directory}/state-s2-classes-v1.json`;
const backup = `${current}.bak`;
const legacy = `${directory}/state.json`;

async function offline(initial = {}) {
  const files = new Map(Object.entries(initial));
  const operations = [];
  const invokes = [];
  let browserReads = 0;
  const window = { GRID: { id: GRID_ID }, __TAURI__: {
    core: { invoke: async (command, args) => {
      invokes.push([command,args]);
      return command === 'get_data_dir' ? directory : `photos/plot_00_${args.suffix}.jpg`;
    } },
    fs: {
      exists: async path => { operations.push(['exists',path]); return files.has(path); },
      readTextFile: async path => { operations.push(['read',path]); return files.get(path); },
      writeTextFile: async (path,text) => { operations.push(['write',path]); files.set(path,text); },
      remove: async path => { operations.push(['remove',path]); files.delete(path); },
      rename: async (from,to) => { operations.push(['rename',from,to]); files.set(to,files.get(from)); files.delete(from); },
    },
  } };
  vm.runInNewContext(source, { window, localStorage: {
    removeItem() {}, getItem() { browserReads++; return '{"legacy":true}'; },
  }, console: { warn() {} }, atob: text => Buffer.from(text,'base64').toString('binary'), Uint8Array });
  await window.__TANIMAN_OFFLINE_READY;
  return { window, files, operations, invokes, get browserReads() { return browserReads; } };
}

async function drainWrites() {
  await new Promise(resolve => setImmediate(resolve));
}

test('preload ignores legacy native state and browser state', async () => {
  const native = await offline({ [legacy]: '{"old":1}', [`${legacy}.bak`]: '{"old":2}' });
  assert.equal(native.window.loadPersisted(), null);
  assert.equal(native.browserReads, 0);
  assert.ok(native.operations.every(op => !op.slice(1).includes(legacy) && !op.slice(1).includes(`${legacy}.bak`)));
});

test('two Sentinel saves rotate only Sentinel files and preserve legacy state and backup', async () => {
  const native = await offline({ [legacy]: '{"old":1}', [`${legacy}.bak`]: '{"old":2}' });
  native.window.persistState({ gridId: GRID_ID, version: 1 });
  native.window.persistState({ gridId: GRID_ID, version: 2 });
  await drainWrites();
  assert.equal(native.files.get(legacy), '{"old":1}');
  assert.equal(native.files.get(`${legacy}.bak`), '{"old":2}');
  assert.equal(JSON.parse(native.files.get(current)).version, 2);
  assert.equal(JSON.parse(native.files.get(backup)).version, 1);
  assert.equal(native.files.has(`${current}.tmp`), false);
});

test('preload caches Sentinel state and recovers its backup without touching legacy state', async () => {
  const good = JSON.stringify({ gridId: GRID_ID, version: 3 });
  for (const main of [undefined, 'corrupt']) {
    const files = { [legacy]: '{"old":1}', [backup]: good };
    if (main !== undefined) files[current] = main;
    const native = await offline(files);
    assert.equal(native.window.loadPersisted().version, 3);
    assert.equal(native.window.loadPersisted(), native.window.loadPersisted());
    assert.equal(native.browserReads, 0);
  }
  const native = await offline({ [current]: good, [backup]: '{"version":2}' });
  assert.equal(native.window.loadPersisted().version, 3);
});

test('native uploads use a separate Sentinel photo namespace', async () => {
  const native = await offline();
  const path = await native.window.uploadPhoto(0, 'data:image/jpeg;base64,YQ==', '123_0');
  assert.equal(path, 'photos/plot_00_s2-v1_123_0.jpg');
  assert.equal(native.invokes[1][1].suffix, 's2-v1_123_0');
});

test('browser builds do not install native storage hooks', () => {
  const window = {};
  vm.runInNewContext(source, { window });
  assert.equal(window.persistState, undefined);
  assert.equal(window.loadPersisted, undefined);
});
