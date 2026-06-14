-- In-app usage meter: let each user read THEIR OWN ai_usage rows (written by
-- the edge functions with the service role, which bypasses RLS). No insert/
-- update/delete for clients — telemetry stays server-written.
alter table public.ai_usage enable row level security;
drop policy if exists au_select_own on public.ai_usage;
create policy au_select_own on public.ai_usage
  for select using ((select auth.uid()) = user_id);
