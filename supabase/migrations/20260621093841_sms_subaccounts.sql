-- SMS moves to the platform-provisioned (ISV/subaccount) model: ONE master Twilio
-- account provisions a number per user in-app. We reuse sms_connections, where now
-- account_sid/auth_token hold the user's Twilio SUBACCOUNT creds and from_number is
-- the number bought for them. phone_sid lets us release it; status tracks lifecycle
-- (active, later: 10dlc_pending / 10dlc_registered). Still RLS-on, service-role only.

alter table public.sms_connections add column if not exists phone_sid text;
alter table public.sms_connections add column if not exists status text not null default 'active';
