-- Optional check after running supabase-foundation.sql. Leaves no data behind.
select public.apply_season_cells('p0|2||03-01|06-30|', 0, 2::smallint, null, null, '03-01', '06-30', array[1,2,3], '{}');
select public.apply_season_cells('p0|2||03-01|06-30|', 0, 2::smallint, null, null, '03-01', '06-30', array[4], array[2]);
select id, cells from public.seasons where id = 'p0|2||03-01|06-30|';   -- expect {1,3,4}
select public.apply_season_cells('p0|2||03-01|06-30|', 0, 2::smallint, null, null, '03-01', '06-30', '{}', array[1,3,4]);
select count(*) from public.seasons where id = 'p0|2||03-01|06-30|';    -- expect 0
select name from public.crops order by name;                              -- expect Lettuce, Wombok (+ any older names)
