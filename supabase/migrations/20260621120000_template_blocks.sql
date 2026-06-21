-- Block-builder structure for templates (Brevo-style rows/columns). Stored as JSON
-- so reopening a template drops back into the visual builder; the compiled HTML
-- lives in `body` as today (what campaigns actually send).
alter table public.templates add column if not exists blocks jsonb not null default '[]'::jsonb;
