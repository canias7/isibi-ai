-- Stale from the pre-Composio custom Google OAuth (now replaced by Composio's
-- managed OAuth). The table held a live Google refresh token that nothing
-- references anymore — drop it to avoid storing dead credentials.
drop table if exists public.gmail_tokens;
