# gpt.py — building a tiny GPT from scratch, step by step.
# Steps 1-3: tokenizer + data + batching.   Step 4: model + training + generation.

import math
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

def get_batch(split):
    d = train_data if split == "train" else val_data
    ix = torch.randint(len(d) - block_size, (batch_size,))
    xb = torch.stack([d[i : i + block_size] for i in ix])
    yb = torch.stack([d[i + 1 : i + block_size + 1] for i in ix])
    return xb, yb

# ── Step 4 — the Bigram model ──
class BigramModel(nn.Module):
    def __init__(self, vocab_size):
        super().__init__()
        self.token_table = nn.Embedding(vocab_size, vocab_size)

    def forward(self, idx, targets=None):
        logits = self.token_table(idx)                 # (B, T, vocab_size)
        if targets is None:
            return logits, None
        B, T, C = logits.shape
        loss = F.cross_entropy(logits.view(B * T, C), targets.view(B * T))
        return logits, loss

    def generate(self, idx, max_new_tokens):
        for _ in range(max_new_tokens):
            logits, _ = self(idx)
            logits = logits[:, -1, :]                  # last step -> (B, vocab)
            probs = F.softmax(logits, dim=-1)
            next_id = torch.multinomial(probs, num_samples=1)
            idx = torch.cat((idx, next_id), dim=1)
        return idx

model = BigramModel(vocab_size)
context = torch.zeros((1, 1), dtype=torch.long)   # start from a newline (id 0)

# look BEFORE training
print("--- before training ---")
print(decode(model.generate(context, max_new_tokens=100)[0].tolist()))

# ── Step 4c — the training loop ──
optimizer = torch.optim.AdamW(model.parameters(), lr=1e-2)

print("\n--- training ---")
for step in range(3000):
    xb, yb = get_batch("train")
    _, loss = model(xb, yb)
    optimizer.zero_grad()      # 1. clear old gradients
    loss.backward()            # 2. backprop: how does each weight affect the loss?
    optimizer.step()           # 3. nudge every weight to reduce the loss
    if step % 300 == 0:
        print(f"step {step:4d}: loss {loss.item():.4f}")

# look AFTER training
print("\n--- after training ---")
print(decode(model.generate(context, max_new_tokens=200)[0].tolist()))
