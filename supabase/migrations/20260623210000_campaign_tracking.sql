-- Campaign open/click tracking. Sendra's own pixel + link-redirect (the `track`
-- edge function), so it works for mailbox sends too — independent of SES. The
-- `campaigns` fn embeds the pixel/links and reads these aggregates for the stats view.

alter table public.campaign_recipients
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at    timestamptz,
  add column if not exists clicked_at   timestamptz,
  add column if not exists open_count   integer not null default 0,
  add column if not exists click_count  integer not null default 0;

create index if not exists campaign_recipients_campaign_idx
  on public.campaign_recipients (campaign_id);

-- Atomic "stamp first open / bump counter", called by the `track` fn (service role).
create or replace function public.campaign_track_open(p_recipient uuid, p_campaign uuid)
returns void language sql as $$
  update public.campaign_recipients
     set open_count = open_count + 1,
         opened_at  = coalesce(opened_at, now())
   where id = p_recipient and campaign_id = p_campaign;
$$;

-- A click implies an open (recipient rendered the mail), so stamp both — this also
-- catches "clicked but images blocked" opens that the pixel alone would miss.
create or replace function public.campaign_track_click(p_recipient uuid, p_campaign uuid)
returns void language sql as $$
  update public.campaign_recipients
     set click_count = click_count + 1,
         clicked_at   = coalesce(clicked_at, now()),
         opened_at    = coalesce(opened_at, now())
   where id = p_recipient and campaign_id = p_campaign;
$$;
