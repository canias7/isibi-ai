-- A memory can carry one attachment: the original file is kept (storage) and its
-- contents are extracted into `content` (the text the AI uses).
alter table public.user_memory
  add column if not exists attachment_path text,
  add column if not exists attachment_type text,   -- 'image' | 'pdf' | 'file'
  add column if not exists attachment_name text;

-- Private bucket for memory attachments.
insert into storage.buckets (id, name, public)
values ('memory', 'memory', false)
on conflict (id) do nothing;

-- Owner-scoped: a user can only touch files under their own folder (uid/...).
create policy "mem_obj_select" on storage.objects for select
  using (bucket_id = 'memory' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "mem_obj_insert" on storage.objects for insert
  with check (bucket_id = 'memory' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "mem_obj_delete" on storage.objects for delete
  using (bucket_id = 'memory' and (select auth.uid())::text = (storage.foldername(name))[1]);
