-- Per-user Twilio connection for SMS. Each user brings their own Twilio account +
-- number (like verifying their own email domain). RLS is ON with NO client policies,
-- so only the service-role `sms` Edge Function can read these rows — the auth token
-- is a secret and never goes to the client.

create table if not exists public.sms_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_sid text not null,
  auth_token text not null,
  from_number text,
  messaging_service_sid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sms_connections enable row level security;
