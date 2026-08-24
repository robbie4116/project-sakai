drop table if exists public.plots cascade;

create table public.plots (
  plot_idx   integer      primary key,
  seasons    jsonb        not null default '[]',
  farmer_id  text         not null default '',
  farmer     text         not null default '',
  note       text         not null default '',
  photo_url  text,
  device_id  text         not null default '',
  updated_at timestamptz  not null default now()
);

alter table public.plots enable row level security;

drop policy if exists "public_read_write" on public.plots;
create policy "public_read_write" on public.plots
  for all
  using (true)
  with check (true);

insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict do nothing;

drop policy if exists "public_photo_upload" on storage.objects;
create policy "public_photo_upload" on storage.objects
  for insert with check (bucket_id = 'photos');

drop policy if exists "public_photo_read" on storage.objects;
create policy "public_photo_read" on storage.objects
  for select using (bucket_id = 'photos');

-- Optional clean slate for uploaded plot photos. This may require project owner
-- or service-role privileges; skip it if storage cleanup is not needed.
delete from storage.objects
where bucket_id = 'photos';
