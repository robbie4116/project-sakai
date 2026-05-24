create table public.plots (
  plot_idx   integer primary key,
  labels     integer[] not null default '{}',
  farmer     text      not null default '',
  note       text      not null default '',
  photo_url  text,
  device_id  text      not null default '',
  updated_at timestamptz not null default now()
);

alter table public.plots enable row level security;

create policy "public_read_write" on public.plots
  for all
  using (true)
  with check (true);

insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict do nothing;

create policy "public_photo_upload" on storage.objects
  for insert with check (bucket_id = 'photos');

create policy "public_photo_read" on storage.objects
  for select using (bucket_id = 'photos');
