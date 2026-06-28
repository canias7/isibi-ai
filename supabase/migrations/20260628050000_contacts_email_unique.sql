-- Contacts: an email is required and unique per user (case-insensitive).
-- Enforced in the address-book Edge Function; this adds a DB-level partial unique
-- index as the race-proof backstop. Existing rows that share an email (per user,
-- case-insensitive) are collapsed FIRST — keeping the most complete, then most
-- recently updated row — so the unique index can be created. Rows with no email
-- (legacy name-only contacts) are left untouched (partial index ignores them).

with ranked as (
  select id,
         row_number() over (
           partition by user_id, lower(email)
           order by ((name <> '')::int
                     + (phone is not null and phone <> '')::int
                     + (coalesce(array_length(tags, 1), 0) > 0)::int) desc,
                    updated_at desc, created_at desc, id desc
         ) as rn
    from public.contacts
   where email is not null and email <> ''
)
delete from public.contacts c
 using ranked r
 where c.id = r.id and r.rn > 1;

create unique index if not exists contacts_user_email_uniq
    on public.contacts (user_id, lower(email))
 where email is not null and email <> '';
