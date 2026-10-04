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

-- Permanently remove a shared custom crop and all season entries that use it.
-- The crop row lock serializes this cleanup with plot writes validated below.
create or replace function public.delete_crop_and_seasons(p_crop_id uuid)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  removed_count bigint;
begin
  perform 1 from public.crops where id = p_crop_id for update;
  if not found then
    raise exception 'Custom crop % does not exist.', p_crop_id using errcode = 'P0002';
  end if;

  with changed as (
    select
      p.plot_idx,
      filtered.seasons,
      filtered.removed
    from public.plots as p
    cross join lateral (
      select
        coalesce(
          jsonb_agg(entry.value order by entry.ordinality) filter (
            where not (
              jsonb_typeof(entry.value) = 'object'
              and entry.value ->> 'cropId' = 'crop_' || p_crop_id::text
            )
          ),
          '[]'::jsonb
        ) as seasons,
        count(*) filter (
          where jsonb_typeof(entry.value) = 'object'
            and entry.value ->> 'cropId' = 'crop_' || p_crop_id::text
        )::bigint as removed
      from jsonb_array_elements(
        case when jsonb_typeof(p.seasons) = 'array' then p.seasons else '[]'::jsonb end
      ) with ordinality as entry(value, ordinality)
    ) as filtered
    where filtered.removed > 0
  ), updated as (
    update public.plots as p
    set seasons = changed.seasons,
        updated_at = now()
    from changed
    where p.plot_idx = changed.plot_idx
    returning changed.removed
  )
  select coalesce(sum(removed), 0) into removed_count from updated;

  delete from public.crops where id = p_crop_id;
  return removed_count;
end;
$$;

revoke all on function public.delete_crop_and_seasons(uuid) from public;
grant execute on function public.delete_crop_and_seasons(uuid) to anon, authenticated;

-- Allow an unchanged seasons payload to retain historical missing custom IDs;
-- reject any changed payload that still carries canonical deleted custom IDs.
create or replace function public.validate_plot_custom_crops()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  new_crop_id text;
  custom_id uuid;
begin
  -- Historical missing custom IDs are allowed only when the seasons payload is
  -- unchanged. Any changed payload must validate every canonical custom ID it
  -- retains before the write can proceed.
  if tg_op = 'UPDATE' and new.seasons is not distinct from old.seasons then
    return new;
  end if;

  for new_crop_id in
    select distinct entry.value ->> 'cropId'
    from jsonb_array_elements(
      case when jsonb_typeof(new.seasons) = 'array' then new.seasons else '[]'::jsonb end
    ) as entry(value)
    where jsonb_typeof(entry.value) = 'object'
      and entry.value ? 'cropId'
      and entry.value ->> 'cropId' ~ '^crop_[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$'
  loop
    custom_id := substring(new_crop_id from 6)::uuid;
    perform 1 from public.crops where id = custom_id for key share;
    if not found then
      raise exception 'Custom crop % does not exist.', new_crop_id using errcode = '23503';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists validate_plot_custom_crops_before_write on public.plots;
create trigger validate_plot_custom_crops_before_write
before insert or update of seasons on public.plots
for each row execute function public.validate_plot_custom_crops();
