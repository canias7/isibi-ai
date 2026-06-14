-- Single-use jti store for the OAuth connect codes minted by /connect-init.
-- A code's sha256 lands here when minted and is consumed (deleted) by /start;
-- replaying a code finds no row and is rejected. RLS on + no policies =
-- service-role only. Rows self-prune opportunistically on each mint.
create table if not exists public.oauth_codes (
  jti text primary key,
  created_at timestamptz not null default now()
);
alter table public.oauth_codes enable row level security;
