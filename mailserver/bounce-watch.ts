// bounce-watch.ts — turns Postfix bounces into suppressions (runs on the box).
//
// Tails the mail journal, correlates each delivery's queue-id to its Message-ID
// (logged by postfix/cleanup) and final status (logged by postfix/smtp), and POSTs
// every bounce to the app's `mail-events` function, which suppresses the address for
// that user. Authenticated with the shared RELAY_TOKEN.
//
// Why journald (not a bounce mailbox): no inbound MX needed — the box already logs
// everything we need. Ubuntu 24.04 logs Postfix to journald, not /var/log/mail.log.
//
// Run:  deno run --allow-run=journalctl --allow-net --allow-env bounce-watch.ts
// (systemd unit: gofarther-bounce-watch.service)

const EVENTS_URL = Deno.env.get("MAILER_EVENTS_URL") ?? "";
const RELAY_TOKEN = Deno.env.get("RELAY_TOKEN") ?? "";
const SB_ANON = Deno.env.get("SB_ANON") ?? "";

if (!EVENTS_URL || !RELAY_TOKEN) {
  console.error("MAILER_EVENTS_URL and RELAY_TOKEN are required");
  Deno.exit(1);
}

// queue-id -> Message-ID, bounded so a long-running watcher can't grow without limit.
const midByQid = new Map<string, string>();
function remember(qid: string, mid: string) {
  midByQid.set(qid, mid);
  if (midByQid.size > 5000) midByQid.delete(midByQid.keys().next().value as string);
}

async function postEvent(evt: { message_id: string; email: string; type: string; reason?: string; code?: string; hard?: boolean }) {
  try {
    const headers: Record<string, string> = { authorization: `Bearer ${RELAY_TOKEN}`, "content-type": "application/json" };
    if (SB_ANON) headers.apikey = SB_ANON;
    const r = await fetch(EVENTS_URL, { method: "POST", headers, body: JSON.stringify({ events: [evt] }) });
    if (!r.ok) console.error("mail-events", r.status, (await r.text()).slice(0, 160));
    else console.log("bounce ->", evt.email, evt.message_id);
  } catch (e) {
    console.error("post failed:", String(e));
  }
}

// cleanup logs:  <qid>: message-id=<id@domain>
const RE_MID = /^([0-9A-F]+):\s+message-id=<([^>]+)>/i;
// smtp/lmtp logs: <qid>: to=<addr>, ... status=bounced (reason...)
const RE_BOUNCE = /^([0-9A-F]+):\s+to=<([^>]+)>.*status=bounced(?:\s*\(([^)]*)\))?/i;
// Postfix logs the enhanced status code as dsn=X.Y.Z. The class digit tells us
// permanent vs transient: 5.x.x = hard bounce (suppress), 4.x.x = soft (don't).
const RE_DSN = /\bdsn=((\d)\.\d+\.\d+)/i;

function handle(line: string) {
  const mid = line.match(RE_MID);
  if (mid) { remember(mid[1], mid[2]); return; }
  const b = line.match(RE_BOUNCE);
  if (b) {
    const messageId = midByQid.get(b[1]);
    if (!messageId) return; // never saw the message-id for this queue-id; skip
    const dsn = line.match(RE_DSN);
    const hard = dsn ? dsn[2] === "5" : true; // unknown code -> treat as hard (safe default)
    postEvent({ message_id: messageId, email: b[2].toLowerCase(), type: "bounce", reason: (b[3] || "bounced").slice(0, 300), code: dsn ? dsn[1] : undefined, hard });
  }
}

async function main() {
  // Follow new mail-facility log lines (message body only, no timestamp prefix).
  const child = new Deno.Command("journalctl", {
    args: ["-f", "-n", "0", "--facility=mail", "-o", "cat"],
    stdout: "piped", stderr: "null",
  }).spawn();
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  console.log("bounce-watch: following the mail journal");
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try { handle(line); } catch { /* ignore one bad line */ }
    }
  }
}

main().catch((e) => { console.error("bounce-watch failed:", String(e)); Deno.exit(1); });
