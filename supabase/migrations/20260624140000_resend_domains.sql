-- Per-user custom sending domains, on Resend. Each user adds their own domain; it's
-- created in the platform's single Resend account (via the Resend Domains API), the user
-- adds the returned DNS records, and verifies. Only a verified domain can be used as a
-- campaign From address. (The old SES version of this table was dropped in 20260624130000;
-- this is the Resend-backed replacement.)
create table if not exists public.sending_domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  resend_id text,                                 -- Resend's domain id (for verify/remove)
  status text not null default 'pending',         -- pending | verified | failed
  records jsonb not null default '[]'::jsonb,      -- DNS records Resend returned (shown to the user)
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (user_id, domain)
);

create index if not exists sending_domains_user_idx on public.sending_domains (user_id, created_at desc);
-- A domain can only be *verified* by one account (prevents claiming someone else's verified domain).
create unique index if not exists sending_domains_verified_uniq on public.sending_domains (domain) where status = 'verified';

alter table public.sending_domains enable row level security;
-- Owners can read their own; all writes go through the service-role edge function.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sending_domains' and policyname='sending_domains_owner_select') then
    create policy sending_domains_owner_select on public.sending_domains for select using (auth.uid() = user_id);
  end if;
end $$;
