-- Single-flight lock for the scheduled-send drainer: a campaign being drained sets
-- locked_until; overlapping cron ticks / client sends skip a locked campaign. Auto-expires.
alter table public.campaigns add column if not exists locked_until timestamptz;
