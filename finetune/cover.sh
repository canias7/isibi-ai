#!/usr/bin/env bash
# Builder coverage retrain for the FULL ~1043-app Composio universe.
#
# Order that matters: rebuild the catalog -> GATE on full coverage -> only then
# generate data (so you never spend Anthropic credits against a half-built
# catalog) -> hand off to train+eval.
#
# Requires (env):
#   COMPOSIO_API_KEY   rotate the exposed one first
#   ANTHROPIC_API_KEY  top up credits first
# Optional (env):
#   COVER_TARGET   examples/app to aim for      (default 3)
#   GEN_N          examples to generate          (default = exact deficit to target)
#   TEACHER_MODEL  Anthropic teacher             (default claude-opus-4-8)
#   CONFIRM=1      skip the "spend credits?" prompt (non-interactive)
#
# Usage:
#   COMPOSIO_API_KEY=ak_... ANTHROPIC_API_KEY=sk-... bash finetune/cover.sh
set -euo pipefail
cd "$(dirname "$0")"            # -> finetune/

: "${COMPOSIO_API_KEY:?set COMPOSIO_API_KEY (rotate the exposed one first)}"
: "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY (top up credits first)}"
COVER_TARGET="${COVER_TARGET:-3}"
TEACHER_MODEL="${TEACHER_MODEL:-claude-opus-4-8}"

echo "==> 1/4  Rebuild catalog to the full Composio universe (both passes)…"
python build_universe_catalog.py

echo "==> 2/4  Coverage GATE — must be full, or we stop before spending credits…"
if ! python build_universe_catalog.py --check; then
  echo "ABORT: catalog did not reach full coverage. Fix the rebuild (check the Composio key / network) before generating data." >&2
  exit 1
fi

echo "==> Coverage report (target ${COVER_TARGET}):"
python gen_data.py --coverage --cover-target "${COVER_TARGET}"

# Default GEN_N = the exact teacher-builds deficit to reach the target.
if [ -z "${GEN_N:-}" ]; then
  GEN_N="$(python - <<PY
from gen_data import frontend_id, app_coverage, _read, DATA
from catalog import ALLOWED
cov = app_coverage(_read(DATA / "train.jsonl") + _read(DATA / "val.jsonl"))
ids = [frontend_id(s) for s in ALLOWED]
print(sum(max(0, ${COVER_TARGET} - cov.get(f, 0)) for f in ids))
PY
)"
fi

echo
echo "==> 3/4  Generate ${GEN_N} coverage examples with ${TEACHER_MODEL}."
echo "    This SPENDS Anthropic credits and targets only new/under-covered apps."
if [ "${CONFIRM:-}" != "1" ]; then
  read -r -p "Proceed (~${GEN_N} teacher builds)? [y/N] " ans
  [ "${ans:-N}" = "y" ] || { echo "stopped before generating (no credits spent)."; exit 0; }
fi

TEACHER=anthropic TEACHER_MODEL="${TEACHER_MODEL}" \
  python gen_data.py --n "${GEN_N}" --append --cover-target "${COVER_TARGET}"

echo
echo "==> 4/4  Data ready. Train + load + eval (your usual flow):"
cat <<'NEXT'
  # NOTE: train.py exports q4_k_m. Your live builder is q8_0 — to match, set
  #       quantization_method="q8_0" in train.py before running.
  python train.py
  ollama create gf-workflows -f gguf_model/Modelfile
  python eval.py --model gf-workflows
  python eval.py --model gf-workflows --restrict-apps
NEXT
echo "done — coverage data generated for the full universe."
