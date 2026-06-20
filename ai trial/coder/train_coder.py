# train_coder.py — train our OWN from-scratch GPT on Python code.
# Exact same architecture as the poem model (gpt.py), scaled up for code.

import os, time, torch
import torch.nn as nn
from torch.nn import functional as F

torch.manual_seed(1337)
torch.set_num_threads(os.cpu_count() or 4)        # use all CPU cores

# ── hyperparameters (modest, so it trains on CPU) ──
block_size = 64      # context window (chars seen at once)
batch_size = 32
n_embd     = 128
n_head     = 4
n_layer    = 4
lr         = 3e-4
max_iters  = int(os.environ.get("ITERS", 3000))
eval_every = 500

# ── data: the code corpus ──
text = open("code.txt", encoding="utf-8").read()
chars = sorted(set(text))
vocab_size = len(chars)
stoi = {c: i for i, c in enumerate(chars)}
itos = {i: c for i, c in enumerate(chars)}
encode = lambda s: [stoi[c] for c in s]
decode = lambda ids: "".join(itos[i] for i in ids)

data = torch.tensor(encode(text), dtype=torch.long)
n = int(0.9 * len(data))
train_data, val_data = data[:n], data[n:]

def get_batch(split):
    d = train_data if split == "train" else val_data
    ix = torch.randint(len(d) - block_size, (batch_size,))
    x = torch.stack([d[i : i + block_size] for i in ix])
    y = torch.stack([d[i + 1 : i + block_size + 1] for i in ix])
    return x, y

# ── the model (every piece you built) ──
class Head(nn.Module):
    def __init__(self, head_size):
        super().__init__()
        self.key = nn.Linear(n_embd, head_size, bias=False)
        self.query = nn.Linear(n_embd, head_size, bias=False)
        self.value = nn.Linear(n_embd, head_size, bias=False)
        self.register_buffer("tril", torch.tril(torch.ones(block_size, block_size)))
    def forward(self, x):
        B, T, C = x.shape
        k, q = self.key(x), self.query(x)
        wei = q @ k.transpose(-2, -1) * k.shape[-1] ** -0.5
        wei = wei.masked_fill(self.tril[:T, :T] == 0, float("-inf"))
        wei = F.softmax(wei, dim=-1)
        return wei @ self.value(x)

class MultiHead(nn.Module):
    def __init__(self, num_heads, head_size):
        super().__init__()
        self.heads = nn.ModuleList([Head(head_size) for _ in range(num_heads)])
        self.proj = nn.Linear(n_embd, n_embd)
    def forward(self, x):
        return self.proj(torch.cat([h(x) for h in self.heads], dim=-1))

class FeedForward(nn.Module):
    def __init__(self, n_embd):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(n_embd, 4 * n_embd), nn.ReLU(),
                                 nn.Linear(4 * n_embd, n_embd))
    def forward(self, x):
        return self.net(x)

class Block(nn.Module):
    def __init__(self, n_embd, n_head):
        super().__init__()
        hs = n_embd // n_head
        self.sa = MultiHead(n_head, hs)
        self.ffwd = FeedForward(n_embd)
        self.ln1 = nn.LayerNorm(n_embd)
        self.ln2 = nn.LayerNorm(n_embd)
    def forward(self, x):
        x = x + self.sa(self.ln1(x))
        x = x + self.ffwd(self.ln2(x))
        return x

class GPT(nn.Module):
    def __init__(self):
        super().__init__()
        self.token_embedding = nn.Embedding(vocab_size, n_embd)
        self.position_embedding = nn.Embedding(block_size, n_embd)
        self.blocks = nn.Sequential(*[Block(n_embd, n_head) for _ in range(n_layer)])
        self.ln_f = nn.LayerNorm(n_embd)
        self.lm_head = nn.Linear(n_embd, vocab_size)
    def forward(self, idx, targets=None):
        B, T = idx.shape
        x = self.token_embedding(idx) + self.position_embedding(torch.arange(T))
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

model = GPT()
print(f"params: {sum(p.numel() for p in model.parameters())/1e6:.2f}M | vocab: {vocab_size}")

opt = torch.optim.AdamW(model.parameters(), lr=lr)
t0 = time.time()
for it in range(max_iters):
    if it % eval_every == 0:
        l = estimate_loss()
        print(f"step {it:5d} | train {l['train']:.3f} | val {l['val']:.3f} | {time.time()-t0:.0f}s")
    x, y = get_batch("train")
    _, loss = model(x, y)
    opt.zero_grad()
    loss.backward()
    opt.step()

l = estimate_loss()
print(f"FINAL  {max_iters} | train {l['train']:.3f} | val {l['val']:.3f} | {time.time()-t0:.0f}s")
torch.save(model.state_dict(), "coder.pt")

# ── generate: seed it with "def " and let it try to write a function ──
print("\n----- generated Python (seeded with 'def ') -----")
ctx = torch.tensor([encode("def ")], dtype=torch.long)
print(decode(model.generate(ctx, 500)[0].tolist()))
