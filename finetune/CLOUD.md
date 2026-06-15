# Cloud training (14B QLoRA on a rented GPU)

Your 16GB card serves a 14B fine but **training** it is tight. Rent a 24GB+ GPU
for the one-time training run, then **serve the result locally** (serving is the
easy part). Cost: roughly **$1–3 per run** (a 4090 at ~$0.40/hr × 1–3 hrs).

> ⚠️ **Disk, not just VRAM, is the gotcha — and it's the *Container Disk*.**
> The GGUF export at the end merges the LoRA into the full-precision 14B and
> quantizes it — that needs **~60–65GB of scratch** on top of the base image.
> RunPod has **two** disks: **Container Disk** (mounts at `/`) and **Volume
> Disk** (mounts at `/workspace`). A plain `git clone` lands the repo under `/`,
> so the export writes to the **Container Disk** — bumping only the Volume does
> nothing. Set **Container Disk ≥150GB (use 200GB to be safe)** *before* deploy.
> Otherwise training finishes and then dies with `No space left on device (os
> error 28)` at the export. (See Notes for recovery without retraining.)

The training scripts take config via env, so the same code does 7B or 14B. The
**runner and chat share the same shape** — same script form, same env:

| env | builder default | runner / chat default | 14B suggestion |
|---|---|---|---|
| `GF_BASE` | `unsloth/Qwen2.5-7B-Instruct` | same | `unsloth/Qwen2.5-14B-Instruct` |
| `GF_MAX_SEQ` | 2048 | 4096 | builder 2048 · runner/chat 3072 |
| `GF_BATCH` | 2 | 1 | 1 |
| `GF_GRAD_ACCUM` | 4 | 8 | 8–16 |

## Steps

**1. Rent a GPU** — RunPod / Vast.ai / Lambda, **24GB+ VRAM** (RTX 4090 or A5000
is cheapest sufficient; A100 if you want speed). Pick a PyTorch/CUDA template.
On RunPod, bump the **Container Disk** slider (NOT the Volume — see the warning
above; the repo clones to `/`) from the default ~80GB to **200GB** *before*
deploying; you can't grow it mid-run. Sanity-check on the box with `df -h .` —
the mount holding the repo should show ~150G+ free.

**2. Get the repo + data onto it.** The training data is **committed on the
feature branch**, so a plain clone brings it — no teacher key needed on the box:
```bash
git clone <repo> && cd isibi-ai/finetune
git checkout claude/zealous-sagan-TA5qG     # the branch carrying data/, runner_data/, chat_data/
# sanity: each should print a few hundred lines
wc -l data/train.jsonl runner_data/train.jsonl chat_data/train.jsonl
```
(Only if you want to *regenerate* — the teacher is **Anthropic**, not Gemini:
`ANTHROPIC_API_KEY=... python runner_gen.py --n 400`. The committed data is the
fast path; skip this.)

**3. Train** (the script installs deps, checks data, trains, exports GGUF):
```bash
bash train_cloud.sh                  # 14B builder  -> gguf_model/
bash train_cloud.sh runner_train.py  # 14B runner   -> runner_gguf/
bash train_cloud.sh chat_train.py    # 14B chat     -> chat_gguf/
```
Override anything inline, e.g. `GF_MAX_SEQ=3072 bash train_cloud.sh runner_train.py`,
or `GF_BASE=unsloth/Qwen2.5-7B-Instruct bash train_cloud.sh` to stay 7B. Runner
and chat both want `GF_MAX_SEQ=3072` at 14B. You can run all three back-to-back on
the **same pod** (one rental) — they don't collide.

**4. Bring the model home + serve locally:**
```bash
# from the rented box, download the GGUF dir (gguf_model/, runner_gguf/, chat_gguf/)
# then on YOUR box, into Ollama:
cd gguf_model  && ollama create gf-workflows -f Modelfile   # builder
cd runner_gguf && ollama create gf-runner    -f Modelfile   # runner
cd chat_gguf   && ollama create gf-chat      -f Modelfile   # chat
```
Your existing Cloudflare tunnel + `model.gofarther.dev` serve them unchanged — the
edge functions just keep calling `gf-workflows` / `gf-runner` / `gf-chat`.

## What to put where
- **Builder** → 7B is already enough (grammar makes it 100% structural); only go
  14B here if you want sharper instructions.
- **Runner + chat** → this is where 14B earns its keep (agentic multi-tool
  reasoning). Train these at 14B; keep the builder 7B if you like.

## Notes
- **Disk size is non-negotiable for 14B — and it must be the Container Disk.**
  Training itself fits ~80GB, but the final `save_pretrained_gguf` merges the
  adapter into the full fp16 14B (~30GB), converts to an f16 GGUF (~30GB), then
  quantizes to q4 (~9GB) — peak ~60–65GB free, on the disk holding the repo.
  Since `git clone` lands under `/` (the **Container Disk**), bumping only the
  `/workspace` **Volume** does nothing. Too small and you get `RuntimeError:
  Failed to save/merge model: ... no disk space left!` **after a successful
  train** (the `*_lora/` adapter is saved; only the export dies). Two recoveries
  that skip retraining:
    - Re-export from the saved adapter onto a mount that *does* have room:
      ```bash
      python - <<'PY'
      from unsloth import FastLanguageModel
      m, t = FastLanguageModel.from_pretrained("runner_lora", max_seq_length=3072, load_in_4bit=True, dtype=None)
      m.save_pretrained_gguf("/workspace/runner_gguf", t, quantization_method="q4_k_m")
      PY
      ```
    - Or `runpodctl send runner_lora` to pull the ~300MB adapter off-pod, then
      redeploy with a 200GB Container Disk (or convert to GGUF on a roomy box).
- **Long traces get dropped, not errored.** Runner/chat traces with big tool
  lists can exceed `GF_MAX_SEQ` and are silently skipped — watch the "X of Y
  samples" line. If too many drop, lower the tool count per trace (regen) rather
  than just raising seq, which costs VRAM.
- **Checkpoint on spot instances** (Vast community) — they can be reclaimed
  mid-run; `outputs/` holds intermediate checkpoints.
- The **teacher key** (Anthropic, for data gen) is the gating cost for model
  *quality* — the GPU time itself is a couple dollars. Data is already committed,
  so you only pay this if you regenerate.
- 32B won't fit a 16GB card even to **serve** (~18–20GB at Q4), so 14B is the
  ceiling for local serving on the 5060 Ti.
