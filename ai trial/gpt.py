# gpt.py — building a tiny GPT from scratch, step by step.
# Steps 1-4: tokenizer, data, batching, bigram + training.
# Step 5: real embeddings (token meaning + position) and an LM head.

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

# ── Data: encode everything, split train/val ──
data = torch.tensor(encode(text), dtype=torch.long)
n = int(0.9 * len(data))
train_data, val_data = data[:n], data[n:]

# ── Batching ──
block_size = 8
batch_size = 32
n_embd = 32        # NEW: size of each token's "meaning vector"

def get_batch(split):
    d = train_data if split == "train" else val_data
    ix = torch.randint(len(d) - block_size, (batch_size,))
    xb = torch.stack([d[i : i + block_size] for i in ix])
    yb = torch.stack([d[i + 1 : i + block_size + 1] for i in ix])
    return xb, yb

# ── Step 5 — the GPT model: embeddings (token + position) -> LM head ──
class GPT(nn.Module):
    def __init__(self):
        super().__init__()
        self.token_embedding    = nn.Embedding(vocab_size, n_embd)   # WHAT each token is
        self.position_embedding = nn.Embedding(block_size, n_embd)   # WHERE it sits
        self.lm_head            = nn.Linear(n_embd, vocab_size)      # vector -> next-token logits

    def forward(self, idx, targets=None):
        B, T = idx.shape
        tok = self.token_embedding(idx)                 # (B, T, n_embd)
        pos = self.position_embedding(torch.arange(T))  # (T, n_embd)
        x = tok + pos                                   # (B, T, n_embd)  meaning + position
        logits = self.lm_head(x)                        # (B, T, vocab_size)
        if targets is None:
            return logits, None
        B, T, C = logits.shape
        loss = F.cross_entropy(logits.view(B * T, C), targets.view(B * T))
        return logits, loss

    def generate(self, idx, max_new_tokens):
        for _ in range(max_new_tokens):
            idx_cond = idx[:, -block_size:]   # crop to last block_size (positions are limited!)
            logits, _ = self(idx_cond)
            logits = logits[:, -1, :]
            probs = F.softmax(logits, dim=-1)
            next_id = torch.multinomial(probs, num_samples=1)
            idx = torch.cat((idx, next_id), dim=1)
        return idx

model = GPT()
context = torch.zeros((1, 1), dtype=torch.long)

# ── train ──
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
