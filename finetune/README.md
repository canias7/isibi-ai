# Go Farther — workflow model fine-tune

Distill a strong teacher (Claude Sonnet by default) into a small open model
(**Qwen2.5-7B-Instruct**) that authors workflows in this app's exact
`emit_workflow` JSON shape and chains the real tool catalog. Sized to train on a
**16 GB** GPU with QLoRA.

## What to expect (read this first)

A 7B won't match Sonnet in general. But this is a **narrow** task — emit a valid
workflow in a fixed schema over a fixed tool catalog — and on a narrow task a
distilled 7B gets genuinely close to its teacher. Plan for:

- **Workflow building (this scaffold):** high hit-rate once you have a few
  thousand clean examples. Easy to measure (does it validate?).
- **Multi-tool *execution* (the runner):** harder — it's multi-turn and agentic.
  A 7B is solid on 2–3 tool chains, shaky on long/branching ones. Do this
  **second**, and keep Sonnet as the fallback for the hard cases.

Quality tracks your **data**, not your hyperparameters. More clean teacher
examples beats any knob here.

## Layout

| File | Role |
|------|------|
| `catalog.py` | The real connectors + tools (verbatim from `gofarther-mcp`) and the connector-id aliases. The single source to tweak if an id drifts. |
| `schema.py` | Workflow JSON schema (mirrors `build-workflow`) + a strict validator, used to filter data and to score eval. |
| `gen_data.py` | Distill: teacher brainstorms requests → builds `emit_workflow` JSON → validate → write `data/{train,val}.jsonl`. |
| `train.py` | Unsloth QLoRA on Qwen2.5-7B → `lora_model/` + `gguf_model/` (Q4_K_M + Ollama Modelfile). |
| `eval.py` | Run a served model over the val set; report % valid JSON / schema-valid / apps-connected. |

## Prereqs

- **Data gen / eval:** any machine. `pip install -r requirements.txt`
- **Training:** your 16 GB CUDA GPU. Install Unsloth per
  <https://github.com/unslothai/unsloth#installation>, then
  `pip install -r requirements-train.txt`.

## 1 — Generate data

Pick a teacher. Sonnet gives the best students (a few dollars → thousands of
examples). Groq's free Llama-70B works as a $0 alternative with a lower ceiling.

```bash
# Claude Sonnet teacher (recommended)
TEACHER=anthropic ANTHROPIC_API_KEY=sk-ant-... python gen_data.py --n 2000

# OR free Groq Llama-3.3-70B teacher — free signup at console.groq.com
# (--groq presets the Groq endpoint + model; just provide the key)
GROQ_API_KEY=gsk_... python gen_data.py --n 1500 --groq
```

Groq's free tier rate-limits, so a big run may pause/retry (handled with backoff)
or hit a daily cap — the run checkpoints every example to `data/all.jsonl`, so
just re-run to resume. Split into a few `--n` batches if you hit the daily limit.

Every example is validated against the real schema before it's kept, so the
student only ever learns clean targets. Start with `--n 50` to sanity-check the
pipeline, then scale up. Offline wiring check (no key needed):
`python gen_data.py --selftest`.

## 2 — Train (16 GB GPU)

```bash
python train.py
```

Produces `lora_model/` (adapter) and `gguf_model/` (merged Q4_K_M + a Modelfile).
OOM? Lower `MAX_SEQ` to 1536 or `BATCH` to 1 in `train.py`. 7B is the sweet spot
for 16 GB; 14B only if you trim sequence length hard.

## 3 — Serve with Ollama

```bash
cd gguf_model
ollama create gf-workflows -f Modelfile     # Unsloth writes the Modelfile for you
ollama run gf-workflows "Every morning email me a digest of unread Gmail"
```

Ollama exposes an OpenAI-compatible endpoint at
`http://localhost:11434/v1/chat/completions`.

## 4 — Expose it to the app

The chat/builder runs in Supabase's cloud, so it can't reach `localhost`. Tunnel
your machine (free, stable URL):

```bash
cloudflared tunnel --url http://localhost:11434
# -> https://something.trycloudflare.com   (this is your OpenAI-compatible base)
```

Keep the box + tunnel up while the app needs the model. For real users, move
serving to a cloud GPU instead of a home machine.

## 5 — Wire into the app

`build-workflow` currently calls Anthropic to emit workflows. To use your model,
point that function at your endpoint (OpenAI-compatible `chat/completions` with
the `emit_workflow` tool) and set secrets:

```bash
# in Supabase project secrets
WORKFLOW_MODEL_BASE_URL=https://something.trycloudflare.com/v1
WORKFLOW_MODEL_NAME=gf-workflows
WORKFLOW_MODEL_KEY=ollama
```

Tell me when your endpoint is live and I'll do the `build-workflow` edit + deploy
(backend deploy via Supabase — independent of the app's OTA). Recommended shape:
**your model primary for building, Sonnet as fallback** when its output fails
`schema.py` validation — so a bad emit never reaches the user.

## 6 — Evaluate

```bash
# fine-tuned vs. stock baseline
python eval.py --base-url http://localhost:11434/v1 --model gf-workflows
python eval.py --base-url http://localhost:11434/v1 --model qwen2.5:7b-instruct
```

Watch schema-valid % climb over the baseline as you add data. When building is
solid, the next dataset is multi-turn tool-use traces for the **runner** — same
distillation idea, harder target.
