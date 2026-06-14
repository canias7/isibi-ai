-- Security hardening from the June 12 audit. No user-visible behavior changes.

-- 1) These two UPDATE policies had USING but no WITH CHECK, so an update could
--    re-point user_id in the new row. Self-harm only (PK collision / orphaning
--    one's own row), but every other user table re-validates — close the gap.
alter policy us_update on public.user_settings
  with check ((select auth.uid()) = user_id);
alter policy wf_update on public.workflows
  with check ((select auth.uid()) = user_id);

-- 2) Pin the function's search_path (Supabase linter 0011). The body already
--    schema-qualifies public.ai_usage, so an empty path is safe.
alter function public.user_spend_usd(uuid, timestamptz) set search_path = '';

-- 3) ops-monitor's chat probe reads the project's public anon JWT from config
--    instead of a source-committed literal. app_config is world-READABLE by
--    design and the anon key is public by design (it ships inside the app), so
--    this adds zero exposure — and rotating the key becomes a one-row UPDATE.
--    The value itself is inserted operationally (not in this file) so it stays
--    out of git history.
alter table public.app_config add column if not exists text_value text;
