# finetune_qwen_hf.py — QLoRA fine-tune with plain transformers + peft + bitsandbytes + trl.
# Fallback for when unsloth won't install (e.g. on Windows). Same QLoRA idea, more portable.
#   pip install transformers peft bitsandbytes trl datasets accelerate
#   python make_finetune_data.py
#   python finetune_qwen_hf.py        # -> qwen_excel_lora/
#
# Note: this downloads the full Qwen weights (~15GB) and quantizes to 4-bit on load
# (unsloth's pre-quantized base is smaller). Needs an NVIDIA GPU; 7B QLoRA fits ~16GB.

import os, torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import LoraConfig, prepare_model_for_kbit_training, get_peft_model
from trl import SFTTrainer, SFTConfig

BASE    = os.environ.get("BASE", "Qwen/Qwen2.5-7B-Instruct")   # set to Qwen2.5-3B-Instruct for an easier run
MAX_SEQ = int(os.environ.get("MAXSEQ", 768))
EPOCHS  = float(os.environ.get("EPOCHS", 1))

bnb = BitsAndBytesConfig(
    load_in_4bit=True, bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True,
)
tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(BASE, quantization_config=bnb, device_map="auto")
model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
model = get_peft_model(model, LoraConfig(
    r=16, lora_alpha=16, lora_dropout=0.0, bias="none", task_type="CAUSAL_LM",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
))

ds = load_dataset("json", data_files="excel_ft.jsonl", split="train")
def fmt(ex):
    return {"text": tok.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False)}
ds = ds.map(fmt, remove_columns=ds.column_names)

trainer = SFTTrainer(
    model=model, processing_class=tok, train_dataset=ds,
    args=SFTConfig(
        per_device_train_batch_size=1, gradient_accumulation_steps=16,   # effective batch 16
        warmup_steps=50, num_train_epochs=EPOCHS, learning_rate=2e-4,
        bf16=True, optim="paged_adamw_8bit", weight_decay=0.01, lr_scheduler_type="linear",
        logging_steps=20, save_steps=500, output_dir="qwen_excel_lora", report_to="none",
        gradient_checkpointing=True, max_seq_length=MAX_SEQ, dataset_text_field="text", packing=False,
    ),
)
trainer.train()
model.save_pretrained("qwen_excel_lora")
tok.save_pretrained("qwen_excel_lora")
print("done -> qwen_excel_lora/")
