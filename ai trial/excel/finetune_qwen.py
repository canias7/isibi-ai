# finetune_qwen.py — QLoRA fine-tune Qwen2.5-7B-Instruct on the Excel data.
# Fits a 16GB GPU (4-bit base + small LoRA adapters). Runs on the PC, not here.
#
# One-time setup:
#   pip install unsloth trl datasets
# Then:
#   python make_finetune_data.py        # writes excel_ft.jsonl
#   python finetune_qwen.py             # trains the adapter -> qwen_excel_lora/
#
# It auto-downloads the right (HF) Qwen — your Ollama/GGUF copy is inference-only and not used here.

import os, torch
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

MAX_SEQ = int(os.environ.get("MAXSEQ", 768))   # covers our longest Q+A with room to spare
BASE    = os.environ.get("BASE", "unsloth/Qwen2.5-7B-Instruct-bnb-4bit")  # pre-quantized 4-bit
EPOCHS  = float(os.environ.get("EPOCHS", 1))

# 1) load the 4-bit base
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=BASE, max_seq_length=MAX_SEQ, dtype=None, load_in_4bit=True,
)

# 2) attach LoRA adapters (the only weights we train)
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=16, lora_dropout=0.0, bias="none",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth", random_state=42,
)

# 3) our data -> the model's chat template
ds = load_dataset("json", data_files="excel_ft.jsonl", split="train")
def fmt(ex):
    return {"text": tokenizer.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False)}
ds = ds.map(fmt, remove_columns=ds.column_names)

# 4) train
trainer = SFTTrainer(
    model=model, tokenizer=tokenizer, train_dataset=ds,
    dataset_text_field="text", max_seq_length=MAX_SEQ, packing=False,
    args=TrainingArguments(
        per_device_train_batch_size=2, gradient_accumulation_steps=8,   # effective batch 16
        warmup_steps=50, num_train_epochs=EPOCHS, learning_rate=2e-4,
        bf16=torch.cuda.is_bf16_supported(), fp16=not torch.cuda.is_bf16_supported(),
        optim="adamw_8bit", weight_decay=0.01, lr_scheduler_type="linear",
        logging_steps=20, save_steps=500, output_dir="qwen_excel_lora", report_to="none",
    ),
)
trainer.train()

# 5) save the adapter
model.save_pretrained("qwen_excel_lora")
tokenizer.save_pretrained("qwen_excel_lora")
print("done -> qwen_excel_lora/  (LoRA adapter; load it on top of Qwen2.5-7B-Instruct to serve)")
