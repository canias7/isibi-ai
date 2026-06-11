import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Text-to-speech relay. The owner's self-trained voice model runs as an HTTP
// service THEY host (a terminal process behind a tunnel today, any server
// later); this function keeps that URL + auth out of the client and gives the
// app one stable, JWT-protected endpoint. Contract with the voice server:
//   POST {TTS_URL}  body: {"text": "..."}  ->  200 + audio bytes (wav/mp3)
// Configure with secrets:
//   TTS_URL   (required) — the voice server endpoint
//   TTS_AUTH  (optional) — sent as Authorization: Bearer <TTS_AUTH>
// No TTS_URL set -> 503, and the app quietly falls back to the device voice.

const TTS_URL = Deno.env.get("TTS_URL") ?? "";
const TTS_AUTH = Deno.env.get("TTS_AUTH") ?? "";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return err("method not allowed", 405);
  if (!TTS_URL) return err("Custom voice isn't configured yet (TTS_URL missing on the server).", 503);

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
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(25000),
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
