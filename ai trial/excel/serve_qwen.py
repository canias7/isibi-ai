# serve_qwen.py — serve the fine-tuned Qwen behind the SAME /formula API the add-in uses.
# So the add-in (taskpane.js) works unchanged — it just POSTs {text} and gets {result}.
#   pip install unsloth
#   python serve_qwen.py        (after finetune_qwen.py created qwen_excel_lora/)
import json
import torch
from http.server import BaseHTTPRequestHandler, HTTPServer
from unsloth import FastLanguageModel

MODEL_DIR = "qwen_excel_lora"   # the LoRA adapter saved by finetune_qwen.py (sits on Qwen2.5-7B)
SYS = ("You are an expert Excel and accounting assistant. Answer with the formula, the spec, "
       "or a short plain-English reply only — no preamble.")

model, tokenizer = FastLanguageModel.from_pretrained(model_name=MODEL_DIR, max_seq_length=768, load_in_4bit=True)
FastLanguageModel.for_inference(model)

def ask(text):
    msgs = [{"role": "system", "content": SYS}, {"role": "user", "content": text}]
    ids = tokenizer.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, return_tensors="pt").to(model.device)
    out = model.generate(input_ids=ids, max_new_tokens=160, do_sample=False)
    reply = tokenizer.decode(out[0][ids.shape[1]:], skip_special_tokens=True).strip()
    return reply.split("\n")[0].strip() if reply else ""   # first line = the formula / spec / answer

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or "{}")
        try:
            result = ask(body.get("text", ""))
        except Exception as e:
            result = f"error: {e}"
        self.send_response(200); self.send_header("Content-Type", "application/json"); self._cors(); self.end_headers()
        self.wfile.write(json.dumps({"result": result}).encode())
    def log_message(self, *a):
        pass

if __name__ == "__main__":
    print("Qwen Excel API -> http://127.0.0.1:8000  (same API the add-in uses)")
    HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
