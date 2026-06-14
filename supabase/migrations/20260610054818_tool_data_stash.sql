-- Short-lived stash of structured tool results (per user), so file exports are
-- built server-side from the EXACT data a tool returned — the model passes a
-- handle, never retypes rows. Service-role only by design: RLS is enabled with
-- NO policies, so only edge functions (service role) can read/write it.
create table if not exists public.tool_data_stash (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source text not null,
  columns jsonb not null,
  rows jsonb not null,
  total_columns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.tool_data_stash enable row level security;
create index if not exists tool_data_stash_user_created_idx
  on public.tool_data_stash (user_id, created_at);
