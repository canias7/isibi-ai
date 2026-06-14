-- Per-user cache of connected Composio toolkit slugs, so a chat turn (and a
-- workflow tick) reads ONE local row instead of round-tripping to Composio
-- before any work can start. gmail-oauth rewrites the row whenever connections
-- change (list/status/disconnect). Service-role only: RLS enabled with no
-- policies, same as the other tool_* tables.
create table if not exists public.user_connections (
  user_id uuid primary key,
  toolkits text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.user_connections enable row level security;

-- The daily 90-day tool_usage prune deletes by age; index created_at so the
-- sweep stays an index range scan instead of a full-table scan as usage grows.
create index if not exists tool_usage_created_at_idx on public.tool_usage (created_at);

-- One scheduled sweep now owns the tool_data_stash 2h TTL (the per-call inline
-- delete in gofarther-mcp is removed). Every 15 min keeps the worst-case
-- lifetime of stashed bank data at ~2h15m.
select cron.schedule(
  'prune-tool-data-stash',
  '*/15 * * * *',
  $$delete from public.tool_data_stash where created_at < now() - interval '2 hours'$$
);

-- tool_usage gains one row per tool call forever — keep 90 days.
select cron.schedule(
  'prune-tool-usage',
  '20 3 * * *',
  $$delete from public.tool_usage where created_at < now() - interval '90 days'$$
);
