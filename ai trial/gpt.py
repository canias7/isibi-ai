# gpt.py — building a tiny GPT from scratch, step by step.
# Step 2: encode + train/val split.   Step 3: batching.

# ── The char-level tokenizer (from tokenizer.py) ──
text = open("input.txt", encoding="utf-8").read()

chars = sorted(set(text))
vocab_size = len(chars)
stoi = {ch: i for i, ch in enumerate(chars)}   # char -> id
itos = {i: ch for i, ch in enumerate(chars)}   # id   -> char

def encode(s):
    return [stoi[c] for c in s]                 # text -> list of ids

def decode(ids):
    return "".join(itos[i] for i in ids)        # ids  -> text

# ── Step 2 — encode the whole text, split into train (90%) / val (10%) ──
data = encode(text)
n = int(0.9 * len(data))
train_data = data[:n]
val_data   = data[n:]
print("Vocab:", vocab_size, "| total:", len(data),
      "| train:", len(train_data), "| val:", len(val_data))

# ── Step 3a — input/target pairs: "predict the next token" ──
import torch                                     # PyTorch enters here

train_data = torch.tensor(train_data, dtype=torch.long)
val_data   = torch.tensor(val_data,   dtype=torch.long)

block_size = 8     # how many characters of context the model sees at once

x = train_data[:block_size]        # input : chars 0..7
y = train_data[1:block_size + 1]   # target: chars 1..8  (x shifted by ONE)

print("\nx (input) :", x.tolist())
print("y (target):", y.tolist())
print(f"\nInside one block there are {block_size} examples:")
for t in range(block_size):
    context = x[:t + 1]
    target = y[t]
    print(f"  {decode(context.tolist())!r:12} -> {decode([target.item()])!r}")
