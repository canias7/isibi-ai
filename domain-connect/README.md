# Domain Connect template (one-click domain setup)

`gofarther.dev.sender.json` is our [Domain Connect](https://www.domainconnect.org/)
template for the **self-hosted sender** (the `mailer` function + `mailserver/`). It's what
makes the in-app **"Auto-configure (one-click)"** work: when a user's domain is on a Domain
Connect host (Cloudflare, GoDaddy, IONOS, Plesk, 123-reg, …), the host reads this template
and writes the records after a one-time "Authorize" click — no copy-paste.

The records it applies (per domain):
- **DKIM** — `TXT s1._domainkey  v=DKIM1; k=rsa; p=%dkimp%` (the key is passed in as the `%dkimp%` variable)
- **SPF**  — `SPFM @  include:_spf.gofarther.dev` (SPFM merges into any existing SPF)
- **DMARC**— `TXT _dmarc  v=DMARC1; p=none; rua=mailto:dmarc@gofarther.dev`

It stays gated in the app (`DOMAIN_CONNECT.live = false` in `src/domainConnect.ts`) until
it's merged upstream **and** the production box is live — see `mailserver/PRODUCTION-SETUP.md`.
Until then, discovery still runs and the app falls back to the manual records.

## How it gets live (the external, one-time step)

1. **Prereqs on `gofarther.dev`:** the domain resolves and serves a landing page + logo
   (reviewers and the host UI show these). The return URL `https://gofarther.dev/` is already
   in `syncRedirectDomain`.
2. **Test in the Online Editor** (required — PRs without a test link aren't reviewed): open
   https://domainconnect.paulonet.eu/dc/free/templateedit, paste the JSON, fix any syntax
   flags, and test apply against **both an apex domain and a subdomain**. Copy the result link.
3. **File the PR** to **https://github.com/Domain-Connect/Templates**: add
   `gofarther.dev.sender.json` at the repo root (filename is `providerId.serviceId.json` —
   ours matches), paste the Online Editor link in the PR body. Optional: run
   https://github.com/Domain-Connect/dc-template-linter first.
4. **After merge**, providers sync templates on their own schedule (days–weeks each). Flip
   `DOMAIN_CONNECT.live = true` and the button "lights up" per host as they pick it up.
5. Coverage is Domain-Connect hosts only (Cloudflare, GoDaddy, IONOS, 123-reg, one.com, …).
   Namecheap, Squarespace/Google, Porkbun, etc. fall back to the manual records flow.

## How the app uses it

When the user taps **Auto-configure (one-click)** (`src/domainConnect.ts`):
1. Discovers the domain's Domain Connect host — TXT lookup of `_domainconnect.<domain>`,
   then `GET https://<host>/v2/<domain>/settings` for `urlSyncUX`.
2. Opens the apply URL with the domain's DKIM key:
   `<urlSyncUX>/v2/domainTemplates/providers/gofarther.dev/services/sender/apply?domain=<domain>&dkimp=<key>&redirect_uri=<return>`
3. The user authorizes at their host; the Domains screen auto-rechecks and flips to **Verified**.

> Until a provider has synced the template, the apply URL 404s there — so the app checks
> discovery/support first and falls back to the manual records.
