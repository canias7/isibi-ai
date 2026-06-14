create table if not exists public.gmail_tokens (
  user_id text primary key,
  email text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz default now()
);
-- RLS on with no policies: anon/public cannot read tokens; Edge Functions use
-- the service-role key, which bypasses RLS.
alter table public.gmail_tokens enable row level security;
