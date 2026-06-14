-- Per-user settings (server-side source of truth). memory_on lets the pause
-- toggle apply everywhere, including background workflow runs.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  memory_on boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "us_select" on public.user_settings for select using ((select auth.uid()) = user_id);
create policy "us_insert" on public.user_settings for insert with check ((select auth.uid()) = user_id);
create policy "us_update" on public.user_settings for update using ((select auth.uid()) = user_id);
