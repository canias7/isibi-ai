"""QLoRA fine-tune for the workflow RUNNER (phase 2).

Trains on the multi-turn tool-calling traces from runner_gen.py. Mirrors train.py
but formats each trace (messages + tools) through the chat template and trains
ONLY on the assistant turns (the tool-call decisions + final summary), masking the
system / user / tool-result turns.

Run on the 16GB GPU box after generating runner_data/ with runner_gen.py.
VRAM note: traces are longer than single-shot emits, so this uses batch 1 /
grad-accum 8 / seq 4096. Lower MAX_SEQ if you OOM.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

# Unsloth must be imported BEFORE trl/transformers so its patches apply (the
# trl-0.24 SFTTrainer fix); otherwise the '<EOS_TOKEN>' sentinel can leak through.
from unsloth import FastLanguageModel
from unsloth.chat_templates import train_on_responses_only

from datasets import Dataset
from trl import SFTConfig, SFTTrainer

HERE = Path(__file__).parent

# Config via env so the same script does 7B locally or 14B on a rented GPU.
# 14B (24GB+):  GF_BASE=unsloth/Qwen2.5-14B-Instruct GF_MAX_SEQ=3072 python runner_train.py
BASE = os.environ.get("GF_BASE", "unsloth/Qwen2.5-7B-Instruct")
MAX_SEQ = int(os.environ.get("GF_MAX_SEQ", "4096"))   # tool-use traces run longer than builder emits
BATCH = int(os.environ.get("GF_BATCH", "1"))
GRAD_ACCUM = int(os.environ.get("GF_GRAD_ACCUM", "8"))
EPOCHS = int(os.environ.get("GF_EPOCHS", "3"))


def main() -> None:
    model, tok = FastLanguageModel.from_pretrained(
        model_name=BASE, max_seq_length=MAX_SEQ, load_in_4bit=True, dtype=None,
    )
    model = FastLanguageModel.get_peft_model(
        model, r=16, lora_alpha=16, lora_dropout=0.0, bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth", random_state=3407,
    )
    # Build the dataset in Python, not load_dataset("json"): per-tool JSON schemas
    # vary across rows (an enum that's a string in one tool, a number in another),
    # which pyarrow's schema inference rejects. The chat template renders the
    # varying tools fine; keep only the flat rendered "text" column.
    rows = [json.loads(l) for l in (HERE / "runner_data" / "train.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    ds = Dataset.from_dict({"text": [
        tok.apply_chat_template(r["messages"], tools=r.get("tools"), tokenize=False) for r in rows]})

    trainer = SFTTrainer(
        model=model, processing_class=tok, train_dataset=ds,
        args=SFTConfig(
            per_device_train_batch_size=BATCH, gradient_accumulation_steps=GRAD_ACCUM,
            warmup_steps=5, num_train_epochs=EPOCHS, learning_rate=2e-4,
            logging_steps=5, optim="adamw_8bit", weight_decay=0.01,
            lr_scheduler_type="linear", seed=3407, output_dir=str(HERE / "runner_outputs"),
            max_length=MAX_SEQ, dataset_text_field="text", report_to="none",
        ),
    )
    # Train only on assistant turns (tool calls + final) — mask user/tool turns.
    trainer = train_on_responses_only(
        trainer,
        instruction_part="<|im_start|>user\n",
        response_part="<|im_start|>assistant\n",
    )
    trainer.train()

    model.save_pretrained(str(HERE / "runner_lora"))
    tok.save_pretrained(str(HERE / "runner_lora"))
    model.save_pretrained_gguf(str(HERE / "runner_gguf"), tok, quantization_method="q4_k_m")
    print("done -> runner_lora/ and runner_gguf/ (load into Ollama as a second model)")


if __name__ == "__main__":
    main()
