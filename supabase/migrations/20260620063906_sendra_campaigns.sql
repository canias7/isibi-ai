-- Email campaigns (Sendra) — sent through the user's own mailbox via the
-- `campaigns` Edge Function. RLS is ON with NO client policies, so only the
-- service-role function can touch these rows (they hold recipient email lists).
-- Idempotent: the tables already exist in this project; this records the schema.

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null default 'gmail',
  name text not null default '',
  subject text not null default '',
  body text not null default '',
  status text not null default 'draft',     -- draft | sending | sent
  total integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  name text,
  status text not null default 'queued',    -- queued | sent | failed
  error text,
  sent_at timestamptz
);

create table if not exists public.email_suppressions (
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  reason text not null default 'unsubscribe',
  created_at timestamptz not null default now(),
  primary key (user_id, email)
);

alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.email_suppressions enable row level security;

create index if not exists campaigns_user_created_idx on public.campaigns (user_id, created_at desc);
create index if not exists campaign_recipients_queue_idx on public.campaign_recipients (campaign_id, status, id);
