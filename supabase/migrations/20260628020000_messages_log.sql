-- Transactional message log: one row per mailer.send (the general-purpose / API send
-- path), so transactional sends get the same delivered/bounce tracking + activity
-- timeline as campaigns, and so an Idempotency-Key can dedupe retried sends.
-- Service-role only (RLS on, no policies) — read/written by the edge functions.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider_msg_id text,                    -- relay Message-ID (sans <>); maps box events back
  to_email text not null,
  from_email text,
  subject text,
  status text not null default 'sent',     -- sent | delivered | bounced | soft_bounced | complained | failed
  error text,
  idempotency_key text,                    -- optional client-supplied dedupe key
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index if not exists messages_user_created_idx on public.messages (user_id, created_at desc);
create index if not exists messages_provider_idx on public.messages (provider_msg_id) where provider_msg_id is not null;
-- Idempotency: at most one row per (user, key); partial so unlimited null-key rows are fine.
create unique index if not exists messages_idem_idx on public.messages (user_id, idempotency_key) where idempotency_key is not null;
