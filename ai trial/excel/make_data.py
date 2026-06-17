# make_data.py — synthesize (description -> Excel formula) training pairs.
# 100+ formula types across every category. Unlimited, clean, generated data.
# Format: "Q: <plain-english request>\nA: <excel formula>\n\n"

import os, random

random.seed(0)
N = int(os.environ.get("N", 200000))
COLS = list("ABCDEFGHIJKLMN")
WORDS = ["paid", "done", "open", "yes", "no", "active", "north", "south", "east",
         "west", "pending", "shipped", "q1", "q2", "high", "low", "vip", "complete"]

def col():  return random.choice(COLS)
def cell(): return f"{col()}{random.randint(1, 100)}"
def p(*o):  return random.choice(o)
def num():  return random.choice([5, 10, 25, 50, 100, 200, 500, 1000])
def word(): return random.choice(WORDS)
def rng():
    c = col()
    if random.random() < 0.4:
        return f"{c}:{c}", p(f"column {c}", f"the {c} column", f"all of {c}")
    a = random.randint(1, 80); b = a + random.randint(1, 60)
    return f"{c}{a}:{c}{b}", p(f"{c}{a} to {c}{b}", f"the range {c}{a}:{c}{b}", f"cells {c}{a} through {c}{b}")

G = []  # registry of generators
def reg(fn): G.append(fn); return fn

# ── math / aggregate ──
@reg
def g_sum():       r,d=rng(); return p("add up","sum","total","what's the total of")+f" {d}", f"=SUM({r})"
@reg
def g_avg():       r,d=rng(); return p("average of","the mean of","what's the average of")+f" {d}", f"=AVERAGE({r})"
@reg
def g_count():     r,d=rng(); return p("count the numbers in","how many numbers in")+f" {d}", f"=COUNT({r})"
@reg
def g_counta():    r,d=rng(); return p("count non-empty cells in","count all entries in")+f" {d}", f"=COUNTA({r})"
@reg
def g_countblank():r,d=rng(); return "count empty cells in "+d, f"=COUNTBLANK({r})"
@reg
def g_max():       r,d=rng(); return p("highest value in","max of","largest in")+f" {d}", f"=MAX({r})"
@reg
def g_min():       r,d=rng(); return p("lowest value in","min of","smallest in")+f" {d}", f"=MIN({r})"
@reg
def g_round():     c=cell(); k=random.randint(0,3); return f"round {c} to {k} decimals", f"=ROUND({c},{k})"
@reg
def g_roundup():   c=cell(); k=random.randint(0,2); return f"round {c} up to {k} decimals", f"=ROUNDUP({c},{k})"
@reg
def g_rounddown(): c=cell(); k=random.randint(0,2); return f"round {c} down to {k} decimals", f"=ROUNDDOWN({c},{k})"
@reg
def g_abs():       c=cell(); return f"absolute value of {c}", f"=ABS({c})"
@reg
def g_sqrt():      c=cell(); return f"square root of {c}", f"=SQRT({c})"
@reg
def g_power():     c=cell(); k=random.randint(2,4); return f"{c} to the power of {k}", f"=POWER({c},{k})"
@reg
def g_mod():       a=cell(); k=random.randint(2,10); return f"remainder of {a} divided by {k}", f"=MOD({a},{k})"
@reg
def g_int():       c=cell(); return f"integer part of {c}", f"=INT({c})"
@reg
def g_trunc():     c=cell(); return f"truncate {c} to a whole number", f"=TRUNC({c})"
@reg
def g_product():   r,d=rng(); return "multiply all values in "+d, f"=PRODUCT({r})"
@reg
def g_sumproduct():a=col(); b=col(); return f"sum of {a} times {b} row by row", f"=SUMPRODUCT({a}:{a},{b}:{b})"
@reg
def g_ceiling():   c=cell(); k=random.choice([1,5,10,100]); return f"round {c} up to nearest {k}", f"=CEILING({c},{k})"
@reg
def g_floor():     c=cell(); k=random.choice([1,5,10,100]); return f"round {c} down to nearest {k}", f"=FLOOR({c},{k})"
@reg
def g_sign():      c=cell(); return f"the sign of {c}", f"=SIGN({c})"
@reg
def g_ln():        c=cell(); return f"natural log of {c}", f"=LN({c})"
@reg
def g_log10():     c=cell(); return f"log base 10 of {c}", f"=LOG10({c})"
@reg
def g_exp():       c=cell(); return f"e raised to {c}", f"=EXP({c})"
@reg
def g_randbetween():a=random.randint(1,10); b=a+random.randint(10,90); return f"random number between {a} and {b}", f"=RANDBETWEEN({a},{b})"

# ── logical ──
@reg
def g_if():        c=cell(); t=num(); hi,lo=random.choice([("high","low"),("yes","no"),("pass","fail")]); return f"if {c} over {t} say {hi} else {lo}", f'=IF({c}>{t},"{hi}","{lo}")'
@reg
def g_nestedif():  c=cell(); a,b=sorted(random.sample([50,100,200,500],2)); return f"grade {c}: over {b} high, over {a} medium, else low", f'=IF({c}>{b},"high",IF({c}>{a},"medium","low"))'
@reg
def g_ifs():       c=cell(); a,b=sorted(random.sample([50,100,200,500],2)); return f"with IFS: {c} over {b} high, over {a} medium, else low", f'=IFS({c}>{b},"high",{c}>{a},"medium",TRUE,"low")'
@reg
def g_and():       a=cell(); b=cell(); t=num(); return f"true if both {a} and {b} are over {t}", f"=AND({a}>{t},{b}>{t})"
@reg
def g_or():        a=cell(); b=cell(); t=num(); return f"true if {a} or {b} is over {t}", f"=OR({a}>{t},{b}>{t})"
@reg
def g_not():       c=cell(); return f"true if {c} is not blank", f"=NOT(ISBLANK({c}))"
@reg
def g_iferror():   a=cell(); b=cell(); return f"divide {a} by {b}, show 0 if error", f"=IFERROR({a}/{b},0)"
@reg
def g_switch():    c=cell(); return f"switch on {c}: 1 is one, 2 is two, else other", f'=SWITCH({c},1,"one",2,"two","other")'
@reg
def g_xor():       a=cell(); b=cell(); t=num(); return f"true if exactly one of {a} or {b} is over {t}", f"=XOR({a}>{t},{b}>{t})"

# ── conditional aggregates ──
@reg
def g_sumif():     cc=col(); sc=col(); w=word(); return f"sum {sc} where {cc} is {w}", f'=SUMIF({cc}:{cc},"{w}",{sc}:{sc})'
@reg
def g_sumifs():    sc=col(); c1=col(); c2=col(); w1=word(); w2=word(); return f"sum {sc} where {c1} is {w1} and {c2} is {w2}", f'=SUMIFS({sc}:{sc},{c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@reg
def g_countif():   c=col(); w=word(); return f"count {w} in column {c}", f'=COUNTIF({c}:{c},"{w}")'
@reg
def g_countifs():  c1=col(); c2=col(); w1=word(); w2=word(); return f"count rows where {c1} is {w1} and {c2} is {w2}", f'=COUNTIFS({c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@reg
def g_averageif(): cc=col(); ac=col(); w=word(); return f"average {ac} where {cc} is {w}", f'=AVERAGEIF({cc}:{cc},"{w}",{ac}:{ac})'
@reg
def g_averageifs():ac=col(); c1=col(); c2=col(); w1=word(); w2=word(); return f"average {ac} where {c1} is {w1} and {c2} is {w2}", f'=AVERAGEIFS({ac}:{ac},{c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@reg
def g_maxifs():    mc=col(); cc=col(); w=word(); return f"max of {mc} where {cc} is {w}", f'=MAXIFS({mc}:{mc},{cc}:{cc},"{w}")'
@reg
def g_minifs():    mc=col(); cc=col(); w=word(); return f"min of {mc} where {cc} is {w}", f'=MINIFS({mc}:{mc},{cc}:{cc},"{w}")'

# ── lookup / reference ──
@reg
def g_vlookup():   c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4); return f"look up {c} in {t}:{t2} return column {k}", f"=VLOOKUP({c},{t}:{t2},{k},FALSE)"
@reg
def g_hlookup():   c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4); return f"horizontal lookup {c} in {t}:{t2} row {k}", f"=HLOOKUP({c},{t}:{t2},{k},FALSE)"
@reg
def g_xlookup():   c=cell(); kc=col(); rc=col(); return f"xlookup {c} in {kc} returning {rc}", f"=XLOOKUP({c},{kc}:{kc},{rc}:{rc})"
@reg
def g_index():     rc=col(); k=random.randint(1,50); return f"value in {rc} at row {k}", f"=INDEX({rc}:{rc},{k})"
@reg
def g_match():     c=cell(); kc=col(); return f"position of {c} in {kc}", f"=MATCH({c},{kc}:{kc},0)"
@reg
def g_indexmatch():c=cell(); rc=col(); kc=col(); return f"find {rc} where {kc} matches {c}", f"=INDEX({rc}:{rc},MATCH({c},{kc}:{kc},0))"
@reg
def g_xmatch():    c=cell(); kc=col(); return f"xmatch position of {c} in {kc}", f"=XMATCH({c},{kc}:{kc})"
@reg
def g_choose():    k=random.randint(1,3); return f"choose item {k} from red, green, blue", f'=CHOOSE({k},"red","green","blue")'
@reg
def g_offset():    c=cell(); r=random.randint(1,5); cc=random.randint(0,3); return f"value {r} rows below and {cc} right of {c}", f"=OFFSET({c},{r},{cc})"
@reg
def g_rows():      r,d=rng(); return "how many rows in "+d, f"=ROWS({r})"
@reg
def g_columns():   t=col(); t2=chr(ord(t)+2); return f"how many columns in {t}:{t2}", f"=COLUMNS({t}:{t2})"

# ── text ──
@reg
def g_left():      c=cell(); k=random.randint(1,5); return f"first {k} characters of {c}", f"=LEFT({c},{k})"
@reg
def g_right():     c=cell(); k=random.randint(1,5); return f"last {k} characters of {c}", f"=RIGHT({c},{k})"
@reg
def g_mid():       c=cell(); s=random.randint(1,5); k=random.randint(1,5); return f"{k} characters from {c} starting at {s}", f"=MID({c},{s},{k})"
@reg
def g_len():       c=cell(); return f"length of {c}", f"=LEN({c})"
@reg
def g_find():      c=cell(); ch=random.choice(["a","-","@"]); return f'position of "{ch}" in {c}', f'=FIND("{ch}",{c})'
@reg
def g_search():    c=cell(); ch=random.choice(["a","x","z"]); return f'find "{ch}" in {c} ignoring case', f'=SEARCH("{ch}",{c})'
@reg
def g_concat():    a=cell(); b=cell(); return f"join {a} and {b} with a space", f'={a}&" "&{b}'
@reg
def g_textjoin():  a=col(); return f"join all of {a} with commas", f'=TEXTJOIN(", ",TRUE,{a}:{a})'
@reg
def g_upper():     c=cell(); return f"uppercase {c}", f"=UPPER({c})"
@reg
def g_lower():     c=cell(); return f"lowercase {c}", f"=LOWER({c})"
@reg
def g_proper():    c=cell(); return f"capitalize each word in {c}", f"=PROPER({c})"
@reg
def g_trim():      c=cell(); return f"remove extra spaces from {c}", f"=TRIM({c})"
@reg
def g_substitute():c=cell(); a=random.choice(["-"," ",","]); b=random.choice(["/","_"]); return f'replace "{a}" with "{b}" in {c}', f'=SUBSTITUTE({c},"{a}","{b}")'
@reg
def g_replace():   c=cell(); s=random.randint(1,3); k=random.randint(1,3); return f"replace {k} chars in {c} at position {s} with X", f'=REPLACE({c},{s},{k},"X")'
@reg
def g_rept():      c=cell(); k=random.randint(2,5); return f"repeat {c} {k} times", f"=REPT({c},{k})"
@reg
def g_text():      c=cell(); return f"format {c} as currency", f'=TEXT({c},"$#,##0.00")'
@reg
def g_value():     c=cell(); return f"convert text {c} to a number", f"=VALUE({c})"
@reg
def g_exact():     a=cell(); b=cell(); return f"check if {a} exactly equals {b}", f"=EXACT({a},{b})"
@reg
def g_clean():     c=cell(); return f"remove non-printable characters from {c}", f"=CLEAN({c})"

# ── date / time ──
@reg
def g_today():     return p("today's date","insert today's date"), "=TODAY()"
@reg
def g_now():       return "the current date and time", "=NOW()"
@reg
def g_date():      y=random.randint(2018,2025); m=random.randint(1,12); d=random.randint(1,28); return f"build the date for {m}/{d}/{y}", f"=DATE({y},{m},{d})"
@reg
def g_year():      c=cell(); return f"the year from {c}", f"=YEAR({c})"
@reg
def g_month():     c=cell(); return f"the month from {c}", f"=MONTH({c})"
@reg
def g_day():       c=cell(); return f"the day from {c}", f"=DAY({c})"
@reg
def g_weekday():   c=cell(); return f"the weekday number of {c}", f"=WEEKDAY({c})"
@reg
def g_weeknum():   c=cell(); return f"the week number of {c}", f"=WEEKNUM({c})"
@reg
def g_eomonth():   c=cell(); k=random.randint(0,3); return f"last day of the month {k} months after {c}", f"=EOMONTH({c},{k})"
@reg
def g_edate():     c=cell(); k=random.randint(1,6); return f"the date {k} months after {c}", f"=EDATE({c},{k})"
@reg
def g_datedif():   a=cell(); b=cell(); return f"number of days between {a} and {b}", f'=DATEDIF({a},{b},"d")'
@reg
def g_networkdays():a=cell(); b=cell(); return f"working days between {a} and {b}", f"=NETWORKDAYS({a},{b})"
@reg
def g_days():      a=cell(); b=cell(); return f"days from {a} to {b}", f"=DAYS({b},{a})"
@reg
def g_workday():   c=cell(); k=random.randint(5,30); return f"the workday {k} days after {c}", f"=WORKDAY({c},{k})"

# ── statistical ──
@reg
def g_median():    r,d=rng(); return "median of "+d, f"=MEDIAN({r})"
@reg
def g_mode():      r,d=rng(); return "most common value in "+d, f"=MODE({r})"
@reg
def g_stdev():     r,d=rng(); return "standard deviation of "+d, f"=STDEV({r})"
@reg
def g_var():       r,d=rng(); return "variance of "+d, f"=VAR({r})"
@reg
def g_percentile():r,d=rng(); pc=random.choice([0.25,0.5,0.75,0.9]); return f"the {int(pc*100)}th percentile of {d}", f"=PERCENTILE({r},{pc})"
@reg
def g_quartile():  r,d=rng(); k=random.randint(1,3); return f"quartile {k} of {d}", f"=QUARTILE({r},{k})"
@reg
def g_rank():      c=cell(); r,d=rng(); return f"rank of {c} within {d}", f"=RANK({c},{r})"
@reg
def g_large():     r,d=rng(); k=random.randint(2,5); return f"the {k}th largest in {d}", f"=LARGE({r},{k})"
@reg
def g_small():     r,d=rng(); k=random.randint(2,5); return f"the {k}th smallest in {d}", f"=SMALL({r},{k})"
@reg
def g_correl():    a=col(); b=col(); return f"correlation between {a} and {b}", f"=CORREL({a}:{a},{b}:{b})"

# ── financial ──
@reg
def g_pmt():       r=cell(); n=cell(); pv=cell(); return f"loan payment with rate {r}, periods {n}, present value {pv}", f"=PMT({r},{n},{pv})"
@reg
def g_fv():        r=cell(); n=cell(); pmt=cell(); return f"future value with rate {r}, periods {n}, payment {pmt}", f"=FV({r},{n},{pmt})"
@reg
def g_pv():        r=cell(); n=cell(); pmt=cell(); return f"present value with rate {r}, periods {n}, payment {pmt}", f"=PV({r},{n},{pmt})"
@reg
def g_npv():       r=cell(); cf=col(); return f"net present value at rate {r} of {cf}", f"=NPV({r},{cf}:{cf})"
@reg
def g_irr():       cf=col(); return f"internal rate of return of {cf}", f"=IRR({cf}:{cf})"
@reg
def g_nper():      r=cell(); pmt=cell(); pv=cell(); return f"number of periods, rate {r}, payment {pmt}, value {pv}", f"=NPER({r},{pmt},{pv})"

# ── dynamic arrays / info ──
@reg
def g_filter():    a=col(); cc=col(); w=word(); return f"filter {a} where {cc} is {w}", f'=FILTER({a}:{a},{cc}:{cc}="{w}")'
@reg
def g_sort():      a=col(); return f"sort {a} ascending", f"=SORT({a}:{a})"
@reg
def g_unique():    a=col(); return f"unique values in {a}", f"=UNIQUE({a}:{a})"
@reg
def g_sequence():  k=random.randint(5,20); return f"a list of numbers 1 to {k}", f"=SEQUENCE({k})"
@reg
def g_transpose(): r,d=rng(); return "flip "+d+" from a column into a row", f"=TRANSPOSE({r})"
@reg
def g_isblank():   c=cell(); return f"check if {c} is empty", f"=ISBLANK({c})"
@reg
def g_isnumber():  c=cell(); return f"check if {c} is a number", f"=ISNUMBER({c})"
@reg
def g_istext():    c=cell(); return f"check if {c} is text", f"=ISTEXT({c})"
@reg
def g_iserror():   c=cell(); return f"check if {c} is an error", f"=ISERROR({c})"

with open("excel.txt", "w", encoding="utf-8") as f:
    for _ in range(N):
        desc, formula = random.choice(G)()
        f.write(f"Q: {desc}\nA: {formula}\n\n")

print(f"wrote {N} examples to excel.txt  ({len(G)} formula types)")
