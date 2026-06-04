# Security notes

Status of the items from the security/backend audit. Fixed items are noted for
history; open items below need attention before a wide public launch.

## Fixed
- **Per-user identity + auth.** Real login (Supabase Auth, email+password). The
  backend derives the user from the verified JWT; an anon key alone reaches no
  one's connected data.
- **No secrets in the repo.** The chat↔gmail-mcp bearer is derived at runtime
  from a server-only secret (`COMPOSIO_API_KEY`); the previously committed
  shared secret is rotated out (old value now returns 401).
- **Connect/status are authenticated.** `gmail-oauth` verifies the caller's
  Supabase token server-side (via GoTrue) instead of trusting a client-supplied
  user id.
- **CORS allowlist.** Edge functions only echo `Access-Control-Allow-Origin` for
  the app's own origins (Capacitor + localhost dev); unknown browser origins are
  blocked. Native requests (no `Origin`) still pass.
- **Reduced attack surface.** The unused legacy `ghost` function had its custom
  JWT/secret logic removed (now a harmless health stub). Stale `gmail_tokens`
  table dropped.

## Open — operational / process (not a code change)

### OTA bundle supply chain
`src/ota.ts` downloads a JS bundle from a public GitHub Release
(`web-latest`) and the native app runs it. Anyone who can publish to that
release can push code to **every install**. Mitigations (do in GitHub / Capgo,
not in code):
- Restrict who can push to the repo and create releases (branch protection,
  minimal collaborators, required reviews).
- Protect the `web-latest` tag/release.
- Consider Capgo's signed-bundle feature so the app rejects unsigned updates.

### Rate limiting / cost controls (audit #4 — still open)
The `chat` endpoint is reachable by anyone with the public anon key. It can no
longer touch user data, but unauthenticated/abusive calls still cost Anthropic +
Composio money. Add before heavy promotion:
- Per-user / per-IP request limits (e.g. a small Postgres counter or an edge
  rate-limit) and a max payload size on `chat`.
- A daily usage cap.

### Production OAuth (audit #9 — deferred)
Connectors currently use Composio's **managed** OAuth apps (great for
prototyping). For production scale/compliance, bring your own OAuth credentials
per provider (Google, Slack, etc.) in the Composio dashboard.

## Notes
- Email confirmation is ON (`mailer_autoconfirm=false`). For frictionless test
  signups, toggle it in Supabase → Authentication → Email. Built-in email is
  rate-limited; configure custom SMTP for real multi-user testing.
- The `ghost` function still exists (deprecated stub). Delete it from the
  Supabase dashboard when convenient — there's no delete API in the tooling.
