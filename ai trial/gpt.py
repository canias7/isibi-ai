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
torch.manual_seed(1337)                          # makes the random batch reproducible

train_data = torch.tensor(train_data, dtype=torch.long)
val_data   = torch.tensor(val_data,   dtype=torch.long)

block_size = 8     # how many characters of context the model sees at once

x = train_data[:block_size]
y = train_data[1:block_size + 1]
print("\nx (input) :", x.tolist())
print("y (target):", y.tolist())
print(f"\nInside one block there are {block_size} examples:")
for t in range(block_size):
    context = x[:t + 1]
    target = y[t]
    print(f"  {decode(context.tolist())!r:12} -> {decode([target.item()])!r}")

# ── Step 3b — batching: grab B random blocks at once ──
batch_size = 4     # how many independent sequences we process in parallel

def get_batch(split):
    d = train_data if split == "train" else val_data
    ix = torch.randint(len(d) - block_size, (batch_size,))         # B random starts
    xb = torch.stack([d[i : i + block_size] for i in ix])          # (B, block_size) inputs
    yb = torch.stack([d[i + 1 : i + block_size + 1] for i in ix])  # (B, block_size) targets
    return xb, yb

xb, yb = get_batch("train")
print("\nbatch inputs  xb:", tuple(xb.shape))    # (batch_size, block_size)
print(xb)
print("batch targets yb:", tuple(yb.shape))
print(yb)
