-- Background jobs for the AI template builder. The `templates` fn inserts a job,
-- returns its id immediately, and finishes the generation in a background task
-- (EdgeRuntime.waitUntil) — so it keeps running even if the app is backgrounded or
-- the connection drops. The app polls the row until status is done/error.
create table if not exists public.template_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'running',  -- running | done | error
  subject text,
  body text,
  reply text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists template_jobs_user_idx on public.template_jobs (user_id, created_at desc);
alter table public.template_jobs enable row level security;
-- Read-only to the owner; the function writes via the service role.
create policy "own template jobs" on public.template_jobs
  for select to authenticated using (auth.uid() = user_id);
