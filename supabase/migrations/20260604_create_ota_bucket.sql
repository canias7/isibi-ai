-- Public Storage bucket that hosts the OTA web bundle + manifest. Direct public
-- URLs (no GitHub redirect/throttle), so the native updater downloads reliably.
-- The CI "Web OTA bundle" workflow uploads here with the service role key.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ota', 'ota', true, 52428800)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;
