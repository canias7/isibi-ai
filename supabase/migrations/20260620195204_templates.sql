-- Reusable email templates (Sendra) — AI-generated or hand-written, reused in the
-- campaign builder. RLS on with NO client policies: only the service-role
-- `templates` Edge Function touches them (same model as campaigns).
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  subject text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.templates enable row level security;
create index if not exists templates_user_updated_idx on public.templates (user_id, updated_at desc);
