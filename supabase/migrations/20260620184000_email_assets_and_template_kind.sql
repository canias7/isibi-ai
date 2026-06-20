-- Public bucket for images used inside emails (logo, photos, flyers). Uploaded by
-- the service-role `templates` function; publicly readable so they render in any
-- mail client. Mirrors the existing `ota` bucket pattern.
insert into storage.buckets (id, name, public, file_size_limit)
values ('email-assets', 'email-assets', true, 10485760)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- A template's body can be plain text ('text' — wrapped to HTML on send) or ready
-- HTML ('html' — flyer image, pasted design, or AI-designed layout).
alter table public.templates add column if not exists kind text not null default 'text';
