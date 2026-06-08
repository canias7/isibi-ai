-- Plaid bank-linking (separate from the Composio connectors). One row per linked
-- bank item. The access_token is sensitive and never exposed to clients: RLS is
-- enabled with NO policies, so only the service role (the `plaid` Edge Function)
-- can read or write this table.
create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  access_token text not null,
  institution_name text,
  created_at timestamptz not null default now(),
  unique (user_id, item_id)
);
alter table public.plaid_items enable row level security;
create index if not exists plaid_items_user_idx on public.plaid_items (user_id, created_at desc);
