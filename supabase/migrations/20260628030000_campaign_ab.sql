-- A/B testing for campaigns: an optional variant B (subject and/or body), and a
-- per-recipient variant tag so the list is split ~50/50 and stats can compare them.
alter table public.campaigns add column if not exists subject_b text;
alter table public.campaigns add column if not exists body_b text;
alter table public.campaign_recipients add column if not exists variant text;  -- 'A' | 'B' | null
