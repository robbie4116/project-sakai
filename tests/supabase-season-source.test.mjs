import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const syncSource = await readFile(new URL('../supabase-sync.js', import.meta.url), 'utf8');
const sqlSource = await readFile(new URL('../docs/supabase-setup.sql', import.meta.url), 'utf8');

test('supabase sync stores seasons json instead of cells arrays', () => {
  assert.match(syncSource, /seasons:\s*Array\.isArray\(plotData\.seasons\)/);
  assert.match(syncSource, /Array\.isArray\(row\.seasons\)/);
  assert.doesNotMatch(syncSource, /new Uint16Array/);
});

test('supabase setup resets plots with seasons jsonb', () => {
  assert.match(sqlSource, /drop table if exists public\.plots/);
  assert.match(sqlSource, /seasons\s+jsonb\s+not null\s+default '\[\]'/);
});

test('supabase setup does not directly delete protected storage rows', () => {
  assert.doesNotMatch(sqlSource, /delete\s+from\s+storage\.objects/i);
});
