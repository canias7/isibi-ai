# gpt.py — building a tiny GPT from scratch, step by step.
# Steps 1-3: tokenizer + data + batching.   Step 4: the model.

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

def encode(s):   return [stoi[c] for c in s]      # text -> ids
def decode(ids): return "".join(itos[i] for i in ids)  # ids -> text

# ── Data: encode everything, split train/val ──
data = torch.tensor(encode(text), dtype=torch.long)
n = int(0.9 * len(data))
train_data, val_data = data[:n], data[n:]

# ── Batching ──
block_size = 8
batch_size = 4

def get_batch(split):
    d = train_data if split == "train" else val_data
    ix = torch.randint(len(d) - block_size, (batch_size,))
    xb = torch.stack([d[i : i + block_size] for i in ix])
    yb = torch.stack([d[i + 1 : i + block_size + 1] for i in ix])
    return xb, yb

# ── Step 4 — the Bigram model: each token directly predicts the next ──
class BigramModel(nn.Module):
    def __init__(self, vocab_size):
        super().__init__()
        # row for token t = the scores ("logits") for what comes next
        self.token_table = nn.Embedding(vocab_size, vocab_size)

    def forward(self, idx, targets=None):
        logits = self.token_table(idx)                 # (B, T, vocab_size)
        if targets is None:
            return logits, None
        B, T, C = logits.shape
        loss = F.cross_entropy(logits.view(B * T, C), targets.view(B * T))
        return logits, loss

    def generate(self, idx, max_new_tokens):
        # idx is (B, T) — the current context. Grow it one token at a time.
        for _ in range(max_new_tokens):
            logits, _ = self(idx)               # (B, T, vocab)
            logits = logits[:, -1, :]           # keep only the LAST step -> (B, vocab)
            probs = F.softmax(logits, dim=-1)   # scores -> probabilities
            next_id = torch.multinomial(probs, num_samples=1)   # sample 1 -> (B, 1)
            idx = torch.cat((idx, next_id), dim=1)              # append it
        return idx

model = BigramModel(vocab_size)

xb, yb = get_batch("train")
_, loss = model(xb, yb)
print("loss before training:", round(loss.item(), 4))

# ── Step 4b — generate text from the (untrained) model ──
context = torch.zeros((1, 1), dtype=torch.long)   # start from a single newline (id 0)
out = model.generate(context, max_new_tokens=200)[0].tolist()
print("\n--- generated (untrained) ---")
print(decode(out))
