-- Perf: cover the workflow_runs.user_id foreign key with an index.
create index if not exists workflow_runs_user_id_idx on public.workflow_runs (user_id);

-- Perf: wrap auth.uid() in a scalar subselect so RLS evaluates it once per query
-- instead of once per row (matches the pattern already used on the other tables).
-- Same own-row logic, just re-planned.
drop policy if exists conversations_select_own on public.conversations;
create policy conversations_select_own on public.conversations
  for select using ((select auth.uid()) = user_id);

drop policy if exists conversations_insert_own on public.conversations;
create policy conversations_insert_own on public.conversations
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists conversations_update_own on public.conversations;
create policy conversations_update_own on public.conversations
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists conversations_delete_own on public.conversations;
create policy conversations_delete_own on public.conversations
  for delete using ((select auth.uid()) = user_id);
