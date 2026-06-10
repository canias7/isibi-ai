-- Telemetry + ops layer: cost tracking, product analytics, kill switches, and
-- the monitor's alert log. All service-role-only (RLS on, no policies) except
-- app_events, which signed-in users may INSERT (their own rows only) so the
-- client can log feature usage without an edge function in the path.

-- One row per AI call (chat turn, workflow run, trigger check, transcription).
-- The ops monitor sums this into a daily spend estimate.
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  source text not null,
  model text,
  in_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  out_tokens integer not null default 0,
  bytes bigint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.ai_usage enable row level security;
create index if not exists ai_usage_created_at_idx on public.ai_usage (created_at);

-- Kill switches: a missing row means enabled; functions read these fail-open so
-- a flags outage can never take the product down with it.
create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default true,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.feature_flags enable row level security;
insert into public.feature_flags (key, enabled, note) values
  ('chat', true, 'Master switch: the whole assistant.'),
  ('voice', true, 'Voice transcription (composer mic + call mode).'),
  ('workflows', true, 'The background workflow runner (scheduled + event).')
on conflict (key) do nothing;

-- Product analytics: counts of WHAT happened, never content. Clients insert
-- their own rows directly (RLS-checked); only the service role can read.
create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  event text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.app_events enable row level security;
create policy app_events_insert_own on public.app_events
  for insert to authenticated
  with check (user_id = (select auth.uid()) and char_length(event) <= 64);
create index if not exists app_events_created_at_idx on public.app_events (created_at);

-- The monitor's alert log (one row per alert actually raised).
create table if not exists public.ops_alerts (
  id bigint generated always as identity primary key,
  key text not null,
  message text not null,
  emailed boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.ops_alerts enable row level security;
create index if not exists ops_alerts_key_created_idx on public.ops_alerts (key, created_at desc);

-- Keep telemetry bounded: one daily sweep for all three tables.
select cron.schedule(
  'prune-telemetry',
  '50 3 * * *',
  $$delete from public.ai_usage where created_at < now() - interval '90 days';
    delete from public.app_events where created_at < now() - interval '90 days';
    delete from public.ops_alerts where created_at < now() - interval '90 days'$$
);

-- Wake the ops monitor every 15 minutes (same Vault secret as the workflow runner).
select cron.schedule(
  'ops-monitor',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/ops-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'wf_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
