# freeze_tokenizer.py — build the BPE tokenizer ONCE for the Excel data, then freeze it.
# Run a single time. After that the vocab is locked (so training can resume).

import os, re, json, time, collections

MERGES = int(os.environ.get("MERGES", 500))     # Excel is narrow, a small vocab is plenty
SAMPLE = int(os.environ.get("SAMPLE", 50_000_000))

text = open("excel.txt", encoding="utf-8").read()[:SAMPLE]
pieces = re.findall(r"\s+|\w+|[^\s\w]+", text)
freq = collections.Counter(pieces)
words = {p: list(p) for p in freq}
print(f"learning tokenizer from {len(text):,} chars | {len(freq):,} unique pieces")

def get_stats(words, freq):
    pairs = collections.Counter()
    for p, syms in words.items():
        f = freq[p]
        for a, b in zip(syms, syms[1:]):
            pairs[(a, b)] += f
    return pairs

def merge_word(syms, a, b, ab):
    out, j = [], 0
    while j < len(syms):
        if j < len(syms) - 1 and syms[j] == a and syms[j + 1] == b:
            out.append(ab); j += 2
        else:
            out.append(syms[j]); j += 1
    return out

merges = []
t0 = time.time()
for i in range(MERGES):
    pairs = get_stats(words, freq)
    if not pairs:
        break
    (a, b), _ = pairs.most_common(1)[0]
    merges.append([a, b])
    words = {p: merge_word(s, a, b, a + b) for p, s in words.items()}
    if i % 100 == 0:
        print(f"  merge {i}/{MERGES}  ({time.time()-t0:.0f}s)")

chars = sorted(set(text))
json.dump({"chars": chars, "merges": merges}, open("tokenizer.json", "w"))
print(f"FROZEN: {len(chars)} base chars + {len(merges)} merges + <UNK> "
      f"= {len(chars) + len(merges) + 1} vocab")
print(f"saved tokenizer.json in {time.time()-t0:.0f}s  —  do NOT run this again")
