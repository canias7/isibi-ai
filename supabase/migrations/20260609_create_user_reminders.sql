-- Per-user reminders: a title + a time, optionally repeating. RLS-scoped to the
-- owner (same shape as user_memory). Scheduled on-device as local notifications;
-- this table is the cross-device source of truth for the list.
create table if not exists public.user_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  remind_at timestamptz not null,
  repeat text not null default 'none' check (repeat in ('none','daily','weekly')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_reminders enable row level security;

create policy "reminders select own" on public.user_reminders
  for select using (auth.uid() = user_id);
create policy "reminders insert own" on public.user_reminders
  for insert with check (auth.uid() = user_id);
create policy "reminders update own" on public.user_reminders
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reminders delete own" on public.user_reminders
  for delete using (auth.uid() = user_id);

create index if not exists user_reminders_user_time_idx
  on public.user_reminders (user_id, remind_at);
