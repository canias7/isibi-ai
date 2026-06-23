# Domain Connect template (one-click domain setup)

`gofarther.dev.email.json` is our [Domain Connect](https://www.domainconnect.org/)
template. It's what makes the **"Auto configure"** one-click work: when a user's domain
is on a Domain Connect host (Cloudflare, GoDaddy, IONOS, Plesk, 123-reg, …), the host
reads this template and writes the records after a one-time "Authorize" click — no
copy‑paste. (This is exactly what Resend's `providers/resend.com` template does.)

The records mirror what the `ses` function hands out today: the **3 Amazon SES Easy‑DKIM
CNAMEs** (tokens passed in as the `%dkim1%`…`%dkim3%` variables, per domain) and a
**DMARC** TXT policy.

## How it gets live (the external, one-time step)

Until this is done, the app falls back to the Cloudflare API-token panel (and copy‑all
records). Once it's done, the existing **Auto configure** button becomes true
"click‑Approve" with no token, on every Domain Connect host.

1. **Prereqs on `gofarther.dev`:** the domain must resolve and serve `logoUrl`
   (`https://gofarther.dev/logo.png`) and a landing page — reviewers and the host UI show
   these. `redirect_uri` is `https://gofarther.dev/`, already in `syncRedirectDomain`.
2. **Test in the Online Editor (required — PRs without a test link aren't reviewed):**
   open https://domainconnect.paulonet.eu/dc/free/templateedit, paste the JSON, fix any
   syntax flags, and test apply against **both an apex domain and a subdomain**. Copy the
   shareable result link.
3. **File the PR** to **https://github.com/Domain-Connect/Templates**: add
   `gofarther.dev.email.json` at the **repo root** (filename is `providerId.serviceId.json`
   — ours already matches), and paste the Online Editor link in the PR body. Optional but
   recommended: run https://github.com/Domain-Connect/dc-template-linter first.
4. **After merge**, DNS providers sync templates on their own schedule (days–weeks, per
   provider). The button "lights up" for each host as it picks the template up.
5. Coverage is Domain‑Connect hosts only (Cloudflare, GoDaddy, IONOS, 123‑reg, one.com, …).
   Namecheap, Squarespace/Google, Porkbun, etc. fall back to the manual flow.

> The template was schema‑checked against `template.schema`: required top‑level fields are
> `providerId, providerName, serviceId, serviceName, records` (all present), and the
> redirect field is `syncRedirectDomain` (singular).

## How the app uses it

When the user taps **Auto configure**, the app:
1. Discovers the domain's Domain Connect host — TXT lookup of `_domainconnect.<domain>`,
   then `GET https://<host>/v2/<domain>/settings` for `urlSyncUX`.
2. Opens the apply URL with the domain's real DKIM tokens:
   `<urlSyncUX>/v2/domainTemplates/providers/gofarther.dev/services/email/apply?domain=<domain>&dkim1=<t1>&dkim2=<t2>&dkim3=<t3>&redirect_uri=<return>`
3. The user authorizes at their host; SES verification then flips to **Verified** (the
   Domains screen already auto‑rechecks).

> Until the template is synced by a given provider, the apply URL 404s there — so the app
> must check discovery/support first and fall back to the manual records.
