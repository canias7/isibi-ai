-- IMAP/SMTP mailbox connections (encrypted password), one row per user + email.
-- Recorded to match the deployed schema. Access is server-side only: RLS is on
-- with no policies, so only the service role (edge functions) can read/write.
create table if not exists public.imap_accounts (
  user_id uuid not null,
  email text not null,
  enc_password text not null,
  provider text,
  imap_host text not null,
  imap_port integer not null default 993,
  smtp_host text not null,
  smtp_port integer not null default 465,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, email)
);
alter table public.imap_accounts enable row level security;
