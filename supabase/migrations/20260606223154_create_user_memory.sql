
create table if not exists public.user_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_memory enable row level security;
create policy "user_memory_select_own" on public.user_memory for select using ((select auth.uid()) = user_id);
create policy "user_memory_insert_own" on public.user_memory for insert with check ((select auth.uid()) = user_id);
create policy "user_memory_update_own" on public.user_memory for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_memory_delete_own" on public.user_memory for delete using ((select auth.uid()) = user_id);
create index if not exists user_memory_user_idx on public.user_memory (user_id, created_at desc);
