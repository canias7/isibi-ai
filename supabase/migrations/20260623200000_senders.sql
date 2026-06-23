-- Saved "From" identities (name + address@a-verified-domain) reused across campaigns.
-- Managed by the ses function; picked in the campaign composer.
create table if not exists public.senders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_name text not null default '',
  from_email text not null,
  created_at timestamptz not null default now(),
  unique (user_id, from_email)
);
create index if not exists senders_user_id_idx on public.senders (user_id);
alter table public.senders enable row level security;
create policy "own senders" on public.senders
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
