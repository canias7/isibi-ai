-- Explicitly forbid non-service-role writes to the `ota` bucket. CI publishes
-- OTA bundles via the service role, which bypasses RLS, so it is unaffected.
-- These are RESTRICTIVE policies: they AND with any permissive policy, so even
-- if a broad "allow authenticated write" policy is added to storage.objects
-- later, writes to `ota` stay blocked. Public read is unaffected (the bucket is
-- public; downloads are served without RLS).
create policy "ota_block_client_insert" on storage.objects
  as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'ota');

create policy "ota_block_client_update" on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id <> 'ota')
  with check (bucket_id <> 'ota');

create policy "ota_block_client_delete" on storage.objects
  as restrictive for delete to anon, authenticated
  using (bucket_id <> 'ota');
