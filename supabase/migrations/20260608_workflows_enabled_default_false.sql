-- New workflows must default to OFF (the app turns them on via the editor's
-- toggle). The previous default of true could silently create a live automation
-- on any insert that omits `enabled`. Applied to the live DB on 2026-06-08.
alter table public.workflows alter column enabled set default false;
