# make_data.py — synthesize (description -> Excel formula) training pairs.
# This is the FOUNDATION of the Excel model: unlimited, clean data we GENERATE.
# Format: "Q: <plain-english request>\nA: <excel formula>\n\n"

import os, random

random.seed(0)
N = int(os.environ.get("N", 200000))
COLS = list("ABCDEFGHIJKLMN")

def rng_and_desc():
    c = random.choice(COLS)
    if random.random() < 0.4:
        return f"{c}:{c}", random.choice([f"column {c}", f"the {c} column", f"all of {c}"])
    a = random.randint(1, 80); b = a + random.randint(1, 60)
    return f"{c}{a}:{c}{b}", random.choice([f"{c}{a} to {c}{b}",
                                            f"cells {c}{a} through {c}{b}",
                                            f"the range {c}{a}:{c}{b}"])

def cell():
    return f"{random.choice(COLS)}{random.randint(1, 100)}"

def p(*opts):                      # pick a random phrasing
    return random.choice(opts)

def ex_sum():
    r, d = rng_and_desc(); return p("add up", "sum", "total", "get the total of") + f" {d}", f"=SUM({r})"
def ex_avg():
    r, d = rng_and_desc(); return p("average of", "the mean of", "average") + f" {d}", f"=AVERAGE({r})"
def ex_max():
    r, d = rng_and_desc(); return p("highest value in", "max of", "largest in") + f" {d}", f"=MAX({r})"
def ex_min():
    r, d = rng_and_desc(); return p("lowest value in", "min of", "smallest in") + f" {d}", f"=MIN({r})"
def ex_count():
    r, d = rng_and_desc(); return p("count the numbers in", "how many numbers in", "count") + f" {d}", f"=COUNT({r})"
def ex_if():
    c = cell(); t = random.choice([10, 50, 100, 250, 500, 1000])
    hi, lo = random.choice([("high", "low"), ("yes", "no"), ("pass", "fail"), ("ok", "review")])
    return p(f"if {c} is over {t} say {hi} otherwise {lo}",
             f"if {c} greater than {t} then {hi} else {lo}"), f'=IF({c}>{t},"{hi}","{lo}")'
def ex_countif():
    c = random.choice(COLS); w = random.choice(["paid", "done", "open", "yes", "no", "active", "north", "south"])
    return p(f"count cells in column {c} equal to {w}", f"how many {w} in column {c}"), f'=COUNTIF({c}:{c},"{w}")'
def ex_sumif():
    cc = random.choice(COLS); sc = random.choice(COLS); w = random.choice(["paid", "done", "yes", "north", "south", "q1"])
    return p(f"sum column {sc} where column {cc} is {w}",
             f"total {sc} for rows where {cc} equals {w}"), f'=SUMIF({cc}:{cc},"{w}",{sc}:{sc})'
def ex_vlookup():
    c = cell(); t = random.choice(COLS); t2 = chr(ord(t) + 1); col = random.randint(2, 4)
    return p(f"look up {c} in {t}:{t2} and return column {col}",
             f"find {c} in the table {t}:{t2}, give column {col}"), f"=VLOOKUP({c},{t}:{t2},{col},FALSE)"
def ex_round():
    c = cell(); dd = random.randint(0, 3)
    return p(f"round {c} to {dd} decimals", f"round {c} to {dd} decimal places"), f"=ROUND({c},{dd})"

GENS = [ex_sum, ex_avg, ex_max, ex_min, ex_count, ex_if, ex_countif, ex_sumif, ex_vlookup, ex_round]

with open("excel.txt", "w", encoding="utf-8") as f:
    for _ in range(N):
        desc, formula = random.choice(GENS)()
        f.write(f"Q: {desc}\nA: {formula}\n\n")

print(f"wrote {N} examples to excel.txt  ({len(GENS)} formula types)")
