-- Custom sending domains for campaigns via Amazon SES. Each user verifies their
-- own domain (DKIM CNAME records) under the platform's SES account; once verified
-- they can send campaigns From news@theirdomain.com. RLS is ON with NO client
-- policies, so only the service-role `ses` Edge Function can touch these rows.

create table if not exists public.sending_domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  status text not null default 'pending',        -- pending | verified | failed
  records jsonb not null default '[]'::jsonb,     -- DNS records the user must add
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, domain)
);

alter table public.sending_domains enable row level security;
create index if not exists sending_domains_user_idx on public.sending_domains (user_id, created_at desc);

-- A campaign can be sent through the user's mailbox (default) or from a verified
-- SES domain. from_email/from_name are only used when send_via = 'ses'.
alter table public.campaigns add column if not exists send_via text not null default 'mailbox'; -- mailbox | ses
alter table public.campaigns add column if not exists from_email text;
alter table public.campaigns add column if not exists from_name text;
