# Fine-tune Qwen on the Excel recipe (the "smart coworker" path)

This keeps Qwen's general intelligence and teaches it our 54 skills. Runs on a 16GB
card via QLoRA (4-bit base + small LoRA adapters). The data recipe (`make_data.py`)
and the add-in are reused unchanged — only the model engine changes.

> Note: your Ollama / LM Studio copy of Qwen is a quantized **inference** build (GGUF)
> and is **not** used here. Fine-tuning pulls the Hugging Face version automatically.

## One-time setup (on the PC)
```powershell
cd "ai trial\excel"
pip install unsloth trl datasets
```
(unsloth installs a matching torch + bitsandbytes. Needs an NVIDIA GPU.)

## 3 steps
```powershell
# 1) export the recipe as instruction data (fine-tuning needs far less than from-scratch)
set N=200000
python make_finetune_data.py        # -> excel_ft.jsonl

# 2) QLoRA fine-tune Qwen2.5-7B-Instruct (auto-downloads the 4-bit base, ~5GB)
python finetune_qwen.py             # -> qwen_excel_lora/   (hours on 16GB)

# 3) serve it behind the SAME API the add-in uses
python serve_qwen.py                # http://127.0.0.1:8000
```
Then sideload the add-in as usual (`addin/manifest.xml`) — it talks to the same
endpoint, so nothing in the add-in changes.

## Why this is the smart path
- Qwen already learned language + reasoning from trillions of tokens. You inherit that.
- Fine-tuning only teaches the **mapping** (request -> formula/spec) and the house style.
- ~200k examples is plenty — the model isn't learning English from scratch, just our task.

## Knobs
- `BASE` — swap the base model. 7B is `unsloth/Qwen2.5-7B-Instruct-bnb-4bit`; for an
  easier/faster run use `unsloth/Qwen2.5-3B-Instruct-bnb-4bit`.
- `EPOCHS` (default 1), `MAXSEQ` (default 768), `N` (examples to generate).

## If you hit trouble
- **OOM during training:** lower `per_device_train_batch_size` to 1 in finetune_qwen.py
  (raise `gradient_accumulation_steps` to keep the effective batch), or use the 3B base.
- **unsloth install issues on Windows:** use the plain-transformers fallback instead —
  same QLoRA, more portable:
  ```powershell
  pip install transformers peft bitsandbytes trl datasets accelerate
  python make_finetune_data.py
  python finetune_qwen_hf.py      # -> qwen_excel_lora/
  python serve_qwen_hf.py         # serve base Qwen + adapter
  ```
  (Downloads the full ~15GB Qwen and 4-bit quantizes on load. If `trl` complains about
  `SFTConfig`/`processing_class` args, that's a version difference — paste the error and
  I'll match it to your installed trl/transformers versions.)

## How this differs from the from-scratch model
| | From-scratch (`train_resumable.py`) | Fine-tune (this) |
|---|---|---|
| Knows | only Excel (our data) | everything Qwen knows + our Excel skills |
| Reasoning / conversation | narrow | full |
| Size | 50M–1B you train | 7B you inherit + tiny adapter |
| "From scratch"? | yes | no — stands on Qwen |

Both share `make_data.py` and the add-in. Pick based on whether you want *owned + tiny*
or *actually smart*.
