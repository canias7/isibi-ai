# ask.py — chat with the trained Excel model: description -> formula.
#   python3 ask.py "sum of column A"     (one query)
#   python3 ask.py                        (interactive)
# If the checkpoint predates config-saving, pass the sizes you trained with:
#   NEMBD=384 NHEAD=6 NLAYER=6 python3 ask.py

import os, re, json, sys, torch
import torch.nn as nn
from torch.nn import functional as F

device = "cuda" if torch.cuda.is_available() else "cpu"
CKPT = "excel.ckpt"

# ── frozen tokenizer ──
tok = json.load(open("tokenizer.json"))
chars, merges = tok["chars"], [tuple(m) for m in tok["merges"]]
vocab = chars + [a + b for a, b in merges] + ["<UNK>"]
stoi = {t: i for i, t in enumerate(vocab)}
itos = {i: t for i, t in enumerate(vocab)}
vocab_size = len(vocab)

def merge_word(syms, a, b, ab):
    out, j = [], 0
    while j < len(syms):
        if j < len(syms) - 1 and syms[j] == a and syms[j + 1] == b:
            out.append(ab); j += 2
        else:
            out.append(syms[j]); j += 1
    return out
_cache = {}
def encode(s):
    out = []
    for p in re.findall(r"\s+|\w+|[^\s\w]+", s):
        if p not in _cache:
            syms = [c if c in stoi else "<UNK>" for c in p]
            for a, b in merges:
                syms = merge_word(syms, a, b, a + b)
            _cache[p] = [stoi[x] for x in syms]
        out.extend(_cache[p])
    return out
def decode(ids):
    return "".join("" if itos[i] == "<UNK>" else itos[i] for i in ids)

# ── load checkpoint + its config (fall back to env for older checkpoints) ──
ckpt = torch.load(CKPT, map_location=device)
cfg = ckpt.get("config", {})
n_embd     = cfg.get("n_embd",     int(os.environ.get("NEMBD", 256)))
n_head     = cfg.get("n_head",     int(os.environ.get("NHEAD", 4)))
n_layer    = cfg.get("n_layer",    int(os.environ.get("NLAYER", 4)))
block_size = cfg.get("block_size", int(os.environ.get("BLOCK", 128)))

class Head(nn.Module):
    def __init__(self, hs):
        super().__init__()
        self.key = nn.Linear(n_embd, hs, bias=False)
        self.query = nn.Linear(n_embd, hs, bias=False)
        self.value = nn.Linear(n_embd, hs, bias=False)
        self.register_buffer("tril", torch.tril(torch.ones(block_size, block_size)))
        self.dropout = nn.Dropout(0.0)
    def forward(self, x):
        B, T, C = x.shape
        k, q = self.key(x), self.query(x)
        wei = q @ k.transpose(-2, -1) * k.shape[-1] ** -0.5
        wei = wei.masked_fill(self.tril[:T, :T] == 0, float("-inf"))
        wei = F.softmax(wei, dim=-1)
        return wei @ self.value(x)
class MultiHead(nn.Module):
    def __init__(self, nh, hs):
        super().__init__()
        self.heads = nn.ModuleList([Head(hs) for _ in range(nh)])
        self.proj = nn.Linear(n_embd, n_embd)
        self.dropout = nn.Dropout(0.0)
    def forward(self, x):
        return self.proj(torch.cat([h(x) for h in self.heads], dim=-1))
class FeedForward(nn.Module):
    def __init__(self, n):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(n, 4 * n), nn.ReLU(), nn.Linear(4 * n, n), nn.Dropout(0.0))
    def forward(self, x): return self.net(x)
class Block(nn.Module):
    def __init__(self, n, h):
        super().__init__()
        self.sa = MultiHead(h, n // h); self.ffwd = FeedForward(n)
        self.ln1 = nn.LayerNorm(n); self.ln2 = nn.LayerNorm(n)
    def forward(self, x):
        x = x + self.sa(self.ln1(x)); x = x + self.ffwd(self.ln2(x)); return x
class GPT(nn.Module):
    def __init__(self):
        super().__init__()
        self.token_embedding = nn.Embedding(vocab_size, n_embd)
        self.position_embedding = nn.Embedding(block_size, n_embd)
        self.drop = nn.Dropout(0.0)
        self.blocks = nn.Sequential(*[Block(n_embd, n_head) for _ in range(n_layer)])
        self.ln_f = nn.LayerNorm(n_embd)
        self.lm_head = nn.Linear(n_embd, vocab_size)
    def forward(self, idx):
        B, T = idx.shape
        x = self.drop(self.token_embedding(idx) + self.position_embedding(torch.arange(T, device=idx.device)))
        x = self.ln_f(self.blocks(x))
        return self.lm_head(x)

model = GPT().to(device)
model.load_state_dict(ckpt["model"])
model.eval()

@torch.no_grad()
def ask(desc, max_new=64):
    idx = torch.tensor([encode(f"Q: {desc}\nA: ")], dtype=torch.long, device=device)
    for _ in range(max_new):
        logits = model(idx[:, -block_size:])
        nxt = torch.argmax(logits[:, -1, :], dim=-1, keepdim=True)   # greedy = most likely
        idx = torch.cat((idx, nxt), dim=1)
    out = decode(idx[0].tolist())
    ans = out.split("A: ", 1)[-1].split("\n", 1)[0].strip()
    if "=>" in ans:                       # chain-of-thought: keep only the final formula
        ans = ans.split("=>")[-1].strip()
    return ans

if __name__ == "__main__":
    if len(sys.argv) > 1:
        print(ask(" ".join(sys.argv[1:])))
    else:
        print("Excel formula bot — type a description ('q' to quit)")
        while True:
            try:
                d = input("> ").strip()
            except EOFError:
                break
            if d in ("q", "quit", "exit"):
                break
            if d:
                print("  " + ask(d))
