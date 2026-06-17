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

print("Text length :", len(text))
print("Vocab size  :", len(chars))
print("First 20 ids:", ids[:20])

# ── Piece 2 — count how often each adjacent pair appears ──
def count_pairs(ids):
    counts = {}
    for pair in zip(ids, ids[1:]):              # (id0,id1), (id1,id2), (id2,id3)...
        counts[pair] = counts.get(pair, 0) + 1
    return counts

pair_counts = count_pairs(ids)

top5 = sorted(pair_counts.items(), key=lambda kv: kv[1], reverse=True)[:5]
print("\nTop 5 most common pairs:")
for (a, b), n in top5:
    print(f"  {itos[a]!r} + {itos[b]!r}  ->  {n} times")

# ── Piece 3 — find the SINGLE most common pair ──
top_pair = max(pair_counts, key=pair_counts.get)
a, b = top_pair
print(f"\nMost common pair: {itos[a]!r} + {itos[b]!r}  ({pair_counts[top_pair]} times)")

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

new_id = len(chars)                 # next free id (0..39 are taken, so 40)
ids2 = merge(ids, top_pair, new_id)

print(f"\nMerged {itos[a]!r}+{itos[b]!r} into new token id {new_id}")
print("Length before:", len(ids))
print("Length after :", len(ids2))
print("Tokens saved :", len(ids) - len(ids2))
