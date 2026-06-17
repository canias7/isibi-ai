# BPE subword tokenizer — built from scratch, on top of our characters.
#
# Big idea: start from characters, then repeatedly glue the most common
# adjacent pair into ONE new token. Common chunks become single tokens.

# ── Piece 1 — starting tokens: turn the text into a list of integer ids ──
text = open("input.txt", encoding="utf-8").read()

chars = sorted(set(text))                       # the character vocabulary
stoi = {ch: i for i, ch in enumerate(chars)}    # char -> id
itos = {i: ch for i, ch in enumerate(chars)}    # id   -> char

ids = [stoi[c] for c in text]                   # the whole text, as a list of ids
print("Start:", len(ids), "tokens,", len(chars), "vocab")

# ── Piece 2 — count how often each adjacent pair appears ──
def count_pairs(ids):
    counts = {}
    for pair in zip(ids, ids[1:]):              # (id0,id1), (id1,id2), (id2,id3)...
        counts[pair] = counts.get(pair, 0) + 1
    return counts

# ── Piece 4 — merge a pair: replace every occurrence with a new id ──
def merge(ids, pair, new_id):
    out = []
    i = 0
    while i < len(ids):
        if i < len(ids) - 1 and ids[i] == pair[0] and ids[i + 1] == pair[1]:
            out.append(new_id)      # found the pair -> drop in the new token
            i += 2                  # skip BOTH of the merged tokens
        else:
            out.append(ids[i])      # no match -> keep this token
            i += 1
    return out

# ── Piece 5 — the training loop: do N merges and RECORD them ──
num_merges = 20

merges = {}                 # (id_a, id_b) -> new_id    (learned rules, in order)
vocab = dict(itos)          # id -> the string it spells (starts as single chars)

work = list(ids)            # a working copy we keep shrinking
for k in range(num_merges):
    counts = count_pairs(work)
    if not counts:
        break
    pair = max(counts, key=counts.get)                # Piece 3: most common pair
    new_id = len(chars) + k                            # next free id: 40, 41, 42...
    work = merge(work, pair, new_id)                   # Piece 4: merge it everywhere
    merges[pair] = new_id                              # remember the rule (order matters)
    vocab[new_id] = vocab[pair[0]] + vocab[pair[1]]    # the string this token spells

print(f"Trained: {len(ids)} -> {len(work)} tokens,  vocab {len(chars)} -> {len(vocab)}")

# ── Piece 6 — encode (text -> ids) and decode (ids -> text) ──
def encode(s):
    tokens = [stoi[c] for c in s]          # start as characters
    for pair, new_id in merges.items():    # apply learned merges, IN ORDER
        tokens = merge(tokens, pair, new_id)
    return tokens

def decode(tokens):
    return "".join(vocab[t] for t in tokens)

sample = "and the night"
enc = encode(sample)
print("\nSample :", repr(sample), f"({len(sample)} chars)")
print("Encoded:", enc, f"({len(enc)} tokens)")
print("Pieces :", [vocab[t] for t in enc])
print("Decoded:", repr(decode(enc)))
print("Round-trip OK:", decode(enc) == sample)
