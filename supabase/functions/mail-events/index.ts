import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// mail-events — ingest delivery events from the self-hosted mail server (the box).
//
// The box's bounce-watch (mailserver/bounce-watch.ts) tails Postfix and POSTs
// bounce/complaint/delivered events here. We map each event's Message-ID back to the
// campaign recipient (provider_msg_id), mark it, and — for bounces/complaints — add
// the address to that user's suppression list so future sends skip it.
//
// Machine-authenticated by the relay token (MAILER_RELAY_TOKEN) — never a user JWT —
// same shared secret as the relay / keysync. Deploy with verify_jwt=false.
//
//   POST { events: [{ message_id, email, type, reason? }] }   // type: bounce|complaint|delivered
//     -> { ok, processed, suppressed }

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RELAY_TOKEN = Deno.env.get("MAILER_RELAY_TOKEN") ?? "";

function tokenEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function db(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_SERVICE, authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

interface Evt { message_id?: string; email?: string; type?: string; reason?: string }

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!RELAY_TOKEN || !tokenEq(token, RELAY_TOKEN)) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const events: Evt[] = Array.isArray(body?.events) ? body.events : (body?.message_id ? [body as Evt] : []);
  let processed = 0, suppressed = 0;

  for (const e of events) {
    const mid = String(e?.message_id ?? "").replace(/[<>]/g, "").trim();
    const type = String(e?.type ?? "").toLowerCase();
    if (!mid || !type) continue;

    // Map the Message-ID back to the recipient (and thus the sending user).
    const r = await db(`campaign_recipients?provider_msg_id=eq.${encodeURIComponent(mid)}&select=id,user_id,email&limit=1`);
    const rows = r.ok ? await r.json() : [];
    if (!rows.length) continue;
    const { id, user_id, email } = rows[0] as { id: string; user_id: string; email: string };
    processed++;

    if (type === "delivered") {
      await db(`campaign_recipients?id=eq.${id}&delivered_at=is.null`, { method: "PATCH", body: JSON.stringify({ delivered_at: new Date().toISOString() }) });
      continue;
    }

    const isComplaint = type === "complaint" || type === "complained" || type === "abuse";
    const status = isComplaint ? "complained" : "bounced";
    const reason = isComplaint ? "complaint" : "bounce";
    await db(`campaign_recipients?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status, error: String(e?.reason ?? reason).slice(0, 300) }) });
    // Suppress for this user so future sends skip the address (PK = user_id,email).
    const s = await db("email_suppressions", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ user_id, email, reason }),
    });
    if (s.ok) suppressed++;
  }

  return json({ ok: true, processed, suppressed });
});
