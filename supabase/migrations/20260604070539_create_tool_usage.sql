create table if not exists public.tool_usage (
  id bigint generated always as identity primary key,
  tool text not null,
  user_id text,
  success boolean,
  created_at timestamptz not null default now()
);

create index if not exists tool_usage_tool_idx on public.tool_usage (tool);
create index if not exists tool_usage_created_at_idx on public.tool_usage (created_at);

-- Locked down: only the service role (used by the gmail-mcp edge function)
-- can write/read. RLS on with no policies = no anon/auth access.
alter table public.tool_usage enable row level security;
