-- Records every connector tool call so the "most-used" allowlists in the
-- gmail-mcp function can later be re-ranked from REAL usage instead of
-- estimates. Written by the gmail-mcp edge function via the service role.
create table if not exists public.tool_usage (
  id bigint generated always as identity primary key,
  tool text not null,
  user_id text,
  success boolean,
  created_at timestamptz not null default now()
);

create index if not exists tool_usage_tool_idx on public.tool_usage (tool);
create index if not exists tool_usage_created_at_idx on public.tool_usage (created_at);

-- Locked down: only the service role (the gmail-mcp function) reads/writes.
-- RLS enabled with no policies = no anon/authenticated access.
alter table public.tool_usage enable row level security;
