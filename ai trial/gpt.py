# gpt.py — building a tiny GPT from scratch, step by step.
# Step 2: turn the whole text into training data (encode + train/val split).

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

# ── Step 2a — encode the WHOLE text into one long list of ids ──
data = encode(text)
print("Vocab size  :", vocab_size)
print("Total tokens:", len(data))
print("First 20 ids:", data[:20])

# ── Step 2b — split into train (90%) and validation (10%) ──
n = int(0.9 * len(data))      # the 90% mark
train_data = data[:n]         # first 90%  -> the model LEARNS from this
val_data   = data[n:]         # last 10%   -> held out, NEVER trained on

print("Train tokens:", len(train_data))
print("Val tokens  :", len(val_data))
