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

test('crop migration is repeatable and grants app roles read, insert, and controlled deletion access', () => {
  assert.match(sqlSource, /create table if not exists public\.crops\s*\(/i);
  assert.match(sqlSource, /create unique index if not exists crops_normalized_name_uq/i);
  assert.match(sqlSource, /alter table public\.crops enable row level security/i);
  assert.match(sqlSource, /revoke all on table public\.crops from public, anon, authenticated/i);

  const grants = sqlSource.match(/\bgrant\b[^;]*;/gi) ?? [];
  assert.deepEqual(grants.map((grant) => grant.replace(/\s+/g, ' ').trim().toLowerCase()), [
    'grant select, insert on table public.crops to anon, authenticated;',
    'grant execute on function public.delete_crop_and_seasons(uuid) to anon, authenticated;',
  ]);

  assert.match(sqlSource, /drop policy if exists crops_public_read on public\.crops/i);
  assert.match(sqlSource, /create policy crops_public_read on public\.crops\s+for select to anon, authenticated using \(true\)/i);
  assert.match(sqlSource, /drop policy if exists crops_public_insert on public\.crops/i);
  assert.match(sqlSource, /create policy crops_public_insert on public\.crops\s+for insert to anon, authenticated with check \(true\)/i);

  assert.match(sqlSource, /revoke all on function public\.delete_crop_and_seasons\(uuid\) from public/i);
  assert.match(sqlSource, /create or replace function public\.delete_crop_and_seasons\(p_crop_id uuid\)\s+returns bigint\s+language plpgsql\s+security definer\s+set search_path = pg_catalog/i);
  assert.match(sqlSource, /create or replace function public\.validate_plot_custom_crops\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path = pg_catalog/i);
  assert.match(sqlSource, /drop trigger if exists validate_plot_custom_crops_before_write on public\.plots/i);
  assert.match(sqlSource, /create trigger validate_plot_custom_crops_before_write\s+before insert or update of seasons on public\.plots\s+for each row execute function public\.validate_plot_custom_crops\(\)/i);
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

test('crop migration limits plot changes to the controlled crop-deletion cleanup', () => {
  assert.doesNotMatch(sqlSource, /\bdrop\s+table\b|\btruncate\b/i);
  assert.doesNotMatch(sqlSource, /\b(?:create|alter|drop|truncate|insert|update|delete)\b[^;]*storage\./i);

  const deleteCropFunction = sqlSource.match(
    /create or replace function public\.delete_crop_and_seasons\(p_crop_id uuid\).*?\$\$;/is,
  )?.[0];
  assert.ok(deleteCropFunction, 'Expected the controlled crop-deletion function');
  assert.match(deleteCropFunction, /update public\.plots as p\s+set seasons = changed\.seasons,\s+updated_at = now\(\)/i);
  assert.match(deleteCropFunction, /delete from public\.crops where id = p_crop_id/i);
  assert.doesNotMatch(deleteCropFunction, /\b(?:alter|drop|truncate|insert|delete)\b[^;]*public\.plots/i);

  const uncontrolledSql = sqlSource
    .replace(deleteCropFunction, '')
    .replace(/drop trigger if exists validate_plot_custom_crops_before_write on public\.plots\s*;/i, '')
    .replace(/create trigger validate_plot_custom_crops_before_write.*?public\.validate_plot_custom_crops\(\)\s*;/is, '');
  assert.doesNotMatch(uncontrolledSql, /\bpublic\.plots\b/i);
});
