-- Remove the AI chat, Workflows, Memories, Reminders, and Voice/Call features.
-- Drops their per-user tables, unschedules their cron jobs, and removes the memory
-- toggle column from the kept user_settings table.
--
-- NOTE: the wf_cron_secret Vault secret + its RPC are intentionally LEFT in place —
-- the kept ops-monitor cron still authenticates with them.

-- Unschedule the feature cron jobs (run-workflows + the chat tool-table prunes).
do $$ begin perform cron.unschedule('run-workflows'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('prune-tool-data-stash'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('prune-tool-usage'); exception when others then null; end $$;

-- Drop the removed-feature tables.
-- NOTE: tool_prefs is intentionally KEPT — it's the connectors per-toolkit
-- enabled-tools cache (gmail-oauth getPrefs/setPrefs), not a chat table.
drop table if exists public.conversations cascade;        -- chat thread sync
drop table if exists public.user_memory cascade;          -- memories
drop table if exists public.tool_usage cascade;           -- chat tool-call log
drop table if exists public.tool_data_stash cascade;      -- chat tool-result stash
drop table if exists public.tool_data_stash_raw cascade;  -- (stash variant, if present)
drop table if exists public.user_reminders cascade;       -- reminders
drop table if exists public.workflows cascade;            -- workflows
drop table if exists public.workflow_runs cascade;        -- workflows
drop table if exists public.device_tokens cascade;        -- push tokens (reminders)

-- The memory toggle lived on the kept user_settings table — drop just the column.
alter table public.user_settings drop column if exists memory_on;
