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

## Builder serving — managed serverless LoRA on Together (investigation, 2026-06)

Production-hardening option: host the trained builder **adapter** managed (always-up,
scales) instead of the free-but-home-PC-dependent local Ollama. Optional — the builder
runs free locally today.

**Provider verdict:**
- **Fireworks ❌** — custom LoRA adapters are *dedicated-deploy only*; no serverless.
- **Together ✅** — "Serverless Multi-LoRA": upload the adapter, serve serverless
  per-token. Base `Qwen/Qwen2.5-7B-Instruct(-Turbo)`. Upload the **LoRA adapter**
  (`lora_model/`, ~323 MB, r=32) — **not** the GGUF.

**Empirical findings** (base Qwen2.5-7B on Together, 7 runs — `json_schema`/grammar
**works**, 6/7 clean). The two production rules, learned the hard way:
1. **Retry-once on `failed to compile grammar` (422)** — a one-time cold-start while
   Together compiles a *novel* schema; the identical call succeeds right after. The
   deployed builder MUST retry-once on this when pointed at Together.
2. **No `additionalProperties:false` on NESTED objects** — it consistently breaks
   Together's grammar compiler. Top-level only. (The deployed `WF_SCHEMA` is already
   top-level-only ✅.)

**CONCLUSIVE (2026-06): Together CANNOT serverless-host a Qwen2.5 LoRA.** Their
serverless-LoRA program only supports specific curated bases — **Qwen3-8B /
Qwen3-30B / Qwen3.5-35B, Llama-3.3-70B, Llama-4-Scout, Mixtral-8x7B, Gemma-3** —
**no Qwen2.5 base exists**, and all three Qwen2.5-7B ids reject the adapter
("Base model does not support LoRA adapters"). A Qwen2.5 adapter also can't attach
to a Qwen3 base (different arch). Separately, *uploaded custom* adapters deploy
**dedicated, not serverless** anyway. What DID validate: the HF push works, and
**base-model grammar on Together is solid** (Step 2 — see the two rules above). The
blocker is purely the Qwen2.5-adapter incompatibility — **not grammar, not schema**.

**Paths to a managed builder, if ever wanted:**
- **True serverless** → retrain a LoRA on **Qwen3-8B** (serverless-LoRA-supported,
  newer base) using the existing 4,112-example dataset. The only scale-to-zero route.
- **Dedicated** → merge the Qwen2.5 adapter into full weights, run a Together
  *dedicated* endpoint (per-hour GPU, ~$700+/mo) — economically pointless vs the
  free local builder.
- **Decision: stay self-hosted (Ollama) for the builder** — free + works; managed
  isn't worth a Qwen3 retrain while local is fine. The running Qwen2.5 coverage
  retrain is correct for its Ollama target (unaffected).

> The **runner → managed MoE** plan is **UNAFFECTED** — it uses an off-the-shelf
> hosted MoE (no custom adapter, no upload), so none of this Qwen2.5/LoRA limit applies.

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
