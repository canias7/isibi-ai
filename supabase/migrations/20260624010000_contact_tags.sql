-- Tags on contacts → segments. A contact can carry labels ("vip", "newsletter");
-- campaigns can target a tag. Managed by the address-book fn; owner-only via existing RLS.
alter table public.contacts add column if not exists tags text[] not null default '{}';
create index if not exists contacts_tags_idx on public.contacts using gin (tags);
