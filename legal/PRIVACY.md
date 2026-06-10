# Go Farther — Privacy Policy

> **DRAFT** — review with counsel before launch. Set the effective date and
> support address, then host this at a public URL (App Store review requires one).

**Effective date:** _TBD_
**Contact:** _support email TBD_

Go Farther is a personal AI assistant that can, with your permission, work with
your email, calendar, files, and bank data. Because of what it touches, we keep
this policy plain and short.

## What we collect

- **Account**: your email address, used to sign you in (one-time codes — no passwords).
- **Conversations**: your chats with the assistant, stored so your history syncs
  across launches. You can delete any chat, or everything at once.
- **Memories**: facts and files you explicitly ask the assistant to remember.
- **Connected app access**: when you connect an app (Gmail, Outlook, Excel, etc.),
  OAuth tokens are issued and held by our integration provider (Composio). We
  store only *which* apps you've connected — never your passwords.
- **Bank data**: if you link a bank, access is **read-only** through Plaid. The
  assistant can see balances and transactions; it can never move money. Bank
  access tokens are stored encrypted (AES-256).
- **Generated files**: spreadsheets, images, and documents the assistant creates
  for you, stored privately so you can download them.
- **Usage telemetry**: counts of events ("message sent", "app opened") and
  per-request token usage for cost monitoring. Telemetry never includes the
  content of your messages, emails, or bank data, and is deleted after 90 days.

## How your data is used

To provide the product — and for nothing else. When you send a message, its
content (plus the data a tool fetches, like an email you asked about) is
processed by our AI provider to produce the reply. We don't sell your data, we
don't show ads, and we don't use your content to train AI models. Our API
agreements with AI providers exclude training on your data.

## Who processes it

- **Supabase** — hosting, database, file storage, authentication (US region).
- **Anthropic** — the AI model that powers the assistant.
- **OpenAI** — voice transcription (Whisper) and image generation.
- **Composio** — managed OAuth and API access to the apps you connect.
- **Plaid** — read-only bank connections.
- **Resend** — transactional email (sign-in codes).
- **Google Maps** — place search and directions, when you use them.

Each receives only what's needed for its job.

## Retention

- Chats, memories, and generated files: until you delete them or your account.
- Temporary tool data (e.g. fetched bank rows staged for an export): **2 hours**.
- Usage/telemetry logs: **90 days**.

## Deleting your data

Settings → Delete Account permanently removes everything: your conversations,
memories and their attachments, generated files, connected-app authorizations
(revoked at the provider), bank links, telemetry, and the account itself. This
is immediate and irreversible.

## Security

All traffic is encrypted in transit (TLS). Bank tokens are encrypted at rest.
Database access is deny-by-default (row-level security); your data is only ever
read in the context of your own authenticated requests. The assistant can only
use tools you've enabled, and always confirms before sending or changing
anything on your behalf.

## Children

Go Farther is not directed at children under 13, and we don't knowingly collect
their data.

## Changes

If this policy changes materially, we'll note it in the app before the change
takes effect.
