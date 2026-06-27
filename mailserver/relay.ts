// relay.ts — the box side of the multi-tenant sender (runs on mail.gofarther.dev).
//
// A tiny HTTPS-fronted JSON API the `mailer` edge function calls to actually send.
// It builds a proper MIME message and injects it into the local Postfix via
// `sendmail`; OpenDKIM (wired as a Postfix milter) signs it with the From domain's
// key — which keysync.ts has already installed — so SPF + DKIM + DMARC all align.
//
// Auth: a single shared secret (RELAY_TOKEN) that must equal the edge function's
// MAILER_RELAY_TOKEN. Bind to localhost and put Caddy in front for TLS (see
// Caddyfile) so the token only ever travels over HTTPS.
//
// Run:  deno run --allow-net --allow-env --allow-run=/usr/sbin/sendmail relay.ts
// (systemd unit: gofarther-relay.service)

const RELAY_TOKEN = Deno.env.get("RELAY_TOKEN") ?? "";
const BIND = Deno.env.get("RELAY_BIND") ?? "127.0.0.1";
const PORT = Number(Deno.env.get("RELAY_PORT") ?? "8025");
const SENDMAIL = Deno.env.get("SENDMAIL") ?? "/usr/sbin/sendmail";

if (!RELAY_TOKEN) {
  console.error("RELAY_TOKEN is required");
  Deno.exit(1);
}

function tokenEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authed(req: Request): boolean {
  const h = req.headers.get("authorization") || "";
  const t = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  return tokenEq(t, RELAY_TOKEN);
}

// --- MIME helpers ---
function b64bytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64utf8(s: string): string {
  return (b64bytes(new TextEncoder().encode(s)).match(/.{1,76}/g) ?? []).join("\r\n");
}
// RFC 2047 encode a header value only if it contains non-ASCII.
function encHeader(s: string): string {
  // deno-lint-ignore no-control-regex
  if (!/[^\x00-\x7F]/.test(s)) return s;
  return `=?UTF-8?B?${b64bytes(new TextEncoder().encode(s))}?=`;
}
// Encode the display-name part of "Name <addr>"; leave the address alone.
function encAddress(s: string): string {
  const m = s.match(/^(.*?)<([^>]+)>\s*$/);
  if (!m) return s;
  const name = m[1].trim().replace(/^"|"$/g, "");
  return name ? `${encHeader(name)} <${m[2].trim()}>` : m[2].trim();
}
function bareAddr(s: string): string {
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}
// Strip CR/LF and other control chars from a header value so a crafted From/To/
// Subject/Reply-To can't inject extra headers (header injection / a hidden Bcc).
// Bodies are base64-encoded, so they can't inject. charCode-based to avoid any
// control-char regex.
function headerSafe(s: string): string {
  let out = "";
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 32 || c === 127 ? " " : ch;
  }
  return out.trim();
}
function rfc5322Date(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${mon[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

interface SendBody { from?: string; to?: string; subject?: string; html?: string; text?: string; reply_to?: string; list_unsubscribe?: string }

function buildMime(b: Required<Pick<SendBody, "from" | "to" | "subject">> & SendBody): { raw: string; id: string; envFrom: string } {
  // Sanitize every header value first so a crafted From/To/Subject/Reply-To can't
  // inject extra headers.
  const from = headerSafe(b.from);
  const to = headerSafe(b.to);
  const subject = headerSafe(b.subject);
  const replyTo = b.reply_to ? headerSafe(b.reply_to) : "";
  const envFrom = bareAddr(from);
  const fromDomain = envFrom.split("@")[1] || "localhost";
  const id = `<${crypto.randomUUID()}@${fromDomain}>`;
  const headers = [
    `From: ${encAddress(from)}`,
    `To: ${encAddress(to)}`,
    `Subject: ${encHeader(subject)}`,
    `Date: ${rfc5322Date(new Date())}`,
    `Message-ID: ${id}`,
    `MIME-Version: 1.0`,
  ];
  if (replyTo) headers.push(`Reply-To: ${encAddress(replyTo)}`);
  // One-click unsubscribe (campaigns) — improves deliverability + required by Gmail/Yahoo bulk rules.
  const listUnsub = b.list_unsubscribe ? headerSafe(b.list_unsubscribe) : "";
  if (listUnsub) {
    headers.push(`List-Unsubscribe: <${listUnsub}>`);
    headers.push(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
  }

  let mimeBody: string;
  if (b.html && b.text) {
    const boundary = `=_gf_${crypto.randomUUID()}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    mimeBody = [
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64utf8(b.text),
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64utf8(b.html),
      `--${boundary}--`,
      ``,
    ].join("\r\n");
  } else {
    const isHtml = !!b.html;
    headers.push(`Content-Type: text/${isHtml ? "html" : "plain"}; charset=UTF-8`);
    headers.push(`Content-Transfer-Encoding: base64`);
    mimeBody = `${b64utf8((b.html ?? b.text) as string)}\r\n`;
  }
  // Header block, one blank line, then the body (required by RFC 5322 / 2046).
  return { raw: `${headers.join("\r\n")}\r\n\r\n${mimeBody}`, id, envFrom };
}

async function inject(raw: string, envFrom: string): Promise<{ ok: boolean; err?: string }> {
  try {
    const child = new Deno.Command(SENDMAIL, {
      args: ["-t", "-i", "-f", envFrom],
      stdin: "piped", stdout: "piped", stderr: "piped",
    }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(raw));
    await w.close();
    const { code, stderr } = await child.output();
    if (code !== 0) return { ok: false, err: new TextDecoder().decode(stderr).trim() || `sendmail exit ${code}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
}

Deno.serve({ hostname: BIND, port: PORT }, async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }
  if (req.method !== "POST" || url.pathname !== "/send") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (!authed(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as SendBody;
  if (!b.from || !b.to || !b.subject || (!b.html && !b.text)) {
    return Response.json({ error: "from, to, subject and html|text are required" }, { status: 400 });
  }
  const { raw, id, envFrom } = buildMime(b as Required<Pick<SendBody, "from" | "to" | "subject">> & SendBody);
  const res = await inject(raw, envFrom);
  if (!res.ok) {
    console.error("inject failed:", res.err);
    return Response.json({ error: "send_failed" }, { status: 502 });
  }
  console.log("sent", id, "->", bareAddr(b.to));
  return Response.json({ id });
});

console.log(`relay listening on ${BIND}:${PORT}`);
