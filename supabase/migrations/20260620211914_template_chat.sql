-- Cached chat thread for the AI template builder (Lovable-style): the back-and-forth
-- that produced/edited the template, stored so reopening resumes the conversation.
alter table public.templates add column if not exists chat jsonb not null default '[]'::jsonb;
