-- Remove Resend. The original `sending_domains` was the Resend/SES schema
-- (resend_id / status / records); the self-hosted sender (the `mailer` fn) needs a
-- different shape (dkim_selector / dkim_public / verified), and the earlier mailer
-- migration's `create table if not exists` was a no-op because the Resend table
-- already existed. No rows exist, so drop and recreate cleanly. Private keys live
-- in a service-role-only table so they never reach the browser.

drop table if exists public.sending_domain_keys;
drop table if exists public.sending_domains;

create table public.sending_domains (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  domain        text not null,
  dkim_selector text not null default 's1',
  dkim_public   text not null,            -- the public "p=" value (safe to expose)
  verified      boolean not null default false,
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, domain)
);
alter table public.sending_domains enable row level security;
create policy "own domains: read"   on public.sending_domains for select using (auth.uid() = user_id);
create policy "own domains: insert" on public.sending_domains for insert with check (auth.uid() = user_id);
create policy "own domains: delete" on public.sending_domains for delete using (auth.uid() = user_id);

-- Private keys: RLS on, ZERO policies -> only the service role (the edge function)
-- can read these. The client never touches this table.
create table public.sending_domain_keys (
  domain_id   uuid primary key references public.sending_domains(id) on delete cascade,
  private_pem text not null
);
alter table public.sending_domain_keys enable row level security;
