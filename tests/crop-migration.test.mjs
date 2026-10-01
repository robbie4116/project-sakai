import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sqlSource = await readFile(new URL('../docs/supabase-add-crops.sql', import.meta.url), 'utf8');

function compactSql(source) {
  const stringLiterals = [];
  return source.toLowerCase()
    .replace(/'(?:''|[^'])*'/g, (literal) => {
      stringLiterals.push(literal);
      return `__sql_literal_${stringLiterals.length - 1}__`;
    })
    .replace(/\s+/g, '')
    .replace(/__sql_literal_(\d+)__/g, (_, index) => stringLiterals[Number(index)]);
}

function sqlBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected SQL to contain ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Expected SQL to contain ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

test('crop migration is repeatable and grants app roles read and insert access only', () => {
  assert.match(sqlSource, /create table if not exists public\.crops\s*\(/i);
  assert.match(sqlSource, /create unique index if not exists crops_normalized_name_uq/i);
  assert.match(sqlSource, /alter table public\.crops enable row level security/i);
  assert.match(sqlSource, /revoke all on table public\.crops from public, anon, authenticated/i);

  const grants = sqlSource.match(/\bgrant\b[^;]*;/gi) ?? [];
  assert.deepEqual(grants.map((grant) => grant.replace(/\s+/g, ' ').trim().toLowerCase()), [
    'grant select, insert on table public.crops to anon, authenticated;',
  ]);

  assert.match(sqlSource, /drop policy if exists crops_public_read on public\.crops/i);
  assert.match(sqlSource, /create policy crops_public_read on public\.crops\s+for select to anon, authenticated using \(true\)/i);
  assert.match(sqlSource, /drop policy if exists crops_public_insert on public\.crops/i);
  assert.match(sqlSource, /create policy crops_public_insert on public\.crops\s+for insert to anon, authenticated with check \(true\)/i);
});

test('crop migration requires non-null names and #RRGGBB hex colors', () => {
  assert.match(sqlSource, /\bname\s+text\s+not\s+null\b/i);
  assert.match(sqlSource, /\bhex\s+text\s+not\s+null\b/i);
  assert.match(sqlSource, /constraint\s+crops_hex_format\s+check\s*\(\s*hex\s*~\s*'\^#\[0-9A-Fa-f\]\{6\}\$'\s*\)/i);
});

test('crop migration reserves every built-in display name using the shared normalized expression', () => {
  const compact = compactSql(sqlSource);
  const lengthCheck = sqlBetween(compact, 'constraintcrops_name_lengthcheck(', 'constraintcrops_hex_format');
  const targetNameCheck = sqlBetween(compact, 'constraintcrops_not_target_namecheck(', ');');
  const uniqueIndex = sqlBetween(compact, 'createuniqueindexifnotexistscrops_normalized_name_uq', ';');
  const normalizedName = "btrim(regexp_replace(name,'[[:space:]]+',' ','g'))";

  assert.ok(lengthCheck.includes(`char_length(${normalizedName})between1and80`));

  const targetNames = targetNameCheck.match(/notin\(([^)]*)\)/)?.[1]
    .split(',')
    .map((name) => name.replaceAll("'", ''))
    .sort();
  assert.deepEqual(targetNames, ['carrot', 'karot', 'letsugas', 'lettuce', 'patatas', 'potato']);
  assert.ok(targetNameCheck.includes(`lower(${normalizedName})notin(`));
  assert.ok(uniqueIndex.includes(`onpublic.crops((lower(${normalizedName})))`));
});

test('crop migration does not reset plots or mutate storage', () => {
  assert.doesNotMatch(sqlSource, /\bdrop\s+table\b|\btruncate\b/i);
  assert.doesNotMatch(sqlSource, /\b(?:create|alter|drop|truncate|insert|update|delete)\b[^;]*(?:public\.plots|storage\.)/i);
});
