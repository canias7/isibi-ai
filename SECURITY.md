# Security notes

Status of the items from the security/backend audit. Fixed items are noted for
history; the few open items below need attention before a wide public launch.

## Fixed
- **Per-user identity + auth.** Real login (Supabase Auth, email+password). The
  backend derives the user from the verified JWT; an anon key alone reaches no
  one's connected data. The `chat` function runs with `verify_jwt = true`.
- **No secrets in the repo.** The chat↔gmail-mcp bearer is derived at runtime
  from a server-only secret (`COMPOSIO_API_KEY`) by both functions, so they stay
  in sync with nothing stored. `gmail-mcp` enforces it: a bad/missing bearer
  returns `401 Unauthorized` (verified live). No `MCP_SHARED_SECRET` is needed.
- **Connect/status are authenticated.** `gmail-oauth` verifies the caller's
  Supabase token server-side (via GoTrue) instead of trusting a client-supplied
  user id. The OAuth `/start` link carries a short-lived (~5 min) HMAC one-time
  code instead of the user's session JWT.
- **CORS allowlist.** Edge functions only echo `Access-Control-Allow-Origin` for
  the app's own origins (Capacitor + localhost dev); unknown browser origins are
  blocked. Native requests (no `Origin`) still pass. Applies to `chat` and
  `send-push`.
- **Email iframe sandboxed.** Rendered email HTML runs under a strict CSP
  (`default-src 'none'`, `form-action 'none'`, `base-uri 'none'`) with no script
  or form execution.
- **OTA bucket write-locked.** The public `ota` Storage bucket is read-only to
  clients: `anon`/`authenticated` writes are denied (default-deny RLS, plus
  explicit `RESTRICTIVE` policies so a future loose policy can't re-open it).
  Only the CI service role can publish bundles. Public read still works
  (verified: anon upload → 403, manifest read → 200).
- **DB hardening.** `workflow_runs(user_id)` index added; `conversations` RLS
  policies use `(select auth.uid())` to avoid per-row re-evaluation. All user
  tables have own-row RLS.
- **Reduced attack surface.** The legacy `ghost` function plus 10 one-off
  debug/test functions were **deleted** (11 total); the stale `gmail_tokens`
  table was dropped. Production functions only: `chat`, `gmail-oauth`,
  `gmail-mcp`, `send-push`, `run-workflows`, `build-workflow`, `test-workflow`.
- **No raw errors to clients.** `chat`, `build-workflow`, `gmail-oauth`,
  `gmail-mcp`, and `run-workflows` log exceptions server-side and return a
  generic message instead of echoing raw exception / upstream-API text. (The
  `gmail-mcp` tool-call results keep detail — the agent needs it to self-correct
  — but now also log server-side.)
- **`main` branch protected.** A repository ruleset blocks force-pushes and
  deletions on `main`. Note: ruleset/branch protection blocks the GitHub App that
  this hosted environment pushes through, so once protection is on, commits to
  `main` must come from a local admin push (or a bypass actor added to the rule).

## Open

### 1. (Optional) Signed OTA bundles — defense-in-depth
The app applies OTA via `@capgo/capacitor-updater` from the locked `ota` bucket.
With the bucket write-locked, the remaining risk is a CI / service-key
compromise. Capgo end-to-end signing closes that: CI signs each bundle with a
private key; the app verifies against an embedded public key and rejects
unsigned/tampered bundles.

This needs a CI secret (the private key), which can't be set from the MCP
tooling, and the verification must be rolled out and tested on-device (a wrong
public key or missing signature can block all updates). When you're ready:
generate a keypair (`npx @capgo/cli key create`), add the private key as a
GitHub Actions secret, embed the public key in `capacitor.config.ts`, and have
the OTA workflow sign the bundle. Ask and I'll wire up the code + workflow in
one pass alongside the secret.

### 2. Rate limiting / cost controls (deferred by request)
`chat` is reachable by anyone with the public anon key. It can't touch user data
(JWT-gated), but unauthenticated/abusive calls still cost Anthropic + Composio
money. Before heavy promotion: per-user/per-IP request limits, a max payload
size on `chat`, and a daily usage cap.

### 3. Production OAuth (deferred)
Connectors use Composio's **managed** OAuth apps (great for prototyping). For
production scale/compliance, bring your own OAuth credentials per provider
(Google, Slack, etc.) in the Composio dashboard.

## Notes
- Email confirmation is currently **OFF** (auto-confirm) for frictionless test
  signup. Re-enable it (Supabase → Authentication → Email) and configure custom
  SMTP before a public launch. Built-in email is rate-limited.
