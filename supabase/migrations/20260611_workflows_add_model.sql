-- Per-workflow model choice (the workflow editor's model picker). NULL = the
-- default tier (Sonnet); 'haiku' | 'sonnet' | 'opus' run that workflow on the
-- chosen tier. The runner and the Test path map this to the actual model id;
-- the cheap event-detector pass stays on Haiku regardless.
alter table public.workflows add column if not exists model text;
