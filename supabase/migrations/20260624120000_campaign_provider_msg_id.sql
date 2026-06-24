-- Correlate provider (Resend) webhook events back to a specific recipient. Resend
-- returns a message id on send and echoes it on every webhook (delivered/bounced/
-- complained); we store it here and the resend-events function looks the recipient
-- up by it. SES uses message tags instead, so this column is only set for Resend sends.
alter table public.campaign_recipients
  add column if not exists provider_msg_id text;

create index if not exists campaign_recipients_provider_msg_idx
  on public.campaign_recipients (provider_msg_id)
  where provider_msg_id is not null;
