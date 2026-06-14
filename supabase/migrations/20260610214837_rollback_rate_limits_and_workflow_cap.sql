-- Roll back the rate-limiter + workflow-cap experiment in full (deferred until
-- launch by the owner). Nothing references these objects.
select cron.unschedule('prune-rate-limits');
drop trigger if exists workflows_cap on public.workflows;
drop function if exists public.enforce_workflow_cap();
drop function if exists public.gf_rate_limit(text, integer, integer);
drop table if exists public.rate_limits;
