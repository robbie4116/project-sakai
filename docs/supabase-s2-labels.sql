-- Additive migration for the Sentinel-2 grid alignment app.
-- Run in the connected Supabase SQL Editor BEFORE merging/deploying this branch.
-- Does not reset public.plots, public.seasons, public.crops or legacy labels.
begin;

create table if not exists public.s2_label_plots (
  plot_idx integer primary key check (plot_idx between 1000000 and 1000119),
  grid_id text not null check (grid_id = 's2-32651-258690-1841210-10-571-494-v1'),
  seasons jsonb not null default '[]' check (jsonb_typeof(seasons) = 'array'),
  farmer_id text not null default '',
  farmer text not null default '',
  note text not null default '',
  photo_url text,
  device_id text,
  updated_at timestamptz not null default now()
);
alter table public.s2_label_plots enable row level security;
grant select, insert, update, delete on public.s2_label_plots to anon, authenticated;
drop policy if exists s2_labels_public_access on public.s2_label_plots;
create policy s2_labels_public_access on public.s2_label_plots
  for all to anon, authenticated using (true) with check (true);

-- A delayed whole-plot save must not resurrect a deleted shared crop.
-- Keep historical unchanged payloads editable, matching the legacy safeguard.
create or replace function public.validate_s2_label_custom_crops()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare
  custom_key text;
begin
  if tg_op = 'UPDATE' and new.seasons is not distinct from old.seasons then
    return new;
  end if;
  for custom_key in
    select distinct s->>'cropId' from jsonb_array_elements(new.seasons) s
    where s->>'cropId' ~* '^crop_[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
  loop
    perform 1 from public.crops where id = substring(custom_key from 6)::uuid for key share;
    if not found then
      raise exception 'Custom crop % does not exist.', custom_key using errcode = '23503';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists validate_s2_label_custom_crops_before_write on public.s2_label_plots;
create trigger validate_s2_label_custom_crops_before_write
  before insert or update of seasons on public.s2_label_plots
  for each row execute function public.validate_s2_label_custom_crops();
revoke all on function public.validate_s2_label_custom_crops() from public;

-- Custom crops are shared. Refuse deletion if another labeling dataset uses
-- the crop; otherwise prune only this grid's JSON seasons and delete the name.
create or replace function public.delete_s2_crop_and_seasons(p_crop_id uuid)
returns bigint
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  removed bigint;
  referenced boolean := false;
  crop_key text := 'crop_' || p_crop_id::text;
begin
  perform 1 from public.crops where id = p_crop_id for update;
  if not found then return 0; end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'seasons' and column_name = 'crop_id') then
    execute 'select exists(select 1 from public.seasons where crop_id = $1)'
      into referenced using p_crop_id;
    if referenced then
      raise exception 'This crop is used by another labeling dataset. Keep the crop name.';
    end if;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'plots' and column_name = 'seasons') then
    execute 'select exists(select 1 from public.plots p, jsonb_array_elements(p.seasons) s where s->>''cropId'' = $1)'
      into referenced using crop_key;
    if referenced then
      raise exception 'This crop is used by legacy labels. Keep the crop name.';
    end if;
  end if;

  select count(*) into removed from public.s2_label_plots p,
    jsonb_array_elements(p.seasons) s where s->>'cropId' = crop_key;
  update public.s2_label_plots p set
    seasons = coalesce((select jsonb_agg(s order by position)
      from jsonb_array_elements(p.seasons) with ordinality as items(s, position)
      where s->>'cropId' is distinct from crop_key), '[]'::jsonb),
    updated_at = now()
  where exists (select 1 from jsonb_array_elements(p.seasons) s where s->>'cropId' = crop_key);
  delete from public.crops where id = p_crop_id;
  return removed;
end;
$$;
revoke all on function public.delete_s2_crop_and_seasons(uuid) from public;
grant execute on function public.delete_s2_crop_and_seasons(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
