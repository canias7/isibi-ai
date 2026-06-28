-- Advisor hardening after the self-hosted mailer migration.

-- RLS perf (auth_rls_initplan): evaluate auth.uid() once per query, not per row.
drop policy if exists "own domains: read"   on public.sending_domains;
drop policy if exists "own domains: insert" on public.sending_domains;
drop policy if exists "own domains: delete" on public.sending_domains;
create policy "own domains: read"   on public.sending_domains for select using ((select auth.uid()) = user_id);
create policy "own domains: insert" on public.sending_domains for insert with check ((select auth.uid()) = user_id);
create policy "own domains: delete" on public.sending_domains for delete using ((select auth.uid()) = user_id);

-- Cover the user_id foreign keys that deliverability/logs/list scan (unindexed_foreign_keys).
create index if not exists campaigns_user_created_idx on public.campaigns (user_id, created_at desc);
create index if not exists campaign_recipients_user_idx on public.campaign_recipients (user_id);

-- Pin search_path on the tracking RPCs (function_search_path_mutable; bodies already schema-qualify).
alter function public.campaign_track_click(uuid, uuid) set search_path = '';
alter function public.campaign_track_open(uuid, uuid) set search_path = '';
