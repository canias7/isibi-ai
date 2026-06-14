-- Stale from the pre-Composio custom Google OAuth (now replaced). Held a live
-- Google refresh token that nothing references anymore. Drop it.
drop table if exists public.gmail_tokens;
