# gpt.py — building a tiny GPT from scratch, step by step.
# Steps 1-7: tokenizer, data, batching, embeddings, multi-head attention.
# Step 8: feed-forward — each token "thinks" on what attention gathered.

import torch
import torch.nn as nn
from torch.nn import functional as F

torch.manual_seed(1337)

# ── Tokenizer (char-level) ──
text = open("input.txt", encoding="utf-8").read()
chars = sorted(set(text))
vocab_size = len(chars)
stoi = {ch: i for i, ch in enumerate(chars)}
itos = {i: ch for i, ch in enumerate(chars)}
def encode(s):   return [stoi[c] for c in s]
def decode(ids): return "".join(itos[i] for i in ids)

# ── Data ──
data = torch.tensor(encode(text), dtype=torch.long)
n = int(0.9 * len(data))
train_data, val_data = data[:n], data[n:]

# ── Hyperparameters ──
block_size = 8
batch_size = 32
n_embd = 32
n_head = 4

def get_batch(split):
    d = train_data if split == "train" else val_data
    ix = torch.randint(len(d) - block_size, (batch_size,))
    xb = torch.stack([d[i : i + block_size] for i in ix])
    yb = torch.stack([d[i + 1 : i + block_size + 1] for i in ix])
    return xb, yb

# ── One head of self-attention ──
class Head(nn.Module):
    def __init__(self, head_size):
        super().__init__()
        self.key   = nn.Linear(n_embd, head_size, bias=False)
        self.query = nn.Linear(n_embd, head_size, bias=False)
        self.value = nn.Linear(n_embd, head_size, bias=False)
        self.register_buffer("tril", torch.tril(torch.ones(block_size, block_size)))

    def forward(self, x):
        B, T, C = x.shape
        k = self.key(x)
        q = self.query(x)
        wei = q @ k.transpose(-2, -1) * k.shape[-1] ** -0.5
        wei = wei.masked_fill(self.tril[:T, :T] == 0, float("-inf"))
        wei = F.softmax(wei, dim=-1)
        v = self.value(x)
        return wei @ v

# ── Multi-head attention ──
class MultiHead(nn.Module):
    def __init__(self, num_heads, head_size):
        super().__init__()
        self.heads = nn.ModuleList([Head(head_size) for _ in range(num_heads)])

    def forward(self, x):
        return torch.cat([h(x) for h in self.heads], dim=-1)

# ── Step 8 — feed-forward: a little per-token MLP ("thinking") ──
class FeedForward(nn.Module):
    def __init__(self, n_embd):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_embd, 4 * n_embd),   # expand to a wider space
            nn.ReLU(),                       # non-linearity (the "bend")
            nn.Linear(4 * n_embd, n_embd),   # project back down
        )

    def forward(self, x):
        return self.net(x)                   # applied to each token independently

# ── The GPT model ──
class GPT(nn.Module):
    def __init__(self):
        super().__init__()
        self.token_embedding    = nn.Embedding(vocab_size, n_embd)
        self.position_embedding = nn.Embedding(block_size, n_embd)
        self.sa_heads           = MultiHead(n_head, n_embd // n_head)
        self.ffwd               = FeedForward(n_embd)        # NEW
        self.lm_head            = nn.Linear(n_embd, vocab_size)

    def forward(self, idx, targets=None):
        B, T = idx.shape
        tok = self.token_embedding(idx)
        pos = self.position_embedding(torch.arange(T))
        x = tok + pos
        x = self.sa_heads(x)        # attention = tokens COMMUNICATE (gather context)
        x = self.ffwd(x)            # feed-forward = each token COMPUTES (thinks)
        logits = self.lm_head(x)
        if targets is None:
            return logits, None
        B, T, C = logits.shape
        loss = F.cross_entropy(logits.view(B * T, C), targets.view(B * T))
        return logits, loss

    def generate(self, idx, max_new_tokens):
        for _ in range(max_new_tokens):
            idx_cond = idx[:, -block_size:]
            logits, _ = self(idx_cond)
            logits = logits[:, -1, :]
            probs = F.softmax(logits, dim=-1)
            next_id = torch.multinomial(probs, num_samples=1)
            idx = torch.cat((idx, next_id), dim=1)
        return idx

model = GPT()
context = torch.zeros((1, 1), dtype=torch.long)

optimizer = torch.optim.AdamW(model.parameters(), lr=1e-2)
print("--- training ---")
for step in range(3000):
    xb, yb = get_batch("train")
    _, loss = model(xb, yb)
    optimizer.zero_grad()
    loss.backward()
    optimizer.step()
    if step % 500 == 0:
        print(f"step {step:4d}: loss {loss.item():.4f}")

print("\n--- after training ---")
print(decode(model.generate(context, max_new_tokens=200)[0].tolist()))
