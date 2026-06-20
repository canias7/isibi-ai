# make_finetune_data.py — export the 54-skill recipe as instruction-tuning data for Qwen.
# Writes chat-format JSONL (system / user / assistant) that QLoRA fine-tuning consumes.
#   python make_finetune_data.py            (200k examples -> excel_ft.jsonl)
#   N=500000 python make_finetune_data.py
#
# Fine-tuning a PRETRAINED model needs far less data than training from scratch — the model
# already knows language and reasoning; we're only teaching the Excel mapping + house style.
import json, os, random
import make_data as M

N = int(os.environ.get("N", 200_000))
SYS = ("You are an expert Excel and accounting assistant. Answer with the formula, the spec, "
       "or a short plain-English reply only — no preamble.")

with open("excel_ft.jsonl", "w", encoding="utf-8") as f:
    for _ in range(N):
        q, a = M.sample()
        rec = {"messages": [
            {"role": "system", "content": SYS},
            {"role": "user", "content": q},
            {"role": "assistant", "content": a},
        ]}
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

print(f"wrote {N} chat examples to excel_ft.jsonl  ({len(M.MODES)} skills)")
