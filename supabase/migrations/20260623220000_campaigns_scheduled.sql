-- Scheduled campaigns. A future `scheduled_at` parks a campaign as status='scheduled';
-- a pg_cron job (every minute) posts { action: "run_due" } to the `campaigns` fn, which
-- drains due campaigns. Mirrors the run-workflows cron pattern (Vault secret for auth).

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.campaigns add column if not exists scheduled_at timestamptz;
create index if not exists campaigns_scheduled_idx on public.campaigns (scheduled_at) where scheduled_at is not null;

-- Random shared secret the cron presents to the function. Stored in Vault (never the
-- repo); the function reads it back via the security-definer RPC below.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'campaigns_cron_secret') then
    perform vault.create_secret(gen_random_uuid()::text, 'campaigns_cron_secret', 'run-due-campaigns cron auth');
  end if;
end $$;

create or replace function public.campaigns_cron_secret() returns text
  language sql security definer set search_path = ''
  as $$ select decrypted_secret from vault.decrypted_secrets where name = 'campaigns_cron_secret' $$;
revoke all on function public.campaigns_cron_secret() from public, anon, authenticated;
grant execute on function public.campaigns_cron_secret() to service_role;

-- Replace any existing job, then schedule the runner every minute.
do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname = 'run-due-campaigns' loop
    perform cron.unschedule(j);
  end loop;
end $$;

select cron.schedule('run-due-campaigns', '* * * * *', $cmd$
  select net.http_post(
    url := 'https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/campaigns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'campaigns_cron_secret')
    ),
    body := '{"action":"run_due"}'::jsonb
  );
$cmd$);
