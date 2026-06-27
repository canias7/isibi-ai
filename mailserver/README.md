# `mailserver/` — the box side of the multi-tenant sender

This runs on the production sending box (`mail.gofarther.dev`) and pairs with the
`mailer` edge function. The app owns onboarding (domains, DKIM keys, verification);
this owns **signing + delivery**.

| File | What it is |
|---|---|
| `relay.ts` | HTTPS JSON API (`POST /send`) the edge function calls; builds MIME → Postfix → OpenDKIM signs. Auth: `RELAY_TOKEN`. |
| `keysync.ts` | Timer job: pulls verified domains' DKIM keys from `mailer` `keysync_export` → writes OpenDKIM tables → reloads. |
| `systemd/` | `gofarther-relay.service`, `gofarther-keysync.service` + `.timer`. |
| `Caddyfile` | Auto-TLS reverse proxy for `relay.gofarther.dev` → the relay on localhost. |
| `mailer.env.example` | Config for both services (copy to `/etc/gofarther/mailer.env`). |
| `install.sh` | Idempotent installer (Deno, user, services, OpenDKIM tables, Postfix milter, Caddy). |
| **`PRODUCTION-SETUP.md`** | **Start here** — the full step-by-step to go live. |

**Security:** customer private keys live in a service-role-only DB table and leave only
via the token-gated `keysync_export`, straight onto this box. The browser never sees them.
The `RELAY_TOKEN` must match the edge function's `MAILER_RELAY_TOKEN` and only travels over
Caddy's HTTPS.
