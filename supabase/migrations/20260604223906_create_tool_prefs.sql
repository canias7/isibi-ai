-- Per-user, per-app tool selection (which Composio tools the assistant may use).
-- Absence of a row = use the curated defaults; a row overrides with `slugs`.
create table if not exists public.tool_prefs (
  user_id uuid not null,
  toolkit text not null,
  slugs text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, toolkit)
);

-- Only the edge functions (service role) read/write this; no public access.
alter table public.tool_prefs enable row level security;
