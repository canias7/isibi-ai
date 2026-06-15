# Self-hosted transcription — own STT, no OpenAI

Replace the OpenAI Whisper API in `supabase/functions/transcribe` with a
self-hosted Whisper: **same model, on your box, $0/use, no OpenAI key.**
**No fallback** — if the STT box is down, voice input is down (same dependency
your LLMs + Linda TTS already have). This mirrors the `tts` relay exactly.

> You are NOT training anything — Whisper's weights are open. This is serve + wire.

## 1. Run an OpenAI-compatible Whisper server

Pick an **OpenAI-API-compatible** server so the edge-function change is just a URL
swap (same `/v1/audio/transcriptions` shape `transcribe` already posts to).
Easiest: **`faster-whisper-server` / Speaches** (CTranslate2) or whisper.cpp's
server in OpenAI mode.

Run **large-v3** on **CPU** so it doesn't fight the 16GB GPU that serves the
LLMs — voice clips are short, int8 CPU transcription is a couple seconds:

```bash
# Docker (simplest). Verify exact flags against the image's current README —
# these projects rename env vars often.
docker run -d --name stt -p 8001:8000 \
  -e WHISPER__MODEL=Systran/faster-whisper-large-v3 \
  -e WHISPER__INFERENCE_DEVICE=cpu \
  fedirz/faster-whisper-server:latest-cpu
# GPU variant: :latest-cuda image + `--gpus all` (only if you have VRAM headroom)
```

It serves `POST /v1/audio/transcriptions` — identical to OpenAI's.

## 2. Expose it → `STT_URL`

Same Cloudflare-tunnel pattern as `model.gofarther.dev`: add a hostname (e.g.
`stt.gofarther.dev`) → `localhost:8001`, protected by a bearer token. Then set in
the Supabase function env:

```
STT_URL    = https://stt.gofarther.dev/v1/audio/transcriptions
STT_AUTH   = <bearer token>     # optional
STT_MODEL  = Systran/faster-whisper-large-v3   # the served model name
```

## 3. Rewire `transcribe/index.ts` (local Claude — it's deployed)

**Keep everything** — JWT/uid auth, the `ai_usage` logging, the b64 decode, the
multipart `form`. **Only swap the upstream call**, and drop OpenAI + its key:

- Replace `OPENAI_API_KEY` + `MODEL ("whisper-1")` with `STT_URL` / `STT_AUTH` /
  `STT_MODEL` (default `large-v3`).
- Keep building the same multipart `form` (audio file + `model = STT_MODEL`).
- Swap the upstream fetch:
  ```ts
  const r = await fetch(STT_URL, {
    method: "POST",
    headers: STT_AUTH ? { authorization: `Bearer ${STT_AUTH}` } : {},
    body: form,                         // same multipart as before
    signal: AbortSignal.timeout(30_000)
  });
  ```
- **No fallback:** if `STT_URL` is unset or the call errors/times out → return a
  clean `503 "Transcription unavailable"`. Do **not** call OpenAI.
- Keep the `ai_usage` row but set `source: "stt-self"`, `model: STT_MODEL` so cost
  telemetry shows $0 self-hosted.

The request/response shape is unchanged (OpenAI-compatible server), so **the
frontend needs no change** — only the upstream + env.

## Ops

No fallback means the STT box is now a hard dependency, like Ollama + Linda. Add
an `ops-monitor` health ping on `STT_URL` (you already monitor the model) so you
get alerted if transcription goes down. Keep the tunnel + container running
alongside your other self-hosted services.

## Result

The last cloud dependency in the voice pipeline (OpenAI Whisper) is gone. Voice
in → **your Whisper** → **gf-chat** (LLM) → **Linda** (TTS): fully self-hosted,
$0 per use.

---

## Reference: full `transcribe/index.ts` (relay version)

This is the repo's current `transcribe` with **only** the upstream swapped —
every safeguard (CORS, `voice` kill-switch, env reader, size guards, `ai_usage`
logging, error handling) is preserved. **No OpenAI, no fallback.**

> ⚠️ Built from the **repo** version. If the **deployed** function has diverged
> (prod can be ahead of git), apply the same three changes to the live one
> instead of pasting wholesale: (1) `OPENAI_KEY` → `STT_URL`/`STT_AUTH`/`STT_MODEL`,
> (2) the `fetch(...openai...)` → `fetch(STT_URL, ...)`, (3) `source: "whisper"` →
> `"stt-self"`. Test locally before deploy.

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Speech-to-text for voice "call mode". The client POSTs one spoken turn as
// base64; we relay it to the OWNER'S self-hosted Whisper (OpenAI-compatible
// /v1/audio/transcriptions) and return the transcript. No OpenAI, no fallback —
// if the box is down, voice input is down (same stance as the LLMs + Linda TTS).

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost", "ionic://localhost",
  "http://localhost", "https://localhost",
  "http://localhost:5173", "http://localhost:4173",
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

// Forgiving env read (ignore case / - vs _).
function env(name: string): string | undefined {
  const direct = Deno.env.get(name);
  if (direct) return direct;
  const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, "_");
  const target = norm(name);
  for (const [k, v] of Object.entries(Deno.env.toObject())) if (norm(k) === target && v) return v;
  return undefined;
}

// Self-hosted Whisper (OpenAI-compatible). STT_URL = full transcriptions endpoint,
// e.g. https://stt.gofarther.dev/v1/audio/transcriptions
const STT_URL = env("STT_URL");
const STT_AUTH = env("STT_AUTH") || "";            // optional bearer for the tunnel
const STT_MODEL = env("STT_MODEL") || "large-v3";  // must match the served model id

const SB_URL = Deno.env.get("SUPABASE_URL");
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

async function flagEnabled(key: string): Promise<boolean> {
  if (!SB_URL || !SB_SERVICE_KEY) return true;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/feature_flags?key=eq.${encodeURIComponent(key)}&select=enabled`, {
      headers: { apikey: SB_SERVICE_KEY, authorization: `Bearer ${SB_SERVICE_KEY}` },
    });
    if (!r.ok) return true;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0].enabled !== false : true;
  } catch { return true; }
}

// $0 self-hosted, but keep the ai_usage row (bytes) so the ops monitor sees voice volume.
function logStt(req: Request, byteLen: number): void {
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
    body: JSON.stringify({ user_id: uid, source: "stt-self", model: STT_MODEL, bytes: byteLen }),
  }).catch(() => {});
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
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
  if (!STT_URL) return jsonRes({ error: "Voice isn't configured yet (STT_URL missing on the server)." }, 503, cors);
  if (!(await flagEnabled("voice"))) {
    return jsonRes({ error: "Voice is briefly unavailable — please try again in a little while." }, 503, cors);
  }

  let audioB64 = "", mime = "audio/wav", filename = "turn.wav", language = "";
  try {
    const body = await req.json();
    audioB64 = typeof body.audio === "string" ? body.audio : "";
    if (typeof body.mime === "string" && body.mime) mime = body.mime;
    if (typeof body.filename === "string" && body.filename) filename = body.filename;
    if (typeof body.language === "string" && body.language) language = body.language;
  } catch { return jsonRes({ error: "Bad request body." }, 400, cors); }
  if (!audioB64) return jsonRes({ error: "No audio." }, 400, cors);

  let bytes: Uint8Array;
  try { bytes = b64ToBytes(audioB64); } catch { return jsonRes({ error: "Audio not valid base64." }, 400, cors); }
  if (bytes.length > 10 * 1024 * 1024) return jsonRes({ error: "Audio too large." }, 413, cors);
  if (bytes.length < 1024) return jsonRes({ text: "" }, 200, cors); // basically silence

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), filename);
  form.append("model", STT_MODEL);
  if (language) form.append("language", language);
  form.append("response_format", "json");

  let r: Response;
  try {
    r = await fetch(STT_URL, {
      method: "POST",
      headers: STT_AUTH ? { authorization: `Bearer ${STT_AUTH}` } : {},
      body: form,
      signal: AbortSignal.timeout(30_000), // self-hosted; don't hang the call forever
    });
  } catch { return jsonRes({ error: "Transcription service unreachable." }, 502, cors); }
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error("stt error", r.status, detail.slice(0, 400));
    return jsonRes({ error: `Transcription failed (${r.status}).` }, 502, cors);
  }
  const j = await r.json().catch(() => ({}));
  const text = typeof j.text === "string" ? j.text.trim() : "";
  logStt(req, bytes.length);
  return jsonRes({ text }, 200, cors);
});
```

**Diff from the original, in one breath:** dropped `OPENAI_KEY`/`MODEL`; added
`STT_URL`/`STT_AUTH`/`STT_MODEL`; the missing-config guard now checks `STT_URL`;
the upstream `fetch` points at `STT_URL` with an optional bearer + a 30s timeout;
`ai_usage.source` is `"stt-self"`. The request/response contract is byte-for-byte
the same, so **the frontend (`voice.ts`) needs no change.**

