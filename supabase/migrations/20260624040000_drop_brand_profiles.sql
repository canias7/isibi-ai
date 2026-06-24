-- Remove the unused brand-profile feature: it had no UI to ever populate it (0 rows),
-- and the AI-designer wiring that read it has been deleted from the templates function.
drop table if exists public.brand_profiles;
