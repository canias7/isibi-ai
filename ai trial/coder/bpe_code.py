# bpe_code.py — train a BPE tokenizer on the code corpus (the FAST version).
# Same idea as your toy bpe.py, but it works on unique "pieces" weighted by how
# often they occur (the real Sennrich trick), so it scales to millions of chars.

import os, re, json, time, collections

text = open("code.txt", encoding="utf-8").read()

# Split the code into pieces: runs of whitespace, runs of word-chars, runs of symbols.
pieces = re.findall(r"\s+|\w+|[^\s\w]+", text)
freq = collections.Counter(pieces)                 # how often each piece appears
print(f"total pieces: {len(pieces):,} | unique pieces: {len(freq):,}")

# Represent each UNIQUE piece as a list of characters (we merge inside these).
words = {p: list(p) for p in freq}

def get_stats(words, freq):
    pairs = collections.Counter()
    for p, syms in words.items():
        f = freq[p]
        for a, b in zip(syms, syms[1:]):
            pairs[(a, b)] += f                      # count pairs, weighted by frequency
    return pairs

def merge_word(syms, a, b, ab):
    out, j = [], 0
    while j < len(syms):
        if j < len(syms) - 1 and syms[j] == a and syms[j + 1] == b:
            out.append(ab); j += 2
        else:
            out.append(syms[j]); j += 1
    return out

NUM_MERGES = int(os.environ.get("MERGES", 400))   # bigger vocab for the GPU run, e.g. MERGES=2000
merges = []
t0 = time.time()
for i in range(NUM_MERGES):
    pairs = get_stats(words, freq)
    if not pairs:
        break
    (a, b), count = pairs.most_common(1)[0]        # most common adjacent pair
    ab = a + b
    merges.append([a, b])
    words = {p: merge_word(syms, a, b, ab) for p, syms in words.items()}
    if i < 30 or i % 50 == 0:
        print(f"merge {i:3d}: {a!r} + {b!r} -> {ab!r}   ({count:,}x)")

print(f"\ntrained {len(merges)} merges in {time.time()-t0:.0f}s")

# Save the learned merges for the next step (encoding + training the model).
json.dump(merges, open("merges.json", "w"))

# Show off the Python building-blocks it discovered (the multi-char tokens).
learned = [a + b for a, b in merges]
keywords = [t for t in learned if t.strip().isidentifier() and len(t.strip()) >= 3]
print("\nReal code tokens it discovered:")
print("  ", keywords[:40])
