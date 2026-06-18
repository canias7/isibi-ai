# eval.py — full report card for the Excel model across ALL capabilities.
# Generates fresh held-out pairs (different seed) the model never trained on, then
# reports exact-match % per capability + samples for the generative ones.
#   python3 eval.py
#   EVAL_N=3000 python3 eval.py
# (Checkpoints without saved config: pass NEMBD/NHEAD/NLAYER/BLOCK like ask.py.)

import os, random, collections
import make_data            # generators (import is safe — write is __main__-guarded)
import ask                  # loads the model + the ask() function

N = int(os.environ.get("EVAL_N", 2000))

def _seed(label): random.seed(sum(ord(c) for c in label) + 7)   # stable per-label seed
def _final(a):    return a.split(" => ")[-1].strip() if " => " in a else a   # CoT: final formula only (spaced so JS r=>r.A survives)

# ── core task: description -> formula (with per-type breakdown) ──
random.seed(98765)
tests = [make_data.gen() for _ in range(N)]
correct, by_fn, misses = 0, collections.defaultdict(lambda: [0, 0]), []
for name, desc, expected in tests:
    expected = _final(expected)
    got = ask.ask(desc)
    ok = got == expected
    correct += ok; by_fn[name][0] += ok; by_fn[name][1] += 1
    if not ok and len(misses) < 10:
        misses.append((desc, expected, got))

print(f"\n========== FORMULA (core): {correct}/{N} = {100*correct/N:.1f}% exact ==========")
print("weakest formula types:")
for name, (r, t) in sorted(by_fn.items(), key=lambda kv: kv[1][0] / kv[1][1])[:12]:
    print(f"  {name[2:]:16} {100*r/t:5.1f}%  ({r}/{t})")
print("sample misses:")
for d, e, g in misses:
    print(f"  Q: {d}\n     want {e}\n     got  {g}")

# ── exact-match tasks ──
def score(label, gen, n=None):
    n = n or min(N, 800)
    _seed(label)
    ok, miss = 0, []
    for _ in range(n):
        q, a = gen()
        a = _final(a)
        got = ask.ask(q)
        if got == a:
            ok += 1
        elif len(miss) < 4:
            miss.append((q, a, got))
    print(f"\n{label}: {ok}/{n} = {100*ok/n:.1f}% exact")
    for q, a, g in miss:
        print(f"  Q: {q}\n     want {a}\n     got  {g}")

print("\n========== per-capability exact-match ==========")
score("SPANISH",   make_data.gen_spanish)
score("PORTUGUESE",make_data.gen_portuguese)
score("FRENCH",    make_data.gen_french)
score("GERMAN",    make_data.gen_german)
score("ITALIAN",   make_data.gen_italian)
score("FIX-IT",    make_data.gen_fix)
score("EDIT",      make_data.gen_edit)
score("OPTIMIZE",  make_data.gen_optimize)
score("TRANSPILE", make_data.gen_transpile)
score("REVERSE",   make_data.gen_reverse)
score("NL-SQL",    make_data.gen_nlsql)
score("ABS-REF",   make_data.gen_absref)
score("SOLVE",     make_data.gen_solve)
score("FROM-EX",   make_data.gen_fromex)
score("RULES",     make_data.gen_rules)
score("UNIT-TEST", make_data.gen_unittest)
# understand-&-fix expansion (exact-match refactors)
score("MODERNIZE", make_data.gen_modernize)
score("ADD-ERROR", make_data.gen_adderror)
score("STRIP-ERR", make_data.gen_striperror)
score("REF-LOCK",  make_data.gen_reflock)
score("R1C1",      make_data.gen_r1c1)
score("LOCALE",    make_data.gen_locale)
score("DYNAMIC",   make_data.gen_dynamic)
score("DATA-Q",    make_data.gen_dataground)

# ── generative / spec tasks (eyeball — not exact-match) ──
def show(label, gen, n=5):
    _seed(label)
    print(f"\n{label} samples:")
    for _ in range(n):
        q, a = gen()
        print(f"  Q: {q}\n     -> {ask.ask(q)}")

print("\n========== generative / spec samples ==========")
show("EXPLAIN",     make_data.gen_explain)
show("AUDIT",       make_data.gen_audit)
show("EVALUATE",    make_data.gen_evaluate)
show("CHART/PIVOT", make_data.gen_chart)
show("FORMAT",      make_data.gen_format)
show("CLEAN",       make_data.gen_clean)
show("MODEL",       make_data.gen_model)
show("ACTION",      make_data.gen_action)
show("STEPS",       make_data.gen_steps)
show("DEBUG",       make_data.gen_debug)
show("DOC",         make_data.gen_doc)
show("HOW-TO",      make_data.gen_howto)
show("CHART-REC",   make_data.gen_chartrec)
show("SCRIPT",      make_data.gen_script)
show("KEYBOARD",    make_data.gen_keyboard)
show("VBA",         make_data.gen_vba)
show("GENDATA",     make_data.gen_gendata)
show("DATADICT",    make_data.gen_datadict)
