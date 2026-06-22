-- One brand profile per user — feeds the AI template designer (logo, color, voice,
-- sign-off) so generated emails are on-brand. RLS on, no client policies: only the
-- service-role `templates` function reads/writes it.
create table if not exists public.brand_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  logo_url text not null default '',
  color text not null default '',
  voice text not null default '',
  signoff text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.brand_profiles enable row level security;
