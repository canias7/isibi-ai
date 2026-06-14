# Outlook email via direct Microsoft Graph (not Composio)

**Why:** Composio's Outlook toolkit cannot do email. Every message tool —
send / read / search / reply / forward (71 slugs) — returns `404 Tool not found`
on execute. Only calendar, folders, rules, attachments, mailbox-settings and
`GET_MAIL_DELTA` work. So Outlook email must be served by a **direct Microsoft
Graph integration**, swapped in via the toolmap seam (no model retrain needed —
the model already emits the same email intents it uses for Gmail).

Gmail is unaffected (all 6 Composio tools work).

## What stays on Composio vs. goes direct
| Capability | Provider |
|---|---|
| Outlook **email** (read/send/reply/draft/search) | **direct MS Graph** (new) |
| Outlook calendar / folders / rules / attachments | Composio (already working, in catalog) |
| Gmail (everything) | Composio (unchanged) |

## 1. Azure app registration — **owner action** (portal.azure.com → Entra ID → App registrations)
1. **New registration** → name e.g. "Go Farther Outlook". Supported account types:
   *Accounts in any org directory and personal Microsoft accounts* (multi-tenant + personal).
2. **Redirect URI** (Web): your connect callback, e.g.
   `https://<supabase-project>.functions.supabase.co/gmail-oauth/callback`
   (reuse the existing OAuth callback the Gmail flow already uses).
3. **Certificates & secrets** → New client secret → copy the **Value** (once).
4. **API permissions** → Microsoft Graph → Delegated → add:
   `Mail.Read`, `Mail.Send`, `Mail.ReadWrite`, `offline_access`, `User.Read`
   (add `Calendars.ReadWrite` only if you want to drop Composio for calendar too).
   Grant admin consent if your tenant requires it.
5. Note the **Application (client) ID** and **Directory (tenant) ID** (use
   `common` as the tenant in the auth URL for multi-tenant + personal accounts).

Then add to Supabase secrets (Edge Function env):
```
MS_GRAPH_CLIENT_ID=<application client id>
MS_GRAPH_CLIENT_SECRET=<client secret value>
```

## 2. Backend — **local Claude** (owns the deployed functions)
Add an Outlook-email provider behind the same tool names the model already emits.
Cleanest: a small `graph-outlook` module the MCP server calls when the tool's
toolkit is Outlook-email (routed via the toolmap), instead of Composio execute.

OAuth (delegated, auth-code + PKCE):
- Authorize: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
- Token: `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- Scopes: the delegated set above. Store refresh token per user (same table as
  the Composio connections — outlook becomes a "direct" connection kind).

Graph endpoints to back each tool (delegated, `/me`):
| Tool (model-facing) | Graph call |
|---|---|
| `OUTLOOK_FETCH_EMAILS` | `GET /me/messages?$search=...&$top=...&$select=...` |
| `OUTLOOK_GET_MESSAGE` | `GET /me/messages/{id}` |
| `OUTLOOK_SEND_EMAIL` | `POST /me/sendMail` |
| `OUTLOOK_CREATE_DRAFT` | `POST /me/messages` |
| `OUTLOOK_REPLY_TO_THREAD` | `POST /me/messages/{id}/reply` |
| `OUTLOOK_LIST_DRAFTS` | `GET /me/mailFolders/drafts/messages` |

(Names intentionally mirror the Gmail set so the builder/runner reuse the same
email intents — that's why no retrain is needed.)

## 3. Catalog / toolmap — this branch (do once backend is agreed)
- Re-add the 6 Outlook **email** tools above to `catalog.py` ALLOWED for `outlook`
  (alongside the working Composio calendar/folder tools), and **exempt them from
  the broken-tool filter** (they 404 on Composio by design — they're served
  direct). Mechanism: keep them out of `broken_tools.json` and add an
  `OUTLOOK_DIRECT = {...}` allowlist `_drop_broken` skips.
- Add a `toolmap.json` entry marking those 6 as provider `graph` (not `composio`)
  so the MCP server routes them to `graph-outlook`.
- Regenerate `build_workflow_artifacts.py` + `backend_connector_additions.json`.

## 4. Validate
Connect one Outlook account through the new flow; confirm read + send in chat.
Then Outlook is a true peer to Gmail.

---
*Until this ships, Outlook in the catalog is calendar/folders/rules only — it
cannot send or read email. `backend_connector_additions.json` reflects that.*
