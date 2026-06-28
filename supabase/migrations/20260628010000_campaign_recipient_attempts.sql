-- Durable send retry: count delivery attempts per recipient so a transient relay
-- failure (the box briefly down / 5xx / network) requeues the recipient instead of
-- burning it as failed. The campaigns fn retries up to a cap, then marks it failed.
alter table public.campaign_recipients add column if not exists attempts integer not null default 0;
