-- Inbound replies to campaigns (Sendra reply handling, staged behind reply_enabled).
-- Populated by the ses-inbound function from SES receipt-rule SNS notifications.
create table if not exists public.replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  recipient_id uuid references public.campaign_recipients(id) on delete set null,
  recipient_email text,            -- the address we originally emailed (the person replying)
  from_email text,                 -- header From of the reply
  from_name text,
  subject text,
  snippet text,                    -- first chunk of the text body (list preview)
  body_text text,
  message_id text,                 -- reply's Message-ID
  in_reply_to text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists replies_user_idx on public.replies (user_id, created_at desc);
create index if not exists replies_campaign_idx on public.replies (campaign_id);

alter table public.replies enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='replies' and policyname='replies_owner_select') then
    create policy replies_owner_select on public.replies for select using (auth.uid() = user_id);
  end if;
end $$;

-- Per-domain opt-in for receiving replies (off until the user enables it + points MX).
alter table public.sending_domains add column if not exists reply_enabled boolean not null default false;
