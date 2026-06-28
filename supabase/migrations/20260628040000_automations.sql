-- Automations: drip sequences. An automation has an ordered `steps` list
-- ([{delay_days, subject, body}]); the automations fn's 5-min runner enrolls
-- contacts carrying the trigger tag and advances each enrollment over time.
create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled automation',
  trigger_tag text not null,
  send_via text not null default 'mailbox',   -- mailbox | self
  app text not null default 'gmail',
  from_email text,
  from_name text,
  steps jsonb not null default '[]'::jsonb,    -- [{delay_days:int, subject:text, body:html}]
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.automations enable row level security;
create policy automations_own on public.automations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create index if not exists automations_user_idx on public.automations (user_id);
create index if not exists automations_enabled_idx on public.automations (enabled) where enabled;

create table if not exists public.automation_enrollments (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  user_id uuid not null,
  email text not null,
  name text,
  step integer not null default 0,            -- index of the NEXT step to send
  status text not null default 'active',      -- active | done | stopped
  next_run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (automation_id, email)
);
alter table public.automation_enrollments enable row level security;   -- service-role only
create index if not exists autoenroll_due_idx on public.automation_enrollments (status, next_run_at);
create index if not exists autoenroll_automation_idx on public.automation_enrollments (automation_id);

-- Runner: every 5 minutes, ask the automations fn to reconcile + advance.
select cron.schedule('automations-run-due', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/automations',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'wf_cron_secret')),
    body := '{"action":"run_due"}'::jsonb
  );
$$);
