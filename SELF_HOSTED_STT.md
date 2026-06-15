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
