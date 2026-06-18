# train_resumable.py — trains the from-scratch Excel-formula model.
# Reads excel.txt + the frozen tokenizer, RESUMES from excel.ckpt.
# Same engine as the coder (BF16 + gradient checkpointing + LR schedule), narrower domain.
#
#   python3 make_data.py            (generate the pairs)   e.g. N=500000 python3 make_data.py
#   python3 freeze_tokenizer.py     (once)
#   python3 train_resumable.py      (train; resumes if excel.ckpt exists)

import os, re, json, time, math, torch
import torch.nn as nn
from torch.nn import functional as F
from contextlib import nullcontext
from torch.utils.checkpoint import checkpoint

torch.manual_seed(1337)
device = "cuda" if torch.cuda.is_available() else "cpu"
print("device:", device)

def amp():
    return torch.autocast(device_type="cuda", dtype=torch.bfloat16) if device == "cuda" else nullcontext()

# ── model size (smaller defaults — Excel formulas are a narrow domain) ──
n_embd     = int(os.environ.get("NEMBD", 256))
n_head     = int(os.environ.get("NHEAD", 4))
n_layer    = int(os.environ.get("NLAYER", 4))
block_size = int(os.environ.get("BLOCK", 128))
batch_size = int(os.environ.get("BATCH", 64))
grad_ckpt  = os.environ.get("GRADCKPT", "0") == "1"
dropout    = float(os.environ.get("DROPOUT", 0.1))
lr         = 3e-4
max_iters  = int(os.environ.get("ITERS", 5000))
eval_every = int(os.environ.get("EVAL", 500))
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
def encode_piece(p):
    if p not in _cache:
        syms = [c if c in stoi else "<UNK>" for c in p]
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
    return "".join("" if itos[i] == "<UNK>" else itos[i] for i in ids)

print("encoding data...")
data = torch.tensor(encode(open("excel.txt", encoding="utf-8").read()), dtype=torch.long)
n = int(0.9 * len(data))
train_data, val_data = data[:n], data[n:]
print(f"vocab: {vocab_size} (frozen) | tokens: {len(data):,}")

def get_batch(split):
    d = train_data if split == "train" else val_data
    ix = torch.randint(len(d) - block_size, (batch_size,))
    x = torch.stack([d[i : i + block_size] for i in ix])
    y = torch.stack([d[i + 1 : i + block_size + 1] for i in ix])
    return x.to(device), y.to(device)

# ── model (same architecture as the coder) ──
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
        x = self.drop(self.token_embedding(idx) + self.position_embedding(torch.arange(T, device=idx.device)))
        for block in self.blocks:
            x = checkpoint(block, x, use_reentrant=False) if (grad_ckpt and self.training) else block(x)
        x = self.ln_f(x)
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
            with amp():
                _, l = model(x, y)
            L[k] = l.item()
        out[split] = L.mean().item()
    model.train()
    return out

model = GPT().to(device)
opt = torch.optim.AdamW(model.parameters(), lr=lr)

start_step = 0
if os.path.exists(CKPT):
    ckpt = torch.load(CKPT, map_location=device)
    model.load_state_dict(ckpt["model"])
    opt.load_state_dict(ckpt["opt"])
    start_step = ckpt["step"]
    print(f"RESUMED from {CKPT} at step {start_step}")
else:
    print("fresh start (no checkpoint yet)")
print(f"params: {sum(p.numel() for p in model.parameters())/1e6:.2f}M")

# ── learning-rate schedule: linear warmup, then cosine decay ──
warmup = int(os.environ.get("WARMUP", 200))
lr_decay_iters = int(os.environ.get("LR_DECAY", start_step + max_iters))
min_lr = lr * 0.1
def get_lr(it):
    if it < warmup:
        return lr * (it + 1) / warmup
    if it >= lr_decay_iters:
        return min_lr
    ratio = (it - warmup) / max(1, lr_decay_iters - warmup)
    return min_lr + 0.5 * (1 + math.cos(math.pi * ratio)) * (lr - min_lr)

t0 = time.time()
for it in range(start_step, start_step + max_iters):
    cur_lr = get_lr(it)
    for g in opt.param_groups:
        g["lr"] = cur_lr
    if it % eval_every == 0:
        l = estimate_loss()
        print(f"step {it:6d} | train {l['train']:.3f} | val {l['val']:.3f} | lr {cur_lr:.1e} | {time.time()-t0:.0f}s")
    x, y = get_batch("train")
    with amp():
        _, loss = model(x, y)
    opt.zero_grad(set_to_none=True)
    loss.backward()
    opt.step()

final_step = start_step + max_iters
l = estimate_loss()
print(f"FINAL  {final_step} | train {l['train']:.3f} | val {l['val']:.3f}")
torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "step": final_step,
            "config": {"n_embd": n_embd, "n_head": n_head, "n_layer": n_layer, "block_size": block_size}}, CKPT)
print(f"saved checkpoint at step {final_step}")

# ── test: give it descriptions, see the formulas it writes ──
model.eval()
print("\n----- test: description -> formula -----")
for q in ["Q: sum of column A\nA: ",
          "Q: average of B1 to B20\nA: ",
          "Q: if C2 over 100 say high otherwise low\nA: ",
          "Q: count cells in column D equal to paid\nA: ",
          "Q: predict the next B value from A\nA: ",
          "Q: total C for each B\nA: ",
          "Q: compound annual growth rate from B2 to B7 over 5 years\nA: ",
          "Q: 3-period moving average ending at B10\nA: ",
          "Q: B5 as a percent of the B total\nA: ",
          "Q: sum the revenue column\nA: ",
          "Q: count cells in A greater than 100\nA: ",
          "Q: total sales where region is west\nA: "]:
    ctx = torch.tensor([encode(q)], dtype=torch.long, device=device)
    out = decode(model.generate(ctx, 40)[0].tolist())
    print(out.split("\n\n")[0])
    print("---")
