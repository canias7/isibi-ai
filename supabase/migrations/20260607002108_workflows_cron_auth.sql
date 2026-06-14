create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Random shared secret the cron uses to authenticate to run-workflows. Stored in
-- Vault (never in the repo); the runner reads it back via the RPC below.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'wf_cron_secret') then
    perform vault.create_secret(gen_random_uuid()::text, 'wf_cron_secret', 'run-workflows cron auth');
  end if;
end $$;

create or replace function public.wf_cron_secret() returns text
  language sql security definer set search_path = ''
  as $$ select decrypted_secret from vault.decrypted_secrets where name = 'wf_cron_secret' $$;
revoke all on function public.wf_cron_secret() from public, anon, authenticated;
grant execute on function public.wf_cron_secret() to service_role;
