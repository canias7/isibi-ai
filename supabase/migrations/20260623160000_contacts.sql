-- Sendra's own address book (app-level contacts, not tied to a mailbox). Surfaced in
-- the Contacts screen and the composer "To" picker; managed by the address-book fn.
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_user_id_idx on public.contacts (user_id);
alter table public.contacts enable row level security;
create policy "own contacts" on public.contacts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
