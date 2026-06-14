"""QLoRA fine-tune Qwen2.5-7B-Instruct on the workflow data, then export GGUF
for Ollama. Tuned to fit a 16 GB GPU.

Run on your CUDA box (NOT in CI):
    pip install -r requirements-train.txt        # see README for the Unsloth note
    python train.py
Outputs:
    lora_model/      LoRA adapter + tokenizer
    gguf_model/      merged Q4_K_M GGUF + a ready Ollama Modelfile

VRAM: Qwen2.5-7B QLoRA at seq 2048 / batch 2 sits well under 16 GB. If you OOM,
drop MAX_SEQ to 1536 or BATCH to 1 (bump GRAD_ACCUM to keep the effective batch).
"""
from __future__ import annotations

import os
from pathlib import Path

from datasets import load_dataset
from trl import SFTConfig, SFTTrainer
from unsloth import FastLanguageModel
from unsloth.chat_templates import train_on_responses_only

HERE = Path(__file__).parent

# Config via env so the SAME script does 7B locally or 14B on a rented GPU.
# 14B on a 24GB+ box:  GF_BASE=unsloth/Qwen2.5-14B-Instruct GF_BATCH=1 GF_GRAD_ACCUM=8 python train.py
BASE = os.environ.get("GF_BASE", "unsloth/Qwen2.5-7B-Instruct")
MAX_SEQ = int(os.environ.get("GF_MAX_SEQ", "2048"))
BATCH = int(os.environ.get("GF_BATCH", "2"))
GRAD_ACCUM = int(os.environ.get("GF_GRAD_ACCUM", "4"))
EPOCHS = int(os.environ.get("GF_EPOCHS", "3"))
LR = float(os.environ.get("GF_LR", "2e-4"))


def to_text(tokenizer):
    def _fmt(ex):
        messages = [
            {"role": "system", "content": ex["system"]},
            {"role": "user", "content": ex["user"]},
            {"role": "assistant", "content": ex["assistant"]},
        ]
        return {"text": tokenizer.apply_chat_template(messages, tokenize=False)}
    return _fmt


def main() -> None:
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=BASE, max_seq_length=MAX_SEQ, load_in_4bit=True, dtype=None,
    )
    model = FastLanguageModel.get_peft_model(
        model, r=16, lora_alpha=16, lora_dropout=0.0, bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth", random_state=3407,
    )

    ds = load_dataset("json", data_files=str(HERE / "data" / "train.jsonl"), split="train")
    ds = ds.map(to_text(tokenizer))

    trainer = SFTTrainer(
        model=model, tokenizer=tokenizer, train_dataset=ds,
        args=SFTConfig(
            per_device_train_batch_size=BATCH, gradient_accumulation_steps=GRAD_ACCUM,
            warmup_steps=5, num_train_epochs=EPOCHS, learning_rate=LR,
            logging_steps=5, optim="adamw_8bit", weight_decay=0.01,
            lr_scheduler_type="linear", seed=3407, output_dir=str(HERE / "outputs"),
            max_seq_length=MAX_SEQ, dataset_text_field="text", report_to="none",
        ),
    )
    # Only compute loss on the assistant's JSON, not the prompt — sharper learning.
    trainer = train_on_responses_only(
        trainer,
        instruction_part="<|im_start|>user\n",
        response_part="<|im_start|>assistant\n",
    )
    trainer.train()

    model.save_pretrained(str(HERE / "lora_model"))
    tokenizer.save_pretrained(str(HERE / "lora_model"))
    # Merge + quantize to GGUF and drop an Ollama Modelfile next to it.
    model.save_pretrained_gguf(str(HERE / "gguf_model"), tokenizer, quantization_method="q4_k_m")
    print("done -> lora_model/ and gguf_model/ (see README to load into Ollama)")


if __name__ == "__main__":
    main()
