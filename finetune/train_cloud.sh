#!/usr/bin/env bash
# Turnkey QLoRA training on a fresh rented GPU (RunPod / Vast.ai / Lambda).
# Defaults to a 14B builder run; pass a different script + env for the runner.
#
#   bash train_cloud.sh                 # 14B builder  -> gguf_model/
#   bash train_cloud.sh runner_train.py # 14B runner   -> runner_gguf/
#
# Override anything via env, e.g.:
#   GF_BASE=unsloth/Qwen2.5-7B-Instruct bash train_cloud.sh        # 7B instead
#   GF_MAX_SEQ=3072 GF_GRAD_ACCUM=16  bash train_cloud.sh runner_train.py
set -euo pipefail
cd "$(dirname "$0")"

SCRIPT="${1:-train.py}"
# 14B fits a 24GB+ card at batch 1; bump grad-accum to keep the effective batch.
export GF_BASE="${GF_BASE:-unsloth/Qwen2.5-14B-Instruct}"
export GF_BATCH="${GF_BATCH:-1}"
export GF_GRAD_ACCUM="${GF_GRAD_ACCUM:-8}"

echo "==> system deps (cmake/gcc for the GGUF export)"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y >/dev/null && apt-get install -y build-essential cmake git >/dev/null || true
fi

echo "==> python deps"
pip install -U pip >/dev/null
pip install -r requirements-train.txt

# Data is gitignored — it must already be here (generated with a teacher key, or
# uploaded). Builder needs data/train.jsonl; runner needs runner_data/train.jsonl.
DATA="data/train.jsonl"; [ "$SCRIPT" = "runner_train.py" ] && DATA="runner_data/train.jsonl"
if [ ! -f "$DATA" ]; then
  echo "!! missing $DATA — generate it first (see CLOUD.md step 2) or scp it up." >&2
  exit 1
fi

echo "==> training $GF_BASE  ($SCRIPT, batch=$GF_BATCH x accum=$GF_GRAD_ACCUM)"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
time python "$SCRIPT"

echo "==> done. GGUF is in gguf_model/ (builder) or runner_gguf/ (runner)."
echo "    Download it, then load into your local Ollama (see CLOUD.md step 4)."
