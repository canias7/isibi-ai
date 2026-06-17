# make_data.py — synthesize (description -> Excel formula) training pairs.
# Foundation of the Excel model: unlimited, clean data we GENERATE.
# Format: "Q: <plain-english request>\nA: <excel formula>\n\n"

import os, random

random.seed(0)
N = int(os.environ.get("N", 200000))
COLS = list("ABCDEFGHIJKLMN")
WORDS = ["paid", "done", "open", "yes", "no", "active", "north", "south", "east",
         "west", "pending", "shipped", "q1", "q2", "high", "low", "vip", "complete"]

def col():  return random.choice(COLS)
def cell(): return f"{col()}{random.randint(1, 100)}"
def p(*opts): return random.choice(opts)

def rng_and_desc():
    c = col()
    if random.random() < 0.4:
        return f"{c}:{c}", p(f"column {c}", f"the {c} column", f"all of {c}")
    a = random.randint(1, 80); b = a + random.randint(1, 60)
    return f"{c}{a}:{c}{b}", p(f"{c}{a} to {c}{b}", f"cells {c}{a} through {c}{b}", f"the range {c}{a}:{c}{b}")

# ── aggregates ──
def ex_sum():
    r, d = rng_and_desc(); return p("add up", "sum", "total", "what's the total of", "give me the sum of") + f" {d}", f"=SUM({r})"
def ex_avg():
    r, d = rng_and_desc(); return p("average of", "the mean of", "what's the average of") + f" {d}", f"=AVERAGE({r})"
def ex_max():
    r, d = rng_and_desc(); return p("highest value in", "max of", "the biggest in", "largest value in") + f" {d}", f"=MAX({r})"
def ex_min():
    r, d = rng_and_desc(); return p("lowest value in", "min of", "the smallest in") + f" {d}", f"=MIN({r})"
def ex_count():
    r, d = rng_and_desc(); return p("count the numbers in", "how many numbers in", "count") + f" {d}", f"=COUNT({r})"
def ex_counta():
    r, d = rng_and_desc(); return p("count non-empty cells in", "how many filled cells in", "count all entries in") + f" {d}", f"=COUNTA({r})"

# ── conditional ──
def ex_if():
    c = cell(); t = random.choice([10, 50, 100, 250, 500, 1000])
    hi, lo = random.choice([("high", "low"), ("yes", "no"), ("pass", "fail"), ("ok", "review")])
    return p(f"if {c} is over {t} say {hi} otherwise {lo}", f"if {c} greater than {t} then {hi} else {lo}",
             f"mark {c} as {hi} when above {t} else {lo}"), f'=IF({c}>{t},"{hi}","{lo}")'
def ex_nested_if():
    c = cell(); a, b = sorted(random.sample([50, 100, 200, 500], 2))
    return p(f"grade {c}: over {b} high, over {a} medium, else low",
             f"if {c} above {b} high, above {a} medium, otherwise low"), f'=IF({c}>{b},"high",IF({c}>{a},"medium","low"))'
def ex_countif():
    c = col(); w = random.choice(WORDS)
    return p(f"count cells in column {c} equal to {w}", f"how many {w} in column {c}", f"count {w} entries in {c}"), f'=COUNTIF({c}:{c},"{w}")'
def ex_countifs():
    c1 = col(); c2 = col(); w1 = random.choice(WORDS); w2 = random.choice(WORDS)
    return p(f"count rows where {c1} is {w1} and {c2} is {w2}", f"how many rows have {c1}={w1} and {c2}={w2}"), f'=COUNTIFS({c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
def ex_sumif():
    cc = col(); sc = col(); w = random.choice(WORDS)
    return p(f"sum column {sc} where column {cc} is {w}", f"total {sc} for rows where {cc} equals {w}",
             f"add up {sc} when {cc} is {w}"), f'=SUMIF({cc}:{cc},"{w}",{sc}:{sc})'
def ex_sumifs():
    sc = col(); c1 = col(); c2 = col(); w1 = random.choice(WORDS); w2 = random.choice(WORDS)
    return p(f"sum {sc} where {c1} is {w1} and {c2} is {w2}", f"total {sc} for {c1}={w1} and {c2}={w2}"), f'=SUMIFS({sc}:{sc},{c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
def ex_averageif():
    cc = col(); ac = col(); w = random.choice(WORDS)
    return p(f"average of {ac} where {cc} is {w}", f"mean {ac} for rows where {cc} equals {w}"), f'=AVERAGEIF({cc}:{cc},"{w}",{ac}:{ac})'

# ── lookup ──
def ex_vlookup():
    c = cell(); t = col(); t2 = chr(ord(t) + 1); k = random.randint(2, 4)
    return p(f"look up {c} in {t}:{t2} and return column {k}", f"find {c} in the table {t}:{t2}, give column {k}"), f"=VLOOKUP({c},{t}:{t2},{k},FALSE)"
def ex_index_match():
    c = cell(); rc = col(); kc = col()
    return p(f"find the {rc} value where {kc} matches {c}", f"look up {c} in {kc} and return {rc}"), f"=INDEX({rc}:{rc},MATCH({c},{kc}:{kc},0))"

# ── text ──
def ex_left():
    c = cell(); k = random.randint(1, 5); return p(f"first {k} characters of {c}", f"leftmost {k} letters of {c}"), f"=LEFT({c},{k})"
def ex_right():
    c = cell(); k = random.randint(1, 5); return p(f"last {k} characters of {c}", f"rightmost {k} letters of {c}"), f"=RIGHT({c},{k})"
def ex_len():
    c = cell(); return p(f"length of {c}", f"how many characters in {c}", f"number of letters in {c}"), f"=LEN({c})"
def ex_concat():
    a = cell(); b = cell(); return p(f"join {a} and {b} with a space", f"combine {a} and {b}"), f'={a}&" "&{b}'
def ex_upper():
    c = cell(); return p(f"uppercase {c}", f"make {c} all caps"), f"=UPPER({c})"
def ex_trim():
    c = cell(); return p(f"remove extra spaces from {c}", f"trim spaces in {c}"), f"=TRIM({c})"

# ── math / misc ──
def ex_pct():
    a = cell(); b = cell(); return p(f"{a} as a percent of {b}", f"what percent {a} is of {b}"), f"={a}/{b}"
def ex_round():
    c = cell(); dd = random.randint(0, 3); return p(f"round {c} to {dd} decimals", f"round {c} to {dd} decimal places"), f"=ROUND({c},{dd})"
def ex_abs():
    c = cell(); return p(f"absolute value of {c}", f"make {c} positive"), f"=ABS({c})"
def ex_iferror():
    a = cell(); b = cell(); return p(f"divide {a} by {b}, show 0 if error", f"{a} over {b} but 0 on error"), f"=IFERROR({a}/{b},0)"
def ex_today():
    return p("today's date", "insert today's date", "the current date"), "=TODAY()"

GENS = [ex_sum, ex_avg, ex_max, ex_min, ex_count, ex_counta,
        ex_if, ex_nested_if, ex_countif, ex_countifs, ex_sumif, ex_sumifs, ex_averageif,
        ex_vlookup, ex_index_match,
        ex_left, ex_right, ex_len, ex_concat, ex_upper, ex_trim,
        ex_pct, ex_round, ex_abs, ex_iferror, ex_today]

with open("excel.txt", "w", encoding="utf-8") as f:
    for _ in range(N):
        desc, formula = random.choice(GENS)()
        f.write(f"Q: {desc}\nA: {formula}\n\n")

print(f"wrote {N} examples to excel.txt  ({len(GENS)} formula types)")
