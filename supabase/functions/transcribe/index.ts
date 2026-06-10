import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Speech-to-text for voice "call mode". The client records one spoken turn and
// POSTs it here as base64; we forward it to OpenAI Whisper (the key lives only on
// the server) and return the transcript. Kept as its own tiny function so the
// chat function stays focused and this can scale/independently fail.

// CORS allowlist mirrors the chat function: native app (Capacitor) + local dev.
const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
  "http://localhost:5173",
  "http://localhost:4173",
]);
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allow = !origin || ALLOWED_ORIGINS.has(origin) ? (origin ?? "*") : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Read an env var forgivingly: ignore case and collapse any run of - or _, so a
// dashboard secret entered as OPENAI-API-KEY still matches OPENAI_API_KEY.
function env(name: string): string | undefined {
  const direct = Deno.env.get(name);
  if (direct) return direct;
  const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, "_");
  const target = norm(name);
  for (const [k, v] of Object.entries(Deno.env.toObject())) {
    if (norm(k) === target && v) return v;
  }
  return undefined;
}

const OPENAI_KEY = env("OPENAI_API_KEY");
// whisper-1 is broadly available with no org verification. Override to a newer
// model (e.g. gpt-4o-mini-transcribe) via OPENAI_TRANSCRIBE_MODEL when you want.
const MODEL = env("OPENAI_TRANSCRIBE_MODEL") || "whisper-1";

const SB_URL = Deno.env.get("SUPABASE_URL");
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Kill switch (feature_flags key "voice"): fail-open — a flags hiccup must
// never break voice. Mirrors chat's master switch.
async function flagEnabled(key: string): Promise<boolean> {
  if (!SB_URL || !SB_SERVICE_KEY) return true;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/feature_flags?key=eq.${encodeURIComponent(key)}&select=enabled`, {
      headers: { apikey: SB_SERVICE_KEY, authorization: `Bearer ${SB_SERVICE_KEY}` },
    });
    if (!r.ok) return true;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0].enabled !== false : true;
  } catch {
    return true;
  }
}

// Cost telemetry: one ai_usage row per transcription (bytes → the ops monitor
// estimates Whisper minutes from them). Fire-and-forget.
function logWhisper(req: Request, byteLen: number): void {
  if (!SB_URL || !SB_SERVICE_KEY) return;
  let uid: string | null = null;
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const payload = token.split(".")[1];
    if (payload) {
      const j = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      if (j.role === "authenticated" && typeof j.sub === "string") uid = j.sub;
    }
  } catch { /* anonymous */ }
  fetch(`${SB_URL}/rest/v1/ai_usage`, {
    method: "POST",
    headers: { apikey: SB_SERVICE_KEY, authorization: `Bearer ${SB_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ user_id: uid, source: "whisper", model: MODEL, bytes: byteLen }),
  }).catch(() => {});
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function jsonRes(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "Method not allowed" }, 405, cors);
  if (!OPENAI_KEY) return jsonRes({ error: "Voice isn't configured yet (OPENAI_API_KEY missing on the server)." }, 503, cors);
  if (!(await flagEnabled("voice"))) {
    return jsonRes({ error: "Voice is briefly unavailable — please try again in a little while." }, 503, cors);
  }

  let audioB64 = "";
  let mime = "audio/wav";
  let filename = "turn.wav";
  let language = "";
  try {
    const body = await req.json();
    audioB64 = typeof body.audio === "string" ? body.audio : "";
    if (typeof body.mime === "string" && body.mime) mime = body.mime;
    if (typeof body.filename === "string" && body.filename) filename = body.filename;
    if (typeof body.language === "string" && body.language) language = body.language;
  } catch {
    return jsonRes({ error: "Bad request body." }, 400, cors);
  }
  if (!audioB64) return jsonRes({ error: "No audio." }, 400, cors);

  let bytes: Uint8Array;
  try { bytes = b64ToBytes(audioB64); } catch {
    return jsonRes({ error: "Audio not valid base64." }, 400, cors);
  }
  // Guard against runaway payloads — a spoken turn is well under this.
  if (bytes.length > 10 * 1024 * 1024) return jsonRes({ error: "Audio too large." }, 413, cors);
  if (bytes.length < 1024) return jsonRes({ text: "" }, 200, cors); // basically silence

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), filename);
  form.append("model", MODEL);
  if (language) form.append("language", language);
  form.append("response_format", "json");

  let r: Response;
  try {
    r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    });
  } catch {
    return jsonRes({ error: "Transcription service unreachable." }, 502, cors);
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error("whisper error", r.status, detail.slice(0, 400));
    // Don't leak the upstream body to the client.
    return jsonRes({ error: `Transcription failed (${r.status}).` }, 502, cors);
  }
  const j = await r.json().catch(() => ({}));
  const text = typeof j.text === "string" ? j.text.trim() : "";
  logWhisper(req, bytes.length);
  return jsonRes({ text }, 200, cors);
});
