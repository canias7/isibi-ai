-- Telegram user sessions (encrypted GramJS string session), one row per app user.
-- Recorded to match the deployed schema. Access is server-side only: RLS is on
-- with no policies, so only the service role (edge functions) can read/write.
create table if not exists public.telegram_sessions (
  user_id uuid primary key,
  enc_session text not null,
  phone text,
  tg_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.telegram_sessions enable row level security;
