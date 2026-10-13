-- =====================================================================
-- Taniman labeling foundation schema (spec 2026-10-13, section 8)
-- DESTRUCTIVE: drops and recreates public.plots and public.seasons.
-- All plot notes, photo links and painted labels are deleted.
-- Shared crop names in public.crops are kept, except names that are now
-- classes (carrot, cabbage, potato).
-- Run once in the Supabase SQL Editor when the new app version deploys.
-- =====================================================================

-- 1. Remove the old plot-row model --------------------------------------
drop trigger if exists validate_plot_custom_crops_before_write on public.plots;
drop function if exists public.validate_plot_custom_crops();
drop function if exists public.delete_crop_and_seasons(uuid);
drop function if exists public.apply_season_cells(text, integer, smallint, uuid, text, text, text, integer[], integer[]);
drop function if exists public.clear_plot(integer);
drop function if exists public.delete_crop(uuid);
drop table if exists public.seasons cascade;
drop table if exists public.plots cascade;

-- 2. Plot notes and photos ----------------------------------------------
create table public.plots (
  plot_idx   integer     primary key check (plot_idx between 0 and 119),
  note       text        not null default '',
  photo_url  text,
  updated_at timestamptz not null default now()
);

alter table public.plots enable row level security;
drop policy if exists "public_read_write" on public.plots;
create policy "public_read_write" on public.plots
  for all using (true) with check (true);

-- 3. Shared crop names for class 4 "Other cultivated" -------------------
create table if not exists public.crops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hex text not null,
  created_at timestamptz not null default now(),
  constraint crops_name_length check (
    char_length(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))) between 1 and 80
  ),
  constraint crops_hex_format check (hex ~ '^#[0-9A-Fa-f]{6}$')
);

create unique index if not exists crops_normalized_name_uq
  on public.crops ((lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))));

-- Names that are now classes cannot be crop names.
delete from public.crops
  where lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))
    in ('carrot', 'karot', 'cabbage', 'repolyo', 'potato', 'patatas');
alter table public.crops drop constraint if exists crops_not_target_name;
alter table public.crops add constraint crops_not_target_name check (
  lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))
    not in ('carrot', 'karot', 'cabbage', 'repolyo', 'potato', 'patatas')
);

insert into public.crops (name, hex) values
  ('Lettuce', '#22C55E'),
  ('Wombok', '#4ADE80')
on conflict do nothing;

alter table public.crops enable row level security;
revoke all on table public.crops from PUBLIC, anon, authenticated;
grant select, insert on table public.crops to anon, authenticated;
drop policy if exists crops_public_read on public.crops;
create policy crops_public_read on public.crops
  for select to anon, authenticated using (true);
drop policy if exists crops_public_insert on public.crops;
create policy crops_public_insert on public.crops
  for insert to anon, authenticated with check (true);

-- 4. Seasons: one row per (plot, class, crop name/remark, dates) ---------
create table public.seasons (
  id         text        primary key check (char_length(id) <= 400),
  plot_idx   integer     not null check (plot_idx between 0 and 119),
  class_id   smallint    check (class_id between 1 and 8),
  crop_id    uuid        references public.crops(id) on delete cascade,
  remark     text        check (remark is null or char_length(remark) <= 200),
  start_mmdd text        not null check (start_mmdd ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  end_mmdd   text        not null check (end_mmdd ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  cells      integer[]   not null default '{}',
  updated_at timestamptz not null default now(),
  constraint seasons_crop_only_for_class4
    check ((class_id is not distinct from 4) = (crop_id is not null)),
  constraint seasons_remark_only_for_other
    check ((class_id is null) = (coalesce(char_length(btrim(remark)), 0) > 0))
);

create index seasons_plot_idx on public.seasons (plot_idx);

alter table public.seasons enable row level security;
revoke all on table public.seasons from PUBLIC, anon, authenticated;
grant select on table public.seasons to anon, authenticated;
drop policy if exists seasons_public_read on public.seasons;
create policy seasons_public_read on public.seasons
  for select to anon, authenticated using (true);

-- 5. Atomic cell deltas ---------------------------------------------------
-- cells := (existing ∪ p_add) − p_remove. INSERT ... ON CONFLICT locks the
-- row, so concurrent calls for the same season serialize. The id is derived
-- from the metadata, so metadata never conflicts; remark is not updated.
create or replace function public.apply_season_cells(
  p_id text, p_plot_idx integer, p_class_id smallint, p_crop_id uuid, p_remark text,
  p_start text, p_end text, p_add integer[], p_remove integer[])
returns public.seasons
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result public.seasons;
  v_add integer[] := coalesce(p_add, '{}');
  v_remove integer[] := coalesce(p_remove, '{}');
begin
  if exists (select 1 from unnest(v_add || v_remove) as c where c < 0 or c > 2499) then
    raise exception 'Cell index out of range' using errcode = '22023';
  end if;

  insert into public.seasons as s
    (id, plot_idx, class_id, crop_id, remark, start_mmdd, end_mmdd, cells, updated_at)
  values (
    p_id, p_plot_idx, p_class_id, p_crop_id, nullif(btrim(p_remark), ''), p_start, p_end,
    coalesce((select array_agg(distinct c order by c) from unnest(v_add) as c
              where c <> all (v_remove)), '{}'),
    now())
  on conflict (id) do update set
    cells = coalesce((select array_agg(distinct c order by c) from unnest(s.cells || v_add) as c
                      where c <> all (v_remove)), '{}'),
    updated_at = now()
  returning * into result;

  if cardinality(result.cells) = 0 then
    delete from public.seasons where id = p_id;
    return null;
  end if;
  return result;
end;
$$;

-- 6. Clear a whole plot (including seasons this browser has not seen) ----
create or replace function public.clear_plot(p_plot_idx integer)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  delete from public.seasons where plot_idx = p_plot_idx;
  insert into public.plots (plot_idx, note, photo_url, updated_at)
  values (p_plot_idx, '', null, now())
  on conflict (plot_idx) do update set note = '', photo_url = null, updated_at = now();
end;
$$;

-- 7. Delete a crop name and its seasons (cascade) -----------------------
create or replace function public.delete_crop(p_crop_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  removed bigint;
begin
  select count(*) into removed from public.seasons where crop_id = p_crop_id;
  delete from public.crops where id = p_crop_id;
  if not found then
    return 0;
  end if;
  return removed;
end;
$$;

revoke all on function public.apply_season_cells(text, integer, smallint, uuid, text, text, text, integer[], integer[]) from public;
revoke all on function public.clear_plot(integer) from public;
revoke all on function public.delete_crop(uuid) from public;
grant execute on function public.apply_season_cells(text, integer, smallint, uuid, text, text, text, integer[], integer[]) to anon, authenticated;
grant execute on function public.clear_plot(integer) to anon, authenticated;
grant execute on function public.delete_crop(uuid) to anon, authenticated;

-- 8. Photos bucket (unchanged) ------------------------------------------
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict do nothing;
drop policy if exists "public_photo_upload" on storage.objects;
create policy "public_photo_upload" on storage.objects
  for insert with check (bucket_id = 'photos');
drop policy if exists "public_photo_read" on storage.objects;
create policy "public_photo_read" on storage.objects
  for select using (bucket_id = 'photos');

-- 9. Make PostgREST pick up the new functions immediately ---------------
notify pgrst, 'reload schema';
