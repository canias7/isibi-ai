-- Owner-tunable config read by client + server. Public read so the app can draw
-- the daily-limit bar; writes are service-role only (no client policy).
create table if not exists public.app_config (
  key text primary key,
  num_value numeric,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select using (true);
insert into public.app_config(key, num_value) values ('daily_limit_usd', 1.50)
  on conflict (key) do nothing;

-- Estimated USD a user has spent since a timestamp (token counts × list prices;
-- cache writes 2× input, reads 10%). NOT security-definer: service-role calls
-- (the edge functions) see all rows for enforcement; an authenticated client is
-- scoped by ai_usage RLS to its own rows, so it can only read its own spend.
create or replace function public.user_spend_usd(p_user uuid, p_since timestamptz)
returns numeric
language sql
stable
as $$
  select coalesce(sum(
    case
      when model ilike '%opus%'  then (in_tokens*5.0  + cache_write_tokens*10.0 + cache_read_tokens*0.5 + out_tokens*25.0)/1000000.0
      when model ilike '%haiku%' then (in_tokens*1.0  + cache_write_tokens*2.0  + cache_read_tokens*0.1 + out_tokens*5.0)/1000000.0
      else                            (in_tokens*3.0  + cache_write_tokens*6.0  + cache_read_tokens*0.3 + out_tokens*15.0)/1000000.0
    end
  ), 0)::numeric
  from public.ai_usage
  where user_id = p_user and created_at >= p_since;
$$;
