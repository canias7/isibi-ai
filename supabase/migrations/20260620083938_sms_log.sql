-- Per-user SMS send log: powers daily rate-limiting and usage/cost tracking for
-- the platform-owned Twilio sender. RLS on with NO client policies, so only the
-- service-role `sms` Edge Function can read/write it (same model as telegram_sessions).
create table if not exists public.sms_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  to_number text not null,
  sid text,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);
alter table public.sms_log enable row level security;
create index if not exists sms_log_user_created_idx on public.sms_log (user_id, created_at desc);
