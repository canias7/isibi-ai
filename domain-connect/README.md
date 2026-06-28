# Domain Connect template (one-click domain setup)

`gofarther.dev.email.json` is our [Domain Connect](https://www.domainconnect.org/) template.
It's what makes the in-app **"Auto-configure (one-click)"** work: when a user's domain is on a
Domain Connect host (Cloudflare, GoDaddy, IONOS, Plesk, 123-reg, …), the host reads this
template and writes the records after a one-time "Authorize" click — no copy-paste.

> **History:** this template (providerId `gofarther.dev`, serviceId `email`) was first accepted
> upstream with the **Amazon SES** records (3 Easy-DKIM CNAMEs). We've since moved to the
> **self-hosted** sender, so it's now **version 2** with the self-hosted records below. We keep
> the same `email` slot (already merged + synced by providers) rather than start a new one — a
> version bump re-syncs hosts automatically. (We also dropped `syncPubKeyDomain`: the in-app
> flow is the interactive *synchronous* one, where the user authorizes in their browser, so
> request signing isn't needed.)

The records it applies (per domain):
- **DKIM** — `TXT s1._domainkey  v=DKIM1; k=rsa; p=%dkimp%` (the key is passed in as the `%dkimp%` variable)
- **SPF**  — `SPFM @  include:_spf.gofarther.dev` (SPFM merges into any existing SPF)
- **DMARC**— `TXT _dmarc  v=DMARC1; p=none; rua=mailto:dmarc@gofarther.dev`

It stays gated in the app (`DOMAIN_CONNECT.live = false` in `src/domainConnect.ts`) until the v2
update is merged upstream **and** the production box is live. Until then, discovery still runs and
the app falls back to the manual records.

## How to ship the v2 update (the external, one-time step)

1. **Test in the Online Editor** (required — PRs without a test link aren't reviewed): open
   https://domainconnect.paulonet.eu/dc/free/templateedit, paste the JSON, fix any syntax
   flags, and test apply against **both an apex domain and a subdomain**. Copy the result link.
2. **Open a PR** to **https://github.com/Domain-Connect/Templates** that **updates the existing
   `gofarther.dev.email.json`** at the repo root (replace the SES records with these; `version`
   is bumped to 2). Paste the Online Editor link in the PR body. Optional: run
   https://github.com/Domain-Connect/dc-template-linter first.
3. **After merge**, providers re-sync on their own schedule (days–weeks each). Flip
   `DOMAIN_CONNECT.live = true` and the button "lights up" per host as they pick up v2.
4. Coverage is Domain-Connect hosts only (Cloudflare, GoDaddy, IONOS, 123-reg, one.com, …).
   Namecheap, Squarespace/Google, Porkbun, etc. fall back to the manual records flow.

## How the app uses it

When the user taps **Auto-configure (one-click)** (`src/domainConnect.ts`):
1. Discovers the domain's Domain Connect host — TXT lookup of `_domainconnect.<domain>`,
   then `GET https://<host>/v2/<domain>/settings` for `urlSyncUX`.
2. Opens the apply URL with the domain's DKIM key:
   `<urlSyncUX>/v2/domainTemplates/providers/gofarther.dev/services/email/apply?domain=<domain>&dkimp=<key>&redirect_uri=<return>`
3. The user authorizes at their host; the Domains screen auto-rechecks and flips to **Verified**.

> Until a provider has synced v2, the apply URL there still serves the old (SES) records — so the
> app keeps `live = false` until you've confirmed the update propagated, and falls back to manual.
