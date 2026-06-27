# Standing up the `gofarther.dev` production sender

This is **step 1** of the multi-tenant email plan: get a real sending box live under
`gofarther.dev` so the app's onboarding records actually deliver mail. After this,
`send` works end-to-end and (later) a Domain Connect template has real infra to point at.

The app side is already built and deployed:
- `mailer` edge function — `send` relays to the box; `keysync_export` lets the box pull keys.
- `sending_domains` / `sending_domain_keys` tables — per-customer DKIM, private keys service-role-only.
- `src/mailer.ts` — the client.

What's left is **infra you run once**. ~30–45 min.

---

## 0. Pick the box

**Recommended: re-point the existing Contabo lab box** (`86.48.22.231`) to the
gofarther.dev identity. It already has Postfix + OpenDKIM working, port 25 open, and a
proven deliverability score — no new cost, no new port-25 gamble. The steps below assume
this. (A fresh box works identically; just use its IP everywhere.)

> The lab's `lab.isibi.ai` identity goes away here — that was always a test. From now on
> the box signs **per-customer** domains via keysync, not one static domain.

Set a shell var for convenience (on your machine, in the commands below):

```
IP=86.48.22.231
```

---

## 1. DNS for gofarther.dev

Add these at gofarther.dev's DNS host (apex/records — wherever gofarther.dev is managed):

| Type | Name | Value | Why |
|---|---|---|---|
| A | `mail.gofarther.dev` | `<IP>` | The box's mail identity (HELO / rDNS target) |
| A | `relay.gofarther.dev` | `<IP>` | The HTTPS relay endpoint Caddy serves |
| TXT | `_spf.gofarther.dev` | `v=spf1 ip4:<IP> -all` | **The include hub.** Every customer's SPF is `include:_spf.gofarther.dev`, so their record never changes when we add/rotate IPs — we just edit this one. |
| TXT | `_dmarc.gofarther.dev` | `v=DMARC1; p=reject; rua=mailto:dmarc@gofarther.dev` | DMARC for our own identity domain |

> Adding more sending IPs later? Just append `ip4:<IP2>` to `_spf.gofarther.dev`. Customers need no change.

---

## 2. Reverse DNS (PTR)

In the **Contabo panel** → your VPS → set rDNS for `<IP>` to **`mail.gofarther.dev`**.
FCrDNS (forward+reverse match) is a big deliverability factor. Verify once propagated:

```
dig +short -x $IP        # -> mail.gofarther.dev.
dig +short mail.gofarther.dev   # -> <IP>
```

---

## 3. Re-point Postfix identity (on the box)

SSH in (`ssh root@$IP`) and set the hostname Postfix announces:

```
hostnamectl set-hostname mail.gofarther.dev
postconf -e myhostname=mail.gofarther.dev
postconf -e mydomain=gofarther.dev
postconf -e myorigin='$myhostname'
systemctl restart postfix
```

---

## 4. Install the relay + keysync (on the box)

Copy this `mailserver/` directory to the box and run the installer:

```
# from your machine:
scp -r mailserver root@$IP:/root/

# on the box:
cd /root/mailserver
sudo bash install.sh
```

`install.sh` is idempotent. It installs Deno, a `gofarther` service user, the relay +
keysync services, Caddy (auto-TLS for `relay.gofarther.dev`), wires OpenDKIM to the
keysync-managed tables, and hooks the Postfix milter. It does **not** touch identity/rDNS
(you did those above).

---

## 5. Deploy the updated function + set the shared secret

**First deploy the new `mailer`** (the version with `send` relay + `keysync_export`),
with **`verify_jwt=false`** — auth is enforced inside the function, and the box's
keysync uses the relay token, not a Supabase JWT. Deploy via the Supabase MCP
`deploy_edge_function` (approve the prompt) or `supabase functions deploy mailer
--no-verify-jwt --project-ref lkpfeqrelvziltfwpuxi`. (Merging to `main` does **not**
deploy it.)

Then the shared secret — generate it once on the box, put the **same value** in the app.

```
# on the box:
openssl rand -hex 32          # copy this
nano /etc/gofarther/mailer.env   # paste into RELAY_TOKEN=...
systemctl restart gofarther-relay
systemctl start gofarther-keysync
```

In the app, set two **edge function secrets** (Supabase Dashboard → Project → Edge
Functions → **Secrets** → Add):

| Secret | Value |
|---|---|
| `MAILER_RELAY_URL` | `https://relay.gofarther.dev` |
| `MAILER_RELAY_TOKEN` | *the same hex string from `openssl rand`* |

(CLI alt: `supabase secrets set MAILER_RELAY_URL=… MAILER_RELAY_TOKEN=… --project-ref lkpfeqrelvziltfwpuxi`.)
`MAILER_SPF_INCLUDE` and `MAILER_DMARC_RUA` already default to gofarther.dev — no need to set them.

---

## 6. Verify end-to-end

```
# relay reachable + TLS good:
curl -fsS https://relay.gofarther.dev/health        # {"ok":true}

# keysync ran cleanly:
journalctl -u gofarther-keysync -n 30 --no-pager
```

Then in the app:
1. **Add a domain** you control → publish the 3 records it shows (DKIM, SPF, DMARC).
2. **Verify** (turns green once DNS propagates; SPF `include:_spf.gofarther.dev` + the DKIM key).
   - Within ~2 min, keysync pulls that domain's key onto the box automatically.
3. **Send a test** to a Gmail you own. In Gmail → "Show original":
   - **SPF: PASS**, **DKIM: PASS** (`d=` your domain), **DMARC: PASS**.
4. For a score, send to a fresh `mail-tester.com` address and aim 9–10/10.

---

## 7. After it's live

- **Domain Connect (step 3):** flip `DOMAIN_CONNECT.live = true` in `src/domainConnect.ts`
  once `domain-connect/gofarther.dev.sender.json` is merged upstream — the records it applies
  (DKIM + the `_spf.gofarther.dev` include + DMARC) now point at real, live infra.
- **Bounces/complaints → suppression:** add a small parser that reads Postfix's bounce log
  (Ubuntu 24.04 logs to journald: `journalctl -t postfix/bounce`) and POSTs failures into
  `email_suppressions`. `send` already refuses suppressed recipients.
- **Warm-up:** ramp volume gradually on a new IP; keep DMARC at `p=none` for customers until
  you're confident, then move to quarantine/reject.

---

## How it fits together

```
app (user)                         edge: mailer                 box: mail.gofarther.dev
──────────                         ────────────                 ───────────────────────
add domain ───────────────────────▶ generate DKIM, store key
                                    return DNS records
publish DNS, Verify ──────────────▶ DoH check, mark verified
                                                                 keysync (every 2m):
                                                  ◀───────────── POST keysync_export (RELAY_TOKEN)
                                    return {domain,selector,pem}
                                                                 write OpenDKIM tables, reload
send ─────────────────────────────▶ verify+suppress check
                                    POST relay /send ──────────▶ build MIME -> sendmail
                                                                 Postfix + OpenDKIM sign -> Internet
```
