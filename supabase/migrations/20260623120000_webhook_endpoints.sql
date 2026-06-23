-- Outbound webhooks: per-user HTTPS endpoints that Sendra POSTs signed email events
-- to (delivered/bounced/complained/...). Managed by the `webhooks` edge function;
-- delivered by `ses-events`. Rows are service-role only in practice; RLS is
-- defense-in-depth for any direct client access.
create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  secret text not null,
  events text[] not null default '{}',
  enabled boolean not null default true,
  description text,
  last_status integer,
  last_event_at timestamptz,
  failure_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists webhook_endpoints_user_id_idx on public.webhook_endpoints (user_id);

alter table public.webhook_endpoints enable row level security;

create policy "own webhook endpoints" on public.webhook_endpoints
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
