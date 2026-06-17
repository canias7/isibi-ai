# eval.py — measure the Excel model's accuracy on FRESH, held-out pairs.
# Generates new (description, formula) pairs (different random seed) the model
# never trained on, runs the model, and reports exact-match accuracy:
# overall, per-function (weakest first), and some example misses.
#
#   python3 eval.py
#   EVAL_N=5000 python3 eval.py
# (For checkpoints without saved config, pass NEMBD/NHEAD/NLAYER like ask.py.)

import os, random, collections
import make_data            # generators (import is safe — write is __main__-guarded)
import ask                  # loads the model + the ask() function

N = int(os.environ.get("EVAL_N", 2000))
random.seed(98765)          # different from training (seed 0) -> fresh examples

tests = []
for _ in range(N):
    fn = random.choice(make_data.G)
    desc, formula = fn()
    tests.append((fn.__name__, desc, formula))

correct = 0
by_fn = collections.defaultdict(lambda: [0, 0])   # name -> [right, total]
misses = []
for name, desc, expected in tests:
    got = ask.ask(desc)
    ok = got == expected
    correct += ok
    by_fn[name][0] += ok
    by_fn[name][1] += 1
    if not ok and len(misses) < 12:
        misses.append((desc, expected, got))

print(f"\nOVERALL: {correct}/{N} = {100*correct/N:.1f}% exact match\n")
print("weakest function types:")
for name, (r, t) in sorted(by_fn.items(), key=lambda kv: kv[1][0] / kv[1][1])[:12]:
    print(f"  {name[2:]:14} {100*r/t:5.1f}%  ({r}/{t})")
print("\nsample misses:")
for desc, exp, got in misses:
    print(f"  Q: {desc}")
    print(f"     want {exp}")
    print(f"     got  {got}")
