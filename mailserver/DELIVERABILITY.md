# Deliverability hardening (Tier 1)

What's automated now, what you deploy once, and the two things only you can do
(provider enrollments). Pairs with the warm-up throttle + reputation guard already live.

## Automated (shipped)

- **Hard vs. soft bounce classification.** `bounce-watch` reads Postfix's `dsn=` code;
  `mail-events` suppresses only **hard** bounces (5.x.x). Soft bounces (4.x.x — mailbox
  full, greylisted, rate-limited) are recorded as `soft_bounced` and **kept sendable**,
  so we don't lose addresses over temporary problems.
- **One-click unsubscribe (RFC 8058).** The relay already sends
  `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The
  `unsubscribe` function now acts only on **POST** (Gmail/Yahoo one-click, or the
  confirm button) and shows a confirm page on GET — so inbox link-scanners can't
  unsubscribe people by accident. Opt-outs suppress + emit the `unsubscribed` webhook.
- **Durable send retry.** A transient relay failure (box briefly down / 5xx / network)
  requeues the recipient (`attempts` capped at 8) instead of failing it; the every-minute
  `run_due` cron drains it as the box recovers. Transactional `mailer.send` retries 3×.
- **Blocklist (DNSBL) monitor.** `ops-monitor` checks the sending IP against
  Spamhaus ZEN / SpamCop / Barracuda each 15-min tick and alerts (email + `ops_alerts`)
  if listed. Set `MAILER_SENDING_IP` if the IP changes / you add a pool.

## Deploy once (on the box)

`bounce-watch` changed (DSN parsing). Re-copy and restart:

```
scp mailserver/bounce-watch.ts root@86.48.22.231:/root/mailserver/
ssh root@86.48.22.231 'systemctl restart gofarther-bounce-watch'
```

(`relay.ts` already emits the one-click headers — only redeploy it if you change it.)

## Manual — provider enrollments (only you can do these)

These need accounts/ownership we can't automate from the app.

### 1. Google Postmaster Tools — Gmail reputation
Gmail has **no per-message feedback loop**; complaints show only as an aggregate spam
rate here. Set it up:
1. Go to https://postmaster.google.com → add `gofarther.dev`.
2. Publish the TXT verification record it gives you (same DNS host as the other records).
3. Watch **Spam rate** (keep < 0.10%, hard ceiling 0.30%), Domain/IP reputation, auth.
> Optional later: the Postmaster Tools **API** can pull spam-rate/reputation
> programmatically into `ops-monitor` — needs a Google Cloud project + service account.

### 2. Yahoo / Microsoft feedback loops — per-message complaints
These send an **ARF** report to a mailbox when a recipient hits "spam":
- **Yahoo CFL:** https://senders.yahooinc.com/complaint-feedback-loop/
- **Microsoft JMRP + SNDS:** https://sendersupport.olc.protection.outlook.com/snds/
- Enroll the sending **IP / domain**; point reports at e.g. `fbl@gofarther.dev`.
- To ingest them, the box needs an **inbound route** for that mailbox that parses the
  ARF and POSTs `{type:"complaint", message_id, email}` to `mail-events` (which already
  handles `complaint` → suppress + `complained` webhook). The box is send-only today, so
  this inbound path is the remaining build — until then, one-click unsubscribe is the
  practical complaint signal.

## Not done (Tier 1 #3, deferred)

Second IP / IP pool + failover — infra/cost decision, not code. The blocklist monitor and
`MAILER_SENDING_IP`/`_spf.gofarther.dev` include are already pool-ready.
