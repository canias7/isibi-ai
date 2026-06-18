# serve.py — a tiny local API around the trained Excel model (zero dependencies).
# Run it from this folder AFTER training (needs tokenizer.json + excel.ckpt):
#     python3 serve.py
# Then POST to it:
#     curl -X POST http://127.0.0.1:8000/formula -d "{\"text\": \"sum column A\"}"
#     -> {"result": "=SUM(A:A)"}
# Works for all three tasks the model knows — just send the text:
#     "sum the revenue column"        -> a formula
#     "explain =SUM(A:A)"             -> plain English
#     "fix =CODE(M32"                 -> the corrected formula
#
# The Excel add-in (see addin/) calls this; CORS is open so the browser can reach it.

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import ask   # loads tokenizer.json + excel.ckpt and the ask() function ONCE, at import

PORT = 8000

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")          # let the add-in call us
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):                # CORS preflight
        self._send(200, {})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        try:
            req = json.loads(self.rfile.read(n) or "{}")
            text = (req.get("text") or "").strip()
            if not text:
                return self._send(400, {"error": 'send {"text": "..."}'})
            return self._send(200, {"result": ask.ask(text)})
        except Exception as e:
            return self._send(500, {"error": str(e)})

    def log_message(self, *a):           # keep the console quiet
        pass

if __name__ == "__main__":
    print(f"Excel model API → http://127.0.0.1:{PORT}")
    print('  POST /formula  {"text": "sum column A"}  ->  {"result": "=SUM(A:A)"}')
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
