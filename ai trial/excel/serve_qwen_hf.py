# serve_qwen_hf.py — serve base Qwen + the trained LoRA adapter (plain transformers + peft).
# Matches the finetune_qwen_hf.py path. Same /formula API as the add-in expects.
#   pip install transformers peft bitsandbytes accelerate
#   python serve_qwen_hf.py
import json, os, torch
from http.server import BaseHTTPRequestHandler, HTTPServer
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel

BASE    = os.environ.get("BASE", "Qwen/Qwen2.5-7B-Instruct")
ADAPTER = os.environ.get("ADAPTER", "qwen_excel_lora")
SYS = ("You are an expert Excel and accounting assistant. Answer with the formula, the spec, "
       "or a short plain-English reply only — no preamble.")

bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                         bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
tok = AutoTokenizer.from_pretrained(ADAPTER)
model = AutoModelForCausalLM.from_pretrained(BASE, quantization_config=bnb, device_map="auto")
model = PeftModel.from_pretrained(model, ADAPTER)
model.eval()

def ask(text):
    msgs = [{"role": "system", "content": SYS}, {"role": "user", "content": text}]
    ids = tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out = model.generate(input_ids=ids, max_new_tokens=160, do_sample=False)
    reply = tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True).strip()
    return reply.split("\n")[0].strip() if reply else ""

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "Content-Type")
    def do_OPTIONS(self): self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or "{}")
        try: result = ask(body.get("text", ""))
        except Exception as e: result = f"error: {e}"
        self.send_response(200); self.send_header("Content-Type", "application/json"); self._cors(); self.end_headers()
        self.wfile.write(json.dumps({"result": result}).encode())
    def log_message(self, *a): pass

if __name__ == "__main__":
    print("Qwen Excel API (transformers) -> http://127.0.0.1:8000")
    HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
