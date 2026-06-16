# SYSTEM.md — Go Farther: architecture & status

Single source of truth for how the AI stack fits together, what's self-hosted vs
cloud, and what's left to make it all live. Detailed runbooks are linked inline.

---

## The self-hosted models (trained in-house, served locally)

All three run in **Ollama** on the 16GB box and are reached through the Cloudflare
tunnel **`model.gofarther.dev`** (OpenAI-compatible API). Distilled from a teacher
(Anthropic Sonnet) onto Qwen2.5 bases via QLoRA — see `finetune/`.

| Model (Ollama) | Base | Quant | Job | Status |
|---|---|---|---|---|
| **`gf-workflows`** | Qwen2.5-7B | q8_0 (~8GB) | **Builder** — NL request → workflow JSON | ✅ **live**, 97% schema-valid @ temp 0.2 |
| **`gf-runner`** | Qwen2.5-14B | q4_k_m (~9GB) | **Runner/Tester** — execute a workflow's tools | loaded, **needs wiring** (v1: 179/540 traces) |
| **`gf-chat`** | Qwen2.5-14B | q4_k_m (~9GB) | **Chat / voice brain** — conversation + tools | loaded, **needs wiring** (v1: ~400 examples) |

Builder is grammar-constrained (100% valid JSON) and, with the finalize pass
(below), provably **100% schema-valid**. Runner was also trained on detector +
tester traces (`helper_gen.py`), so it powers both `run-workflows` and
`test-workflow`.

---

## The full stack — self-hosted vs cloud

| Component | Edge function | Self-hosted target | Today | Plan |
|---|---|---|---|---|
| Builder | `build-workflow` | `gf-workflows` | ✅ wired (ML-primary + Opus fallback) | port `finalize.py` → 100% valid |
| Runner | `run-workflows` | `gf-runner` | Claude + tool-search | BACKEND_WIRING §2 |
| Tester | `test-workflow` | `gf-runner` | Claude (mirrors runner) | BACKEND_WIRING §2 (same as runner) |
| Chat / voice brain | `chat` | `gf-chat` | Claude + web/code/tools | BACKEND_WIRING §3 (router) |
| Voice out (TTS) | `tts` | **Linda** voice server | relay built; server down | restart Linda, set `TTS_URL` |
| Voice in (STT) | `transcribe` | **your Whisper** | OpenAI Whisper | SELF_HOSTED_STT.md (no fallback) |

---

## Data flows

**Workflow:** user request → `build-workflow` (`gf-workflows` + grammar + finalize)
→ saved → on schedule/Test → `run-workflows` / `test-workflow` (`gf-runner`) →
Composio tools → result summary.

**Voice:** mic → `transcribe` (**your Whisper**) → `chat` (**gf-chat**, Claude for
web/code) → `tts` (**Linda**) → playback. Fully self-hostable end-to-end.

---

## Cloud dependencies (what stays external, and why)

- **Anthropic (Claude)** — fallback for hard chat/runner turns (web search, code
  exec, deep tool discovery a local model can't do) **+ the data-gen teacher**.
  Drop the fallback for zero AI-cloud, but hard turns degrade — a later call.
- **Composio** — the bridge to Gmail/Slack/etc. It *is* the third-party
  connectors; inherently external (via `gofarther-mcp`).
- **Supabase** — DB, auth, edge-function host.
- ~~**OpenAI**~~ — removed once STT is self-hosted (SELF_HOSTED_STT.md).

---

## Go-live punch-list (all local-Claude / your-machine work)

1. **Stand up two servers** + expose via the tunnel:
   - **Linda** (TTS) → set `TTS_URL`, `TTS_VOICE=Linda`
   - **Whisper** (STT, faster-whisper large-v3 / CPU) → set `STT_URL`
2. **Wire the local models** (BACKEND_WIRING.md): `chat→gf-chat`,
   `run-workflows`+`test-workflow→gf-runner`, and for the builder **sync the tool
   catalog then port `finalize.py`** into build-workflow → ~100% schema-valid for
   free (the residual ~3% is catalog drift + cosmetic phantoms — BACKEND_WIRING §1
   "Field finding"; do the catalog sync *before* spending data credits).
3. **Smoke-test** `gf-runner` + `gf-chat` (never run yet) on the box.
4. **Set prod keys**: `ANTHROPIC_API_KEY`, `COMPOSIO_API_KEY` (OpenAI no longer needed once STT is up).
5. *(optional polish)* runner **v2** retrain (tool-cap ready → keeps ~all 540
   traces); builder **phantom** cleanup via finalize strip (already in `finalize.py`).

Nothing new needs to be **built or trained** — every piece exists or is spec'd.

---

## Repo map

| Path | What |
|---|---|
| `BACKEND_WIRING.md` | wire the 3 models into the edge functions (+ finalize plan) |
| `SELF_HOSTED_STT.md` | replace OpenAI Whisper with your own (no fallback) |
| `finetune/CLOUD.md` | rent a GPU + train 14B (200GB disk, chunk-download lessons) |
| `finetune/finalize.py` | **tested** repair pass → 100%-valid workflows (port to TS) |
| `finetune/scope_tools.py` | **tested** serve-time tool scoping for the runner (port to TS) |
| `finetune/gen_data.py` | builder training data (append-safe, phantom-clean) |
| `finetune/runner_gen.py` | runner traces (tool-capped for v2) + `helper_gen.py` (detector/tester) |
| `finetune/chat_gen.py` | chat training data |
| `finetune/{train,runner_train,chat_train}.py` | QLoRA training (local 7B / cloud 14B) |
| `finetune/eval.py` | score the builder vs the held-out set |
| `finetune/{catalog,schema,grammar,tool_schemas}.py` | the connector universe + workflow schema/grammar |

---

## Branch note

Active dev branch: `claude/zealous-sagan-TA5qG` (realigned on `main` after each
squash-merge). ⚠️ The local Claude's `train.py`/`eval.py`/build-workflow-clamp
changes live on `claude/build-workflow-engines` — **cherry-pick those to main; do
NOT merge that branch whole** (it's based on old main and would delete ~386k lines).
