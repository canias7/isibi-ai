-- Fixed-window rate limiting shared by the edge functions (chat, transcribe).
-- One row per key (e.g. "chat:u:<uid>" or "chat:ip:<ip>"); the RPC atomically
-- bumps the counter, resetting it when the window rolled over, and returns
-- whether the caller is still within the limit. Service-role only.
create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);
alter table public.rate_limits enable row level security;

create or replace function public.gf_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare ok boolean;
begin
  insert into rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                 then 1 else r.count + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                        then now() else r.window_start end
  returning r.count <= p_limit into ok;
  return ok;
end;
$fn$;
revoke execute on function public.gf_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.gf_rate_limit(text, integer, integer) to service_role;

-- Cost ceiling on workflows: each one is recurring model spend, so cap how many
-- a single account can hold. A trigger (not app code) so EVERY write path is
-- covered, including direct PostgREST inserts from the client.
create or replace function public.enforce_workflow_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if (select count(*) from workflows where user_id = new.user_id) >= 20 then
    raise exception 'Workflow limit reached (20 per account) — delete one to add another.';
  end if;
  return new;
end;
$fn$;
drop trigger if exists workflows_cap on public.workflows;
create trigger workflows_cap before insert on public.workflows
  for each row execute function public.enforce_workflow_cap();

-- Limiter rows are useless once their window has long passed; sweep weekly.
select cron.schedule(
  'prune-rate-limits',
  '40 4 * * 1',
  $$delete from public.rate_limits where window_start < now() - interval '7 days'$$
);
