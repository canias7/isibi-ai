# Cloud training (14B QLoRA on a rented GPU)

Your 16GB card serves a 14B fine but **training** it is tight. Rent a 24GB+ GPU
for the one-time training run, then **serve the result locally** (serving is the
easy part). Cost: roughly **$1–3 per run** (a 4090 at ~$0.40/hr × 1–3 hrs).

The training scripts take config via env, so the same code does 7B or 14B:

| env | builder default | runner default | 14B suggestion |
|---|---|---|---|
| `GF_BASE` | `unsloth/Qwen2.5-7B-Instruct` | same | `unsloth/Qwen2.5-14B-Instruct` |
| `GF_MAX_SEQ` | 2048 | 4096 | builder 2048 · runner 3072 |
| `GF_BATCH` | 2 | 1 | 1 |
| `GF_GRAD_ACCUM` | 4 | 8 | 8–16 |

## Steps

**1. Rent a GPU** — RunPod / Vast.ai / Lambda, **24GB+** (RTX 4090 or A5000 is
cheapest sufficient; A100 if you want speed). Pick a PyTorch/CUDA template.

**2. Get the repo + data onto it.** Data is gitignored, so bring it:
```bash
git clone <repo> && cd isibi-ai/finetune
# Option A — generate on the box (needs a teacher key):
GEMINI_API_KEY=...  python gen_data.py --gemini --n 500        # builder data
GEMINI_API_KEY=...  python runner_gen.py --gemini --n 400      # runner data
# Option B — upload data you generated elsewhere:
#   scp -r data runner_data  root@<box>:/workspace/isibi-ai/finetune/
```

**3. Train** (the script installs deps, checks data, trains, exports GGUF):
```bash
bash train_cloud.sh                  # 14B builder  -> gguf_model/
bash train_cloud.sh runner_train.py  # 14B runner   -> runner_gguf/
```
Override anything inline, e.g. `GF_MAX_SEQ=3072 bash train_cloud.sh runner_train.py`,
or `GF_BASE=unsloth/Qwen2.5-7B-Instruct bash train_cloud.sh` to stay 7B.

**4. Bring the model home + serve locally:**
```bash
# from the rented box, download the GGUF dir (gguf_model/ or runner_gguf/)
# then on YOUR box, into Ollama:
cd gguf_model && ollama create gf-workflows -f Modelfile    # builder
# (runner: ollama create gf-runner -f runner_gguf/Modelfile)
```
Your existing Cloudflare tunnel + `model.gofarther.dev` serve it unchanged — the
edge functions just keep calling `gf-workflows` / `gf-runner`.

## What to put where
- **Builder** → 7B is already enough (grammar makes it 100% structural); only go
  14B here if you want sharper instructions.
- **Runner + chat** → this is where 14B earns its keep (agentic multi-tool
  reasoning). Train these at 14B; keep the builder 7B if you like.

## Notes
- **Checkpoint on spot instances** (Vast community) — they can be reclaimed
  mid-run; `outputs/` holds intermediate checkpoints.
- The **teacher key** (data gen) is still the gating cost for model *quality* —
  the GPU time itself is a couple dollars.
- 32B won't fit a 16GB card even to **serve** (~18–20GB at Q4), so 14B is the
  ceiling for local serving on the 5060 Ti.
