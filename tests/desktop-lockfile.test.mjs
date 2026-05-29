import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('Tauri Rust dependency graph is locked for CI builds', () => {
  const trackedFiles = execFileSync('git', ['ls-files', 'src-tauri/Cargo.lock'], {
    encoding: 'utf8',
  }).trim();

  assert.equal(trackedFiles, 'src-tauri/Cargo.lock');

  const lockfile = readFileSync(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8');
  assert.match(lockfile, /name = "dispatch2"\r?\nversion = "0\.3\.1"/);
  assert.match(lockfile, /name = "bitflags"\r?\nversion = "2\.11\.1"/);
  assert.doesNotMatch(lockfile, /name = "bitflags"\r?\nversion = "2\.12\.0"/);
});
