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

1. Submit `gofarther.dev.email.json` as a PR to **https://github.com/Domain-Connect/Templates**
   (`templates/` folder). Provider id is `gofarther.dev`; ownership is confirmed per that
   repo's process (a DNS TXT challenge on gofarther.dev).
2. Once merged, DNS providers sync templates on their own schedule (days–weeks, per
   provider). The button "lights up" for each host as it picks the template up.
3. Coverage is Domain‑Connect hosts only. Namecheap, Squarespace/Google, Porkbun, etc.
   fall back to the (now auto‑rechecking, copy‑all) manual flow.

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
