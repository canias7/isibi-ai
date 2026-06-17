# build_data.py — gather a Python code corpus to train our from-scratch model on.
# (This is Phase 1: data. Same idea as input.txt for the poem — but now it's real code.)

import os, sysconfig, random

# Collect Python source files from the standard library (real, idiomatic Python).
root = sysconfig.get_paths()["stdlib"]
files = []
for dirpath, _, names in os.walk(root):
    for nm in names:
        if nm.endswith(".py"):
            files.append(os.path.join(dirpath, nm))

random.seed(0)
random.shuffle(files)

CAP = 5_000_000          # ~5 MB cap, so training stays feasible on a laptop
chunks, total = [], 0
for fp in files:
    try:
        with open(fp, encoding="utf-8") as f:
            txt = f.read()
    except Exception:
        continue          # skip files with odd encodings
    chunks.append(txt)
    total += len(txt)
    if total >= CAP:
        break

code = "\n\n".join(chunks)
with open("code.txt", "w", encoding="utf-8") as f:
    f.write(code)

print("files used         :", len(chunks))
print("total characters   :", len(code))
print("unique chars (vocab):", len(set(code)))
print("\n----- sample (first 600 chars) -----")
print(code[:600])
