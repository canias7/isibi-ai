import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Text-to-speech relay. The owner's self-trained voice model runs as an HTTP
// service THEY host (a terminal process behind a tunnel today, any server
// later); this function keeps that URL + auth out of the client and gives the
// app one stable, JWT-protected endpoint. Contract with the voice server:
//   POST {TTS_URL}  body: {"text": "..."}  ->  200 + audio bytes (wav/mp3)
// Configure with secrets:
//   TTS_URL    (required) — the voice server endpoint
//   TTS_AUTH   (optional) — sent as Authorization: Bearer <TTS_AUTH>
//   TTS_VOICE  (optional) — forwarded as {"voice": ...} so you can pick which
//                           trained voice the app speaks (e.g. "Linda") without
//                           an app change; omitted -> the server's default voice.
// No TTS_URL set -> 503, and the app quietly falls back to the device voice.

const TTS_URL = Deno.env.get("TTS_URL") ?? "";
const TTS_AUTH = Deno.env.get("TTS_AUTH") ?? "";
const TTS_VOICE = Deno.env.get("TTS_VOICE") ?? "";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const err = (msg: string, status: number) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

// Per-user rate limit (per isolate — coarse but real friction): the upstream is
// ONE self-hosted voice box, and a looped caller holding 38s requests can
// starve it for everyone. Call mode speaks one reply at a time; 30/5min is far
// above honest use. The JWT is gateway-verified (verify_jwt), so `sub` is
// trustworthy here.
const RL_MAX = 30, RL_WINDOW_MS = 5 * 60 * 1000;
const rlHits = new Map<string, number[]>();
function rateLimited(uid: string): boolean {
  const now = Date.now();
  const hits = (rlHits.get(uid) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  if (hits.length >= RL_MAX) { rlHits.set(uid, hits); return true; }
  hits.push(now);
  rlHits.set(uid, hits);
  if (rlHits.size > 1000) rlHits.clear(); // unbounded-growth stop on a long-lived isolate
  return false;
}
function uidFromJwt(req: Request): string {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const payload = token.split(".")[1];
    if (!payload) return "anon";
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.sub === "string" ? json.sub : "anon";
  } catch {
    return "anon";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return err("method not allowed", 405);
  if (!TTS_URL) return err("Custom voice isn't configured yet (TTS_URL missing on the server).", 503);
  if (rateLimited(uidFromJwt(req))) return err("Easy there — too many voice requests. Give it a minute.", 429);

  let text = "";
  try {
    const b = await req.json();
    text = String(b?.text ?? "").trim();
  } catch {
    return err("bad request", 400);
  }
  if (!text) return err("nothing to say", 400);
  // Cap the spoken length: call mode already trims replies, and a runaway text
  // would tie up the (possibly slow, self-hosted) model for ages.
  if (text.length > 1200) text = `${text.slice(0, 1200)}…`;

  try {
    // Self-hosted models can be slow, but a hung tunnel shouldn't hang the call
    // forever — the app falls back to the device voice when this errors.
    const upstream = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(TTS_AUTH ? { authorization: `Bearer ${TTS_AUTH}` } : {}),
      },
      body: JSON.stringify({ text, ...(TTS_VOICE ? { voice: TTS_VOICE } : {}) }),
      signal: AbortSignal.timeout(38000),
    });
    if (!upstream.ok || !upstream.body) {
      return err(`voice server ${upstream.status}`, 502);
    }
    const type = upstream.headers.get("content-type") ?? "audio/wav";
    return new Response(upstream.body, { headers: { ...cors, "content-type": type } });
  } catch (e) {
    const m = e instanceof Error && e.name === "TimeoutError" ? "voice server timed out" : "voice server unreachable";
    return err(m, 502);
  }
});
