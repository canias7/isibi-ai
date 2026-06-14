-- Replace any existing job, then schedule the runner every 5 minutes.
do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname = 'run-workflows' loop
    perform cron.unschedule(j);
  end loop;
end $$;

select cron.schedule('run-workflows', '*/5 * * * *', $cmd$
  select net.http_post(
    url := 'https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/run-workflows',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'wf_cron_secret')
    ),
    body := '{}'::jsonb
  );
$cmd$);
