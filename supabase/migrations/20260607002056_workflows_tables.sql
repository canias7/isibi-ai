-- Workflows: user-defined automations (scheduled now; event-based later).
create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Workflow',
  instruction text not null,
  trigger_type text not null default 'schedule',   -- 'schedule' | 'event'
  schedule jsonb,                                   -- { freq, hour, minute, weekday, tz }
  event jsonb,                                      -- { app, from, query } (phase 3)
  enabled boolean not null default true,
  next_run_at timestamptz,                          -- scheduled: next due (UTC); null until initialized
  last_run_at timestamptz,
  cursor jsonb,                                     -- event: last-seen marker (phase 3)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.workflows enable row level security;
create policy "wf_select" on public.workflows for select using ((select auth.uid()) = user_id);
create policy "wf_insert" on public.workflows for insert with check ((select auth.uid()) = user_id);
create policy "wf_update" on public.workflows for update using ((select auth.uid()) = user_id);
create policy "wf_delete" on public.workflows for delete using ((select auth.uid()) = user_id);
create index if not exists workflows_due_idx on public.workflows (next_run_at) where enabled;
create index if not exists workflows_user_idx on public.workflows (user_id, created_at desc);

-- One row per execution (the "workflow chat" thread is its run history).
create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  result text,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.workflow_runs enable row level security;
create policy "wfr_select" on public.workflow_runs for select using ((select auth.uid()) = user_id);
-- inserts come from the runner (service role, bypasses RLS); users only read their own.
create index if not exists workflow_runs_idx on public.workflow_runs (workflow_id, created_at desc);
