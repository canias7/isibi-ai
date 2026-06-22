-- Footer address for AI-designed newsletters (CAN-SPAM friendly + completes the
-- Brevo-style footer).
alter table public.brand_profiles add column if not exists address text not null default '';
