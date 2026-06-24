-- SES and SES-based reply handling removed — everything sends through Resend (built-in)
-- or the user's mailbox now. Drop the SES-only tables.
drop table if exists public.replies cascade;
drop table if exists public.senders cascade;
drop table if exists public.sending_domains cascade;
