create table if not exists public.crops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hex text not null,
  created_at timestamptz not null default now(),
  constraint crops_name_length check (
    char_length(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))) between 1 and 80
  ),
  constraint crops_hex_format check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  constraint crops_not_target_name check (
    lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))
      not in ('lettuce', 'letsugas', 'potato', 'patatas', 'carrot', 'karot')
  )
);

create unique index if not exists crops_normalized_name_uq
  on public.crops ((lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))));

alter table public.crops enable row level security;
revoke all on table public.crops from PUBLIC, anon, authenticated;
grant select, insert on table public.crops to anon, authenticated;

drop policy if exists crops_public_read on public.crops;
create policy crops_public_read on public.crops
  for select to anon, authenticated using (true);
drop policy if exists crops_public_insert on public.crops;
create policy crops_public_insert on public.crops
  for insert to anon, authenticated with check (true);
