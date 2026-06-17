# gpt.py — building a tiny GPT from scratch, step by step.
# Steps 1-5: tokenizer, data, batching, embeddings.
# Step 6: self-attention — each token looks BACK at previous tokens.

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

def get_batch(split):
    d = train_data if split == "train" else val_data
    ix = torch.randint(len(d) - block_size, (batch_size,))
    xb = torch.stack([d[i : i + block_size] for i in ix])
    yb = torch.stack([d[i + 1 : i + block_size + 1] for i in ix])
    return xb, yb

# ── Step 6 — ONE head of self-attention ──
class Head(nn.Module):
    def __init__(self, head_size):
        super().__init__()
        self.key   = nn.Linear(n_embd, head_size, bias=False)   # what each token OFFERS
        self.query = nn.Linear(n_embd, head_size, bias=False)   # what each token WANTS
        self.value = nn.Linear(n_embd, head_size, bias=False)   # what each token GIVES
        # lower-triangular mask: token t may only look at tokens 0..t (the past)
        self.register_buffer("tril", torch.tril(torch.ones(block_size, block_size)))

    def forward(self, x):
        B, T, C = x.shape
        k = self.key(x)                                       # (B, T, head_size)
        q = self.query(x)                                     # (B, T, head_size)
        wei = q @ k.transpose(-2, -1) * k.shape[-1] ** -0.5   # (B,T,T) relevance scores
        wei = wei.masked_fill(self.tril[:T, :T] == 0, float("-inf"))  # block the FUTURE
        wei = F.softmax(wei, dim=-1)                          # (B,T,T) weights that sum to 1
        v = self.value(x)                                     # (B, T, head_size)
        out = wei @ v                                         # (B,T,head_size) weighted blend of past
        return out

# ── The GPT model ──
class GPT(nn.Module):
    def __init__(self):
        super().__init__()
        self.token_embedding    = nn.Embedding(vocab_size, n_embd)
        self.position_embedding = nn.Embedding(block_size, n_embd)
        self.sa_head            = Head(n_embd)               # NEW: self-attention
        self.lm_head            = nn.Linear(n_embd, vocab_size)

    def forward(self, idx, targets=None):
        B, T = idx.shape
        tok = self.token_embedding(idx)                      # (B,T,n_embd)
        pos = self.position_embedding(torch.arange(T))       # (T,n_embd)
        x = tok + pos                                        # (B,T,n_embd)
        x = self.sa_head(x)                                  # (B,T,n_embd)  <- tokens talk!
        logits = self.lm_head(x)                             # (B,T,vocab)
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
