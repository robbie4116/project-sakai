import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainRs = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

test('native ZIP save dialog runs outside the Tauri main thread', () => {
  const saveZipMatch = mainRs.match(
    /#\[tauri::command\]\s*(?:async\s+)?fn\s+save_zip[\s\S]*?^\}/m,
  );

  assert.ok(saveZipMatch, 'save_zip command should exist');
  assert.match(saveZipMatch[0], /blocking_save_file\(\)/);
  assert.match(
    saveZipMatch[0],
    /#\[tauri::command\]\s*async\s+fn\s+save_zip/,
    'save_zip uses a blocking native dialog, so it must be async to avoid running on the main thread',
  );
});
