-- New workflows must default to OFF (the app turns them on via the toggle). The
-- old default of true could silently create a live automation on any insert that
-- omits `enabled`.
alter table public.workflows alter column enabled set default false;
