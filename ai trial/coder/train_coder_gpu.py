# train_coder_gpu.py — the SCALED-UP from-scratch code model, for a real GPU (~16GB).
# Same architecture you built, just bigger (wider, deeper, longer context) + dropout + GPU.
#
# Run on a machine with a CUDA GPU. First generate the inputs:
#     python3 build_data.py        (or  CAP=30000000 python3 build_data.py  for more code)
#     python3 bpe_code.py          (or  MERGES=2000  python3 bpe_code.py     for a bigger vocab)
# then:
#     python3 train_coder_gpu.py   (or  ITERS=8000 python3 train_coder_gpu.py)

import os, time, json, re, torch
import torch.nn as nn
from torch.nn import functional as F

torch.manual_seed(1337)
device = "cuda" if torch.cuda.is_available() else "cpu"
print("device:", device)

# ── hyperparameters (sized for ~16 GB VRAM) ──
block_size = 256        # context window (tokens) — much longer now
batch_size = 64
n_embd     = 384
n_head     = 6
n_layer    = 6
dropout    = 0.2        # regularization, since the model is big enough to overfit
lr         = 3e-4
max_iters  = int(os.environ.get("ITERS", 5000))
eval_every = 500

# ── BPE tokenizer (from merges.json) ──
merges = [tuple(m) for m in json.load(open("merges.json"))]
text = open("code.txt", encoding="utf-8").read()
base = sorted(set(text))
vocab = base + [a + b for a, b in merges]
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
def encode_piece(p):
    if p not in _cache:
        syms = list(p)
        for a, b in merges:
            syms = merge_word(syms, a, b, a + b)
        _cache[p] = [stoi[s] for s in syms]
    return _cache[p]

def encode(s):
    out = []
    for p in re.findall(r"\s+|\w+|[^\s\w]+", s):
        out.extend(encode_piece(p))
    return out

def decode(ids):
    return "".join(itos[i] for i in ids)

print("encoding corpus...")
data = torch.tensor(encode(text), dtype=torch.long)
print(f"vocab: {vocab_size} | tokens: {len(data):,}")
n = int(0.9 * len(data))
train_data, val_data = data[:n], data[n:]

def get_batch(split):
    d = train_data if split == "train" else val_data
    ix = torch.randint(len(d) - block_size, (batch_size,))
    x = torch.stack([d[i : i + block_size] for i in ix])
    y = torch.stack([d[i + 1 : i + block_size + 1] for i in ix])
    return x.to(device), y.to(device)

# ── model (same pieces + dropout) ──
class Head(nn.Module):
    def __init__(self, hs):
        super().__init__()
        self.key = nn.Linear(n_embd, hs, bias=False)
        self.query = nn.Linear(n_embd, hs, bias=False)
        self.value = nn.Linear(n_embd, hs, bias=False)
        self.register_buffer("tril", torch.tril(torch.ones(block_size, block_size)))
        self.dropout = nn.Dropout(dropout)
    def forward(self, x):
        B, T, C = x.shape
        k, q = self.key(x), self.query(x)
        wei = q @ k.transpose(-2, -1) * k.shape[-1] ** -0.5
        wei = wei.masked_fill(self.tril[:T, :T] == 0, float("-inf"))
        wei = self.dropout(F.softmax(wei, dim=-1))
        return wei @ self.value(x)

class MultiHead(nn.Module):
    def __init__(self, nh, hs):
        super().__init__()
        self.heads = nn.ModuleList([Head(hs) for _ in range(nh)])
        self.proj = nn.Linear(n_embd, n_embd)
        self.dropout = nn.Dropout(dropout)
    def forward(self, x):
        return self.dropout(self.proj(torch.cat([h(x) for h in self.heads], dim=-1)))

class FeedForward(nn.Module):
    def __init__(self, n):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(n, 4 * n), nn.ReLU(),
                                 nn.Linear(4 * n, n), nn.Dropout(dropout))
    def forward(self, x):
        return self.net(x)

class Block(nn.Module):
    def __init__(self, n, h):
        super().__init__()
        self.sa = MultiHead(h, n // h)
        self.ffwd = FeedForward(n)
        self.ln1 = nn.LayerNorm(n)
        self.ln2 = nn.LayerNorm(n)
    def forward(self, x):
        x = x + self.sa(self.ln1(x))
        x = x + self.ffwd(self.ln2(x))
        return x

class GPT(nn.Module):
    def __init__(self):
        super().__init__()
        self.token_embedding = nn.Embedding(vocab_size, n_embd)
        self.position_embedding = nn.Embedding(block_size, n_embd)
        self.drop = nn.Dropout(dropout)
        self.blocks = nn.Sequential(*[Block(n_embd, n_head) for _ in range(n_layer)])
        self.ln_f = nn.LayerNorm(n_embd)
        self.lm_head = nn.Linear(n_embd, vocab_size)
    def forward(self, idx, targets=None):
        B, T = idx.shape
        tok = self.token_embedding(idx)
        pos = self.position_embedding(torch.arange(T, device=idx.device))
        x = self.drop(tok + pos)
        x = self.ln_f(self.blocks(x))
        logits = self.lm_head(x)
        if targets is None:
            return logits, None
        B, T, C = logits.shape
        loss = F.cross_entropy(logits.view(B * T, C), targets.view(B * T))
        return logits, loss
    def generate(self, idx, max_new_tokens):
        for _ in range(max_new_tokens):
            logits, _ = self(idx[:, -block_size:])
            probs = F.softmax(logits[:, -1, :], dim=-1)
            idx = torch.cat((idx, torch.multinomial(probs, 1)), dim=1)
        return idx

@torch.no_grad()
def estimate_loss():
    model.eval()
    out = {}
    for split in ["train", "val"]:
        L = torch.zeros(20)
        for k in range(20):
            x, y = get_batch(split)
            _, l = model(x, y)
            L[k] = l.item()
        out[split] = L.mean().item()
    model.train()
    return out

model = GPT().to(device)
print(f"params: {sum(p.numel() for p in model.parameters())/1e6:.2f}M")
opt = torch.optim.AdamW(model.parameters(), lr=lr)
t0 = time.time()
for it in range(max_iters):
    if it % eval_every == 0:
        l = estimate_loss()
        print(f"step {it:5d} | train {l['train']:.3f} | val {l['val']:.3f} | {time.time()-t0:.0f}s")
    x, y = get_batch("train")
    _, loss = model(x, y)
    opt.zero_grad(set_to_none=True)
    loss.backward()
    opt.step()
l = estimate_loss()
print(f"FINAL  {max_iters} | train {l['train']:.3f} | val {l['val']:.3f} | {time.time()-t0:.0f}s")
torch.save(model.state_dict(), "coder_gpu.pt")

print("\n----- generated Python (seeded 'def ') -----")
ctx = torch.tensor([encode("def ")], dtype=torch.long, device=device)
print(decode(model.generate(ctx, 300)[0].tolist()))
