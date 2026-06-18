# make_data.py — synthesize (description -> Excel formula) training pairs.
# 100+ formula types across every category. Unlimited, clean, generated data.
# Format: "Q: <plain-english request>\nA: <excel formula>\n\n"

import os, re, random

random.seed(0)
N = int(os.environ.get("N", 600000))   # way bigger default; override with N=2000000 etc. for more
COT = os.environ.get("COT", "0") == "1"   # chain-of-thought on the reasoning-heavy types
COLS = list("ABCDEFGHIJKLMN")
WORDS = ["paid", "done", "open", "yes", "no", "active", "north", "south", "east",
         "west", "pending", "shipped", "q1", "q2", "high", "low", "vip", "complete"]

def col():  return random.choice(COLS)
def cell(): return f"{col()}{random.randint(1, 100)}"
def p(*o):  return random.choice(o)
def num():  return random.choice([1, 2, 3, 5, 10, 15, 20, 25, 30, 50, 75, 100,
                                  150, 200, 250, 500, 750, 1000, 5000, 10000])
def word(): return random.choice(WORDS)
def rng():
    c = col()
    if random.random() < 0.4:
        return f"{c}:{c}", p(f"column {c}", f"the {c} column", f"all of {c}",
                             f"everything in {c}", f"the whole {c} column",
                             f"column {c} values", f"values in {c}", f"the {c} values",
                             f"all values in column {c}", f"the data in column {c}")
    a = random.randint(1, 80); b = a + random.randint(1, 60)
    return f"{c}{a}:{c}{b}", p(f"{c}{a} to {c}{b}", f"the range {c}{a}:{c}{b}",
                               f"cells {c}{a} through {c}{b}", f"{c}{a}:{c}{b}",
                               f"from {c}{a} to {c}{b}", f"rows {a} to {b} of {c}",
                               f"{c}{a} through {c}{b}", f"the cells {c}{a}:{c}{b}")
def xy():
    # two parallel numeric ranges + the next x cell (for regression / forecasting)
    yc, xc = random.sample(COLS, 2)
    a = random.randint(2, 30); b = a + random.randint(8, 50)
    return f"{yc}{a}:{yc}{b}", f"{xc}{a}:{xc}{b}", f"{xc}{b+1}", yc, xc

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
def g_rank():      c=cell(); r,d=rng(); return f"rank of {c} within {d}", f"=RANK.EQ({c},{r})"
@reg
def g_large():     r,d=rng(); k=random.randint(2,5); return f"the {k}th largest in {d}", f"=LARGE({r},{k})"
@reg
def g_small():     r,d=rng(); k=random.randint(2,5); return f"the {k}th smallest in {d}", f"=SMALL({r},{k})"
@reg
def g_correl():    a=col(); b=col(); return f"correlation between {a} and {b}", f"=CORREL({a}:{a},{b}:{b})"

# ── analysis / trends / forecasting (covers "analyze data") ──
# Whole-column ranges so the request is WELL-POSED (the description fully determines
# the formula); TREND/FORECAST/GROWTH state the new-x cell so it's reproducible.
@reg
def g_trend():      yc,xc=random.sample(COLS,2); nx=f"{xc}{random.randint(2,100)}"; return p(f"predict {yc} from {xc} at {nx}", f"extend the trend of {yc} on {xc} to {nx}"), f"=TREND({yc}:{yc},{xc}:{xc},{nx})"
@reg
def g_forecast():   yc,xc=random.sample(COLS,2); nx=f"{xc}{random.randint(2,100)}"; return p(f"forecast {yc} when {xc} is {nx}", f"linear forecast of {yc} at {xc} {nx}"), f"=FORECAST.LINEAR({nx},{yc}:{yc},{xc}:{xc})"
@reg
def g_slope():      yc,xc=random.sample(COLS,2); return p(f"slope of {yc} versus {xc}", f"how much {yc} changes per unit of {xc}"), f"=SLOPE({yc}:{yc},{xc}:{xc})"
@reg
def g_intercept():  yc,xc=random.sample(COLS,2); return f"intercept of {yc} against {xc}", f"=INTERCEPT({yc}:{yc},{xc}:{xc})"
@reg
def g_rsq():        yc,xc=random.sample(COLS,2); return p(f"r squared of {yc} against {xc}", f"how well {xc} explains {yc}"), f"=RSQ({yc}:{yc},{xc}:{xc})"
@reg
def g_growth():     yc,xc=random.sample(COLS,2); nx=f"{xc}{random.randint(2,100)}"; return f"exponential forecast of {yc} from {xc} at {nx}", f"=GROWTH({yc}:{yc},{xc}:{xc},{nx})"
@reg
def g_covar():      a=col(); b=col(); return f"covariance of {a} and {b}", f"=COVARIANCE.P({a}:{a},{b}:{b})"
@reg
def g_pearson():    a=col(); b=col(); return f"pearson correlation of {a} and {b}", f"=PEARSON({a}:{a},{b}:{b})"
@reg
def g_rankeq():     c=cell(); r,d=rng(); return f"rank of {c} within {d}", f"=RANK.EQ({c},{r})"
@reg
def g_percentrank():c=cell(); r,d=rng(); return f"percentile rank of {c} in {d}", f"=PERCENTRANK({r},{c})"
@reg
def g_geomean():    r,d=rng(); return "geometric mean of "+d, f"=GEOMEAN({r})"
@reg
def g_harmean():    r,d=rng(); return "harmonic mean of "+d, f"=HARMEAN({r})"
@reg
def g_trimmean():   r,d=rng(); pc=random.choice([0.1,0.2]); return f"trimmed mean of {d} dropping {int(pc*100)} percent", f"=TRIMMEAN({r},{pc})"
@reg
def g_skew():       r,d=rng(); return "skewness of "+d, f"=SKEW({r})"
@reg
def g_kurt():       r,d=rng(); return "kurtosis of "+d, f"=KURT({r})"
@reg
def g_stdevp():     r,d=rng(); return "population standard deviation of "+d, f"=STDEV.P({r})"
@reg
def g_varp():       r,d=rng(); return "population variance of "+d, f"=VAR.P({r})"
@reg
def g_pct_of_total():c=cell(); return f"{c} as a percent of the {c[0]} total", f"={c}/SUM({c[0]}:{c[0]})"
@reg
def g_running_total():c=cell(); return f"running total up to {c}", f"=SUM(${c[0]}$1:{c})"
@reg
def g_pct_change(): cl=col(); a=random.randint(1,80); b=a+1; return p(f"percent change from {cl}{a} to {cl}{b}", f"growth rate from {cl}{a} to {cl}{b}"), f"=({cl}{b}-{cl}{a})/{cl}{a}"
@reg
def g_cagr():       cl=col(); a=random.randint(1,5); n=random.randint(2,10); b=a+n; return f"compound annual growth rate from {cl}{a} to {cl}{b} over {n} years", f"=({cl}{b}/{cl}{a})^(1/{n})-1"
@reg
def g_moving_avg():
    c=cell(); k=random.choice([3,5,7]); cl=c[0]; row=int(c[1:]); s=max(1,row-k+1)
    f=f"=AVERAGE({cl}{s}:{cl}{row})"; desc=f"{k}-period moving average ending at {c}"
    if COT: return desc, f"{k} periods ending at row {row}, start = {row}-{k}+1 = {s} => {f}"
    return desc, f
G += [g_moving_avg] * 3   # oversample 4x — window arithmetic is the one real weak spot
@reg
def g_frequency():  d=col(); b=col(); return f"frequency of {d} into the bins in {b}", f"=FREQUENCY({d}:{d},{b}:{b})"
@reg
def g_pivot_sum():  cc=col(); sc=col(); return p(f"total {sc} for each {cc}", f"pivot {sc} by {cc}"), f"=SUMIF({cc}:{cc},UNIQUE({cc}:{cc}),{sc}:{sc})"
@reg
def g_pivot_count():cc=col(); return f"count of rows for each value in {cc}", f"=COUNTIF({cc}:{cc},UNIQUE({cc}:{cc}))"

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

# ── numeric criteria (count / sum / average by a number threshold) ──
def opn():  return random.choice([">", "<", ">=", "<="])
def opw(o): return {">":"greater than", "<":"less than", ">=":"at least", "<=":"at most"}[o]
@reg
def g_countif_num():  c=col(); o=opn(); n=num(); return f"count cells in {c} {opw(o)} {n}", f'=COUNTIF({c}:{c},"{o}{n}")'
@reg
def g_sumif_num():    c=col(); o=opn(); n=num(); return f"sum cells in {c} {opw(o)} {n}", f'=SUMIF({c}:{c},"{o}{n}")'
@reg
def g_averageif_num():c=col(); o=opn(); n=num(); return f"average cells in {c} {opw(o)} {n}", f'=AVERAGEIF({c}:{c},"{o}{n}")'
@reg
def g_countif_eq():   c=col(); n=num(); return f"count cells in {c} equal to {n}", f"=COUNTIF({c}:{c},{n})"
@reg
def g_countbetween(): c=col(); a=num(); b=a+num(); return f"count cells in {c} between {a} and {b}", f'=COUNTIFS({c}:{c},">={a}",{c}:{c},"<={b}")'
@reg
def g_sumbetween():   c=col(); a=num(); b=a+num(); return f"sum cells in {c} between {a} and {b}", f'=SUMIFS({c}:{c},{c}:{c},">={a}",{c}:{c},"<={b}")'

# ── comparison variants (< , = , >=) ──
@reg
def g_if_lt():  c=cell(); t=num(); return f"if {c} is under {t} say low otherwise ok", f'=IF({c}<{t},"low","ok")'
@reg
def g_if_eq():  c=cell(); w=word(); return f"if {c} equals {w} say yes otherwise no", f'=IF({c}="{w}","yes","no")'
@reg
def g_if_gte(): c=cell(); t=num(); return f"if {c} is at least {t} say pass otherwise fail", f'=IF({c}>={t},"pass","fail")'

# ── text formatting variants ──
@reg
def g_text_pct():   c=cell(); return f"format {c} as a percentage", f'=TEXT({c},"0.00%")'
@reg
def g_text_comma(): c=cell(); return f"format {c} with thousands separators", f'=TEXT({c},"#,##0")'
@reg
def g_text_date():  c=cell(); return f"format {c} as a date", f'=TEXT({c},"mm/dd/yyyy")'
@reg
def g_text_dec():   c=cell(); k=random.randint(1,3); z="0"*k; return f"format {c} to {k} decimal places", f'=TEXT({c},"0.{z}")'

# ── named columns: real headers, not letters. The sheet bridge maps name -> range ──
HEADERS = ["revenue","sales","cost","price","quantity","profit","margin","units",
           "tax","discount","amount","score","salary","hours","rate","balance",
           "budget","expenses","income","commission","region","category","status",
           "department","product","customer","name",
           # multi-word headers (real sheets) — the add-in bridge maps these to columns
           "net sales","gross profit","unit price","total cost","net income",
           "operating expenses","cost of goods","units sold","sale price","list price",
           "due date","order date","customer name","first name","last name",
           "phone number","line total","gross margin","selling price"]
def hdr(): return random.choice(HEADERS)
SINGLE_HEADERS = [h for h in HEADERS if " " not in h]
def hdr1(): return random.choice(SINGLE_HEADERS)   # single-word only — safe inside specs
@reg
def g_sum_named():      h=hdr(); return f"sum the {h} column", f"=SUM({h})"
@reg
def g_avg_named():      h=hdr(); return f"average of the {h} column", f"=AVERAGE({h})"
@reg
def g_count_named():    h=hdr(); return f"count the {h} values", f"=COUNT({h})"
@reg
def g_max_named():      h=hdr(); return f"the highest {h}", f"=MAX({h})"
@reg
def g_min_named():      h=hdr(); return f"the lowest {h}", f"=MIN({h})"
@reg
def g_median_named():   h=hdr(); return f"the median {h}", f"=MEDIAN({h})"
@reg
def g_stdev_named():    h=hdr(); return f"standard deviation of {h}", f"=STDEV({h})"
@reg
def g_pctoftotal_named():h=hdr(); return f"each {h} as a percent of total {h}", f"={h}/SUM({h})"
@reg
def g_sumif_named():    h=hdr(); g=hdr(); w=word(); return f"total {h} where {g} is {w}", f'=SUMIF({g},"{w}",{h})'
@reg
def g_countif_named():  h=hdr(); w=word(); return f"count how many {h} are {w}", f'=COUNTIF({h},"{w}")'
@reg
def g_averageif_named():h=hdr(); g=hdr(); w=word(); return f"average {h} where {g} is {w}", f'=AVERAGEIF({g},"{w}",{h})'
@reg
def g_sumifnum_named(): h=hdr(); o=opn(); n=num(); return f"total {h} {opw(o)} {n}", f'=SUMIF({h},"{o}{n}")'
@reg
def g_filter_named():   h=hdr(); g=hdr(); w=word(); return f"show {h} where {g} is {w}", f'=FILTER({h},{g}="{w}")'
@reg
def g_sort_named():     h=hdr(); return f"sort the {h} column", f"=SORT({h})"
@reg
def g_unique_named():   h=hdr(); return f"list the unique {h} values", f"=UNIQUE({h})"
@reg
def g_xlookup_named():  k=hdr(); r=hdr(); c=cell(); return f"look up {c} in {k} and return the {r}", f"=XLOOKUP({c},{k},{r})"

# ── compound logic (the nests real formulas actually use) ──
FB = [("not found", '"not found"'), ("blank", '""'), ("zero", "0")]
@reg
def g_if_and():       a=cell(); b=cell(); t=num(); u=num(); return f"if {a} is over {t} and {b} is over {u} say yes otherwise no", f'=IF(AND({a}>{t},{b}>{u}),"yes","no")'
@reg
def g_if_and_words(): a=cell(); b=cell(); w1=word(); w2=word(); return f"if {a} is {w1} and {b} is {w2} say yes otherwise no", f'=IF(AND({a}="{w1}",{b}="{w2}"),"yes","no")'
@reg
def g_if_or():        a=cell(); b=cell(); t=num(); return f"if {a} or {b} is over {t} say yes otherwise no", f'=IF(OR({a}>{t},{b}>{t}),"yes","no")'
@reg
def g_if_diff():      a=cell(); b=cell(); return f"if {a} is bigger than {b} give the difference otherwise 0", f"=IF({a}>{b},{a}-{b},0)"
@reg
def g_if_blank():     a=cell(); b=cell(); return f"use {b} when {a} is empty otherwise {a}", f"=IF(ISBLANK({a}),{b},{a})"
@reg
def g_iferror_vlookup(): c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4); n,v=random.choice(FB); return f"look up {c} in {t}:{t2} column {k}, show {n} if not found", f"=IFERROR(VLOOKUP({c},{t}:{t2},{k},FALSE),{v})"
@reg
def g_ifna_vlookup():    c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4); return f"look up {c} in {t}:{t2} column {k}, blank if not available", f'=IFNA(VLOOKUP({c},{t}:{t2},{k},FALSE),"")'
@reg
def g_xlookup_nf():      c=cell(); kc=col(); rc=col(); n,v=random.choice(FB); return f"xlookup {c} in {kc} returning {rc}, show {n} if missing", f"=XLOOKUP({c},{kc}:{kc},{rc}:{rc},{v})"

# ── real-world date math ──
def days(): return random.choice([1, 7, 14, 30, 60, 90, 180, 365])
@reg
def g_days_until():    c=cell(); return f"how many days until {c}", f"={c}-TODAY()"
@reg
def g_age_years():     c=cell(); return f"age in years from birthdate {c}", f'=DATEDIF({c},TODAY(),"y")'
@reg
def g_add_days():      c=cell(); n=days(); return f"the date {n} days after {c}", f"={c}+{n}"
@reg
def g_sub_days():      c=cell(); n=days(); return f"the date {n} days before {c}", f"={c}-{n}"
@reg
def g_is_weekend():    c=cell(); return f"check if {c} falls on a weekend", f"=WEEKDAY({c},2)>5"
@reg
def g_first_of_month():c=cell(); return f"the first day of the month for {c}", f"=EOMONTH({c},-1)+1"
@reg
def g_last_of_month(): c=cell(); return f"the last day of the month containing {c}", f"=EOMONTH({c},0)"
@reg
def g_quarter():       c=cell(); return f"which quarter {c} falls in", f"=ROUNDUP(MONTH({c})/3,0)"
@reg
def g_days_in_month(): c=cell(); return f"how many days are in the month of {c}", f"=DAY(EOMONTH({c},0))"
@reg
def g_years_between(): a=cell(); b=cell(); return f"full years between {a} and {b}", f'=DATEDIF({a},{b},"y")'

# ── text extraction (FIND / TEXTBEFORE / TEXTAFTER / TEXTSPLIT) ──
DELIMS = [("-","dash"), (",","comma"), ("@","at sign"), ("/","slash"), (";","semicolon"), (" ","space")]
@reg
def g_first_name():  c=cell(); return f"the first name in {c}", f'=LEFT({c},FIND(" ",{c})-1)'
@reg
def g_last_name():   c=cell(); return f"the last name in {c}", f'=MID({c},FIND(" ",{c})+1,LEN({c}))'
@reg
def g_text_before(): c=cell(); d,nm=random.choice(DELIMS); return f"the text before the {nm} in {c}", f'=TEXTBEFORE({c},"{d}")'
@reg
def g_text_after():  c=cell(); d,nm=random.choice(DELIMS); return f"the text after the {nm} in {c}", f'=TEXTAFTER({c},"{d}")'
@reg
def g_email_domain():c=cell(); return f"the domain from the email in {c}", f'=TEXTAFTER({c},"@")'
@reg
def g_text_split():  c=cell(); d,nm=random.choice(DELIMS); return f"split {c} by the {nm}", f'=TEXTSPLIT({c},"{d}")'

# ── cross-sheet references ──
SHEETS = ["Sheet1", "Sheet2", "Data", "Summary", "Sales", "Raw", "Report"]
def sheet(): return random.choice(SHEETS)
@reg
def g_sheet_sum():    s=sheet(); c=col(); return f"sum column {c} on {s}", f"=SUM({s}!{c}:{c})"
@reg
def g_sheet_avg():    s=sheet(); c=col(); return f"average column {c} on {s}", f"=AVERAGE({s}!{c}:{c})"
@reg
def g_sheet_cell():   s=sheet(); c=cell(); return f"pull {c} from {s}", f"={s}!{c}"
@reg
def g_sheet_vlookup():s=sheet(); c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4); return f"look up {c} in {s} columns {t} to {t2} return column {k}", f"=VLOOKUP({c},{s}!{t}:{t2},{k},FALSE)"

# ── distinct / weighted / top-N / flags / ratio ──
@reg
def g_count_unique(): c=col(); return f"count of unique values in {c}", f"=COUNTA(UNIQUE({c}:{c}))"
@reg
def g_weighted_avg(): a=col(); b=col(); return f"weighted average of {a} using weights in {b}", f"=SUMPRODUCT({a}:{a},{b}:{b})/SUM({b}:{b})"
@reg
def g_topn_sum():
    c=col(); k=random.choice([3,5,10]); arr="{"+",".join(str(i) for i in range(1,k+1))+"}"
    f=f"=SUM(LARGE({c}:{c},{arr}))"; desc=f"sum of the top {k} values in {c}"
    if COT: return desc, f"top {k} = ranks {arr} => {f}"
    return desc, f
@reg
def g_above_avg():    c=cell(); return f"flag if {c} is above the {c[0]} column average", f"={c}>AVERAGE({c[0]}:{c[0]})"
@reg
def g_is_max():       c=cell(); return f"true if {c} is the largest in column {c[0]}", f"={c}=MAX({c[0]}:{c[0]})"
@reg
def g_is_duplicate(): c=cell(); return f"check if {c} is a duplicate in column {c[0]}", f"=COUNTIF({c[0]}:{c[0]},{c})>1"
@reg
def g_ratio():        a=cell(); b=cell(); return f"the ratio of {a} to {b}", f"={a}/{b}"

# ── business / finance math (margin, markup, variance, tax, depreciation) ──
PCTS = [5, 10, 15, 20, 25, 30, 40, 50]
@reg
def g_gross_margin():   a=cell(); b=cell(); return f"gross margin from price {a} and cost {b}", f"=({a}-{b})/{a}"
@reg
def g_markup():         a=cell(); b=cell(); return f"markup from cost {a} to price {b}", f"=({b}-{a})/{a}"
@reg
def g_profit():         a=cell(); b=cell(); return f"profit from revenue {a} minus cost {b}", f"={a}-{b}"
@reg
def g_pct_to_goal():    a=cell(); b=cell(); return f"{a} as a percent of goal {b}", f"={a}/{b}"
@reg
def g_variance_budget():a=cell(); b=cell(); return f"variance of actual {a} versus budget {b}", f"={a}-{b}"
@reg
def g_pct_variance():   a=cell(); b=cell(); return f"percent variance of actual {a} versus budget {b}", f"=({a}-{b})/{b}"
@reg
def g_discount_price(): c=cell(); n=random.choice(PCTS); return f"{c} after a {n} percent discount", f"={c}*(1-{n}/100)"
@reg
def g_price_with_tax(): c=cell(); n=random.choice(PCTS); return f"{c} plus {n} percent tax", f"={c}*(1+{n}/100)"
@reg
def g_rate():           n=cell(); pmt=cell(); pv=cell(); return f"interest rate given periods {n}, payment {pmt}, present value {pv}", f"=RATE({n},{pmt},{pv})"
@reg
def g_ipmt():           r=cell(); per=cell(); n=cell(); pv=cell(); return f"interest portion of payment {per}, rate {r}, periods {n}, present value {pv}", f"=IPMT({r},{per},{n},{pv})"
@reg
def g_ppmt():           r=cell(); per=cell(); n=cell(); pv=cell(); return f"principal portion of payment {per}, rate {r}, periods {n}, present value {pv}", f"=PPMT({r},{per},{n},{pv})"
@reg
def g_sln():            a=cell(); b=cell(); c=cell(); return f"straight line depreciation with cost {a}, salvage {b}, life {c}", f"=SLN({a},{b},{c})"

# ── extra math / lookup / array ──
@reg
def g_mround():         c=cell(); k=random.choice([5,10,25,100,0.05,0.25]); return f"round {c} to the nearest multiple of {k}", f"=MROUND({c},{k})"
@reg
def g_quotient():       a=cell(); k=random.randint(2,10); return f"integer division of {a} by {k}", f"=QUOTIENT({a},{k})"
@reg
def g_even():           c=cell(); return f"round {c} up to the next even number", f"=EVEN({c})"
@reg
def g_odd():            c=cell(); return f"round {c} up to the next odd number", f"=ODD({c})"
@reg
def g_vlookup_approx(): c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4); return f"find the bracket for {c} in {t}:{t2} column {k} with approximate match", f"=VLOOKUP({c},{t}:{t2},{k},TRUE)"
@reg
def g_filter_multi():   a=col(); c1=col(); c2=col(); w=word(); n=num(); return f"filter {a} where {c1} is {w} and {c2} is over {n}", f'=FILTER({a}:{a},({c1}:{c1}="{w}")*({c2}:{c2}>{n}))'
@reg
def g_sortby():         a=col(); b=col(); return f"sort {a} by {b} from high to low", f"=SORTBY({a}:{a},{b}:{b},-1)"
@reg
def g_sumifs_year():    sc=col(); dc=col(); y=random.randint(2018,2025); return f"total {sc} where the date in {dc} is in {y}", f'=SUMIFS({sc}:{sc},{dc}:{dc},">="&DATE({y},1,1),{dc}:{dc},"<="&DATE({y},12,31))'

# ── advanced finance (irregular cash flows, depreciation, loan schedules) ──
@reg
def g_xnpv():     r=cell(); v=col(); d=col(); return f"net present value of cash flows in {v} on dates in {d} at rate {r}", f"=XNPV({r},{v}:{v},{d}:{d})"
@reg
def g_xirr():     v=col(); d=col(); return f"internal rate of return for cash flows in {v} on dates in {d}", f"=XIRR({v}:{v},{d}:{d})"
@reg
def g_mirr():     v=col(); r1=cell(); r2=cell(); return f"modified IRR of {v} with finance rate {r1} and reinvestment rate {r2}", f"=MIRR({v}:{v},{r1},{r2})"
@reg
def g_db():       a=cell(); b=cell(); c=cell(); pr=cell(); return f"declining balance depreciation: cost {a}, salvage {b}, life {c}, period {pr}", f"=DB({a},{b},{c},{pr})"
@reg
def g_ddb():      a=cell(); b=cell(); c=cell(); pr=cell(); return f"double declining balance depreciation: cost {a}, salvage {b}, life {c}, period {pr}", f"=DDB({a},{b},{c},{pr})"
@reg
def g_syd():      a=cell(); b=cell(); c=cell(); pr=cell(); return f"sum of years digits depreciation: cost {a}, salvage {b}, life {c}, period {pr}", f"=SYD({a},{b},{c},{pr})"
@reg
def g_cumipmt():  r=cell(); n=cell(); pv=cell(); return f"total interest paid over periods 1 to 12, rate {r}, periods {n}, present value {pv}", f"=CUMIPMT({r},{n},{pv},1,12,0)"
@reg
def g_cumprinc(): r=cell(); n=cell(); pv=cell(); return f"total principal paid over periods 1 to 12, rate {r}, periods {n}, present value {pv}", f"=CUMPRINC({r},{n},{pv},1,12,0)"
@reg
def g_effect():   r=cell(); return f"effective annual rate from nominal {r} compounded monthly", f"=EFFECT({r},12)"
@reg
def g_nominal():  r=cell(); return f"nominal rate from effective rate {r} compounded monthly", f"=NOMINAL({r},12)"
@reg
def g_monthly_pmt():r=cell(); y=cell(); pv=cell(); return f"monthly loan payment: annual rate {r}, {y} years, loan amount {pv}", f"=PMT({r}/12,{y}*12,{pv})"

# ── more stats ──
@reg
def g_standardize():x=cell(); m=cell(); s=cell(); return f"z-score of {x} with mean {m} and standard deviation {s}", f"=STANDARDIZE({x},{m},{s})"
@reg
def g_rank_avg(): c=cell(); r,d=rng(); return f"average rank of {c} in {d}", f"=RANK.AVG({c},{r})"
@reg
def g_avedev():   r,d=rng(); return "average absolute deviation of "+d, f"=AVEDEV({r})"
@reg
def g_devsq():    r,d=rng(); return "sum of squared deviations of "+d, f"=DEVSQ({r})"

# ── text utilities ──
@reg
def g_count_char():c=cell(); ch=random.choice(["a","e","o","-"," ",","]); return f'count how many "{ch}" are in {c}', f'=LEN({c})-LEN(SUBSTITUTE({c},"{ch}",""))'
@reg
def g_count_words():c=cell(); return f"count the words in {c}", f'=LEN(TRIM({c}))-LEN(SUBSTITUTE(TRIM({c})," ",""))+1'
@reg
def g_char():     n=random.randint(65,90); return f"the character for code {n}", f"=CHAR({n})"
@reg
def g_code():     c=cell(); return f"the character code of {c}", f"=CODE({c})"
@reg
def g_zip_pad():  c=cell(); return f"pad {c} to 5 digits with leading zeros", f'=TEXT({c},"00000")'

# ── more lookup / reference ──
@reg
def g_index_match_2way():a=cell(); b=cell(); return f"two-way lookup: the row where A matches {a} and the column whose header matches {b}", f"=INDEX(B:F,MATCH({a},A:A,0),MATCH({b},B1:F1,0))"
@reg
def g_indirect(): c=cell(); return f"reference the cell named in {c}", f"=INDIRECT({c})"
@reg
def g_address():  a=cell(); b=cell(); return f"the cell address for row {a} and column {b}", f"=ADDRESS({a},{b})"
@reg
def g_rownum():   c=cell(); return f"the row number of {c}", f"=ROW({c})"
@reg
def g_colnum():   c=cell(); return f"the column number of {c}", f"=COLUMN({c})"
@reg
def g_lookup_last():cl=col(); return f"the last non-empty value in column {cl}", f'=LOOKUP(2,1/({cl}:{cl}<>""),{cl}:{cl})'
@reg
def g_sumif_wild():cc=col(); sc=col(); w=word(); return f"sum {sc} where {cc} contains {w}", f'=SUMIF({cc}:{cc},"*{w}*",{sc}:{sc})'
@reg
def g_countif_wild():cc=col(); w=word(); return f"count cells in {cc} containing {w}", f'=COUNTIF({cc}:{cc},"*{w}*")'

# ── exclude criteria (<>) ──
@reg
def g_countif_not():cc=col(); w=word(); return f"count cells in {cc} not equal to {w}", f'=COUNTIF({cc}:{cc},"<>{w}")'
@reg
def g_sumif_not(): cc=col(); sc=col(); w=word(); return f"sum {sc} where {cc} is not {w}", f'=SUMIF({cc}:{cc},"<>{w}",{sc}:{sc})'

# ── more info / error checks ──
@reg
def g_isna():     c=cell(); return f"check if {c} is a not-available error", f"=ISNA({c})"
@reg
def g_iseven():   c=cell(); return f"check if {c} is even", f"=ISEVEN({c})"
@reg
def g_isodd():    c=cell(); return f"check if {c} is odd", f"=ISODD({c})"
@reg
def g_isformula():c=cell(); return f"check if {c} contains a formula", f"=ISFORMULA({c})"

# ── modern spill arrays ──
@reg
def g_sequence_2d():a=random.randint(2,10); b=random.randint(2,6); return f"a grid of numbers {a} rows by {b} columns", f"=SEQUENCE({a},{b})"
@reg
def g_randarray():a=random.randint(2,10); b=random.randint(2,6); return f"a random array {a} rows by {b} columns", f"=RANDARRAY({a},{b})"
@reg
def g_hstack():   a=col(); b=col(); return f"put {a} and {b} side by side", f"=HSTACK({a}:{a},{b}:{b})"
@reg
def g_vstack():   a=col(); b=col(); return f"stack {a} on top of {b}", f"=VSTACK({a}:{a},{b}:{b})"
@reg
def g_take():     c=col(); n=random.randint(3,20); return f"the first {n} rows of column {c}", f"=TAKE({c}:{c},{n})"

# ── extended breadth: more math / stats / finance / text / array / info ──
@reg
def g_gcd():       r,d=rng(); return "greatest common divisor of "+d, f"=GCD({r})"
@reg
def g_lcm():       r,d=rng(); return "least common multiple of "+d, f"=LCM({r})"
@reg
def g_fact():      c=cell(); return f"factorial of {c}", f"=FACT({c})"
@reg
def g_combin():    c=cell(); k=random.randint(2,6); return f"combinations of {c} choose {k}", f"=COMBIN({c},{k})"
@reg
def g_sumsq():     r,d=rng(); return "sum of squares of "+d, f"=SUMSQ({r})"
@reg
def g_norm_dist(): x=cell(); m=cell(); s=cell(); return f"normal distribution of {x} with mean {m} and sd {s}", f"=NORM.DIST({x},{m},{s},TRUE)"
@reg
def g_norm_inv():  p=cell(); m=cell(); s=cell(); return f"inverse normal for probability {p}, mean {m}, sd {s}", f"=NORM.INV({p},{m},{s})"
@reg
def g_percentile_inc():r,d=rng(); pc=random.choice([0.25,0.5,0.75,0.9]); return f"the {int(pc*100)}th percentile of {d} inclusive", f"=PERCENTILE.INC({r},{pc})"
@reg
def g_quartile_inc():r,d=rng(); k=random.randint(1,3); return f"quartile {k} of {d} inclusive", f"=QUARTILE.INC({r},{k})"
@reg
def g_stdev_s():   r,d=rng(); return "sample standard deviation of "+d, f"=STDEV.S({r})"
@reg
def g_var_s():     r,d=rng(); return "sample variance of "+d, f"=VAR.S({r})"
@reg
def g_confidence():s=cell(); n=cell(); return f"95 percent confidence interval with sd {s} and size {n}", f"=CONFIDENCE.NORM(0.05,{s},{n})"
@reg
def g_pduration(): rt=cell(); pv=cell(); fv=cell(); return f"periods to grow {pv} to {fv} at rate {rt}", f"=PDURATION({rt},{pv},{fv})"
@reg
def g_rri():       n=cell(); pv=cell(); fv=cell(); return f"the return rate to grow {pv} to {fv} over {n} periods", f"=RRI({n},{pv},{fv})"
@reg
def g_ispmt():     rt=cell(); pr=cell(); n=cell(); pv=cell(); return f"interest paid in period {pr}, rate {rt}, periods {n}, value {pv}", f"=ISPMT({rt},{pr},{n},{pv})"
@reg
def g_dollarde():  c=cell(); fr=random.choice([8,16,32]); return f"convert {c} from fractional dollars in {fr}ths to decimal", f"=DOLLARDE({c},{fr})"
@reg
def g_dollarfr():  c=cell(); fr=random.choice([8,16,32]); return f"convert {c} from decimal to fractional dollars in {fr}ths", f"=DOLLARFR({c},{fr})"
@reg
def g_numbervalue():c=cell(); return f"convert the text in {c} to a number", f"=NUMBERVALUE({c})"
@reg
def g_tfn():       c=cell(); return f"return {c} only if it is text", f"=T({c})"
@reg
def g_nfn():       c=cell(); return f"convert {c} to its numeric value", f"=N({c})"
@reg
def g_unichar():   n=random.randint(65,200); return f"the character for unicode {n}", f"=UNICHAR({n})"
@reg
def g_unicode():   c=cell(); return f"the unicode number of {c}", f"=UNICODE({c})"
@reg
def g_let():       c=cell(); return f"with x as {c}, return x doubled", f"=LET(x,{c},x*2)"
@reg
def g_tocol():     a=col(); b=chr(ord(a)+2); return f"flatten {a}:{b} into a single column", f"=TOCOL({a}:{b})"
@reg
def g_torow():     a=col(); b=chr(ord(a)+2); return f"flatten {a}:{b} into a single row", f"=TOROW({a}:{b})"
@reg
def g_choosecols():a=col(); b=chr(ord(a)+4); i=random.randint(1,2); j=random.randint(3,4); return f"keep only columns {i} and {j} of {a}:{b}", f"=CHOOSECOLS({a}:{b},{i},{j})"
@reg
def g_chooserows():a=col(); b=chr(ord(a)+4); i=random.randint(1,2); j=random.randint(3,5); return f"keep only rows {i} and {j} of {a}:{b}", f"=CHOOSEROWS({a}:{b},{i},{j})"
@reg
def g_drop():      c=col(); k=random.randint(1,3); return f"drop the first {k} rows of column {c}", f"=DROP({c}:{c},{k})"
@reg
def g_expand():    c=col(); k=random.randint(5,20); return f"expand column {c} to {k} rows padding with 0", f"=EXPAND({c}:{c},{k},1,0)"
@reg
def g_formulatext():c=cell(); return f"show the formula in {c} as text", f"=FORMULATEXT({c})"
@reg
def g_typenum():   c=cell(); return f"the data type code of {c}", f"=TYPE({c})"
@reg
def g_sheetnum():  return random.choice(["the current sheet number", "this sheet's number"]), "=SHEET()"

# ── business pack: payroll, sales, pricing, inventory, invoicing, tax, KPIs ──
def pct(): return random.choice([3, 5, 8, 10, 12, 15, 20, 25, 30, 40])
@reg
def g_gross_pay():     h=cell(); r=cell(); return f"gross pay for {h} hours at {r} per hour", f"={h}*{r}"
@reg
def g_overtime():      h=cell(); o=cell(); r=cell(); return f"pay for {h} regular plus {o} overtime hours at {r} per hour at 1.5x overtime", f"={h}*{r}+{o}*{r}*1.5"
@reg
def g_net_pay():       g=cell(); p=pct(); return f"net pay from gross {g} after {p} percent tax", f"={g}*(1-{p}/100)"
@reg
def g_bonus():         s=cell(); p=pct(); return f"a {p} percent bonus on salary {s}", f"={s}*{p}/100"
@reg
def g_annual_salary(): r=cell(); h=cell(); return f"annual salary at {r} per hour, {h} hours per week", f"={r}*{h}*52"
@reg
def g_commission():    s=cell(); p=pct(); return f"{p} percent commission on sales {s}", f"={s}*{p}/100"
@reg
def g_tiered_comm():   s=cell(); t=num(); return f"commission on {s}: 10 percent if over {t} otherwise 5 percent", f"=IF({s}>{t},{s}*0.1,{s}*0.05)"
@reg
def g_quota():         a=cell(); q=cell(); return f"quota attainment of actual {a} against quota {q}", f"={a}/{q}"
@reg
def g_sales_tax():     s=cell(); p=pct(); return f"sales tax on {s} at {p} percent", f"={s}*{p}/100"
@reg
def g_win_rate():      w=cell(); t=cell(); return f"win rate: {w} won out of {t} deals", f"={w}/{t}"
@reg
def g_line_total():    q=cell(); p=cell(); return f"line total for {q} units at {p} each", f"={q}*{p}"
@reg
def g_discount_chain():p=cell(); a=pct(); b=pct(); return f"{p} after a {a} percent then {b} percent discount", f"={p}*(1-{a}/100)*(1-{b}/100)"
@reg
def g_markup_price():  c=cell(); m=pct(); return f"price from cost {c} with a {m} percent markup", f"={c}*(1+{m}/100)"
@reg
def g_invoice_total(): s=cell(); t=pct(); d=cell(); return f"invoice total: subtotal {s} plus {t} percent tax minus discount {d}", f"={s}*(1+{t}/100)-{d}"
@reg
def g_inventory_value():q=cell(); c=cell(); return f"inventory value of {q} units at {c} cost", f"={q}*{c}"
@reg
def g_turnover():      c=cell(); i=cell(); return f"inventory turnover: COGS {c} over average inventory {i}", f"={c}/{i}"
@reg
def g_days_inventory():i=cell(); d=cell(); return f"days of inventory: {i} over daily COGS {d}", f"={i}/{d}"
@reg
def g_reorder():       u=cell(); l=cell(); return f"reorder point: daily usage {u} times lead time {l}", f"={u}*{l}"
@reg
def g_eoq():           d=cell(); o=cell(); h=cell(); return f"economic order quantity: demand {d}, order cost {o}, holding cost {h}", f"=SQRT(2*{d}*{o}/{h})"
@reg
def g_effective_tax(): t=cell(); i=cell(); return f"effective tax rate: tax {t} over income {i}", f"={t}/{i}"
@reg
def g_after_tax():     i=cell(); r=pct(); return f"after-tax income from {i} at {r} percent", f"={i}*(1-{r}/100)"
@reg
def g_credit_util():   b=cell(); l=cell(); return f"credit utilization: balance {b} over limit {l}", f"={b}/{l}"
@reg
def g_interest_accrued():p=cell(); r=cell(); d=cell(); return f"interest accrued on {p} at rate {r} for {d} days", f"={p}*{r}*{d}/365"
@reg
def g_yoy():           a=cell(); b=cell(); return f"year over year growth from {a} to {b}", f"=({b}-{a})/{a}"
@reg
def g_arpu():          r=cell(); u=cell(); return f"ARPU: revenue {r} over {u} users", f"={r}/{u}"
@reg
def g_churn():         l=cell(); t=cell(); return f"churn rate: {l} lost of {t} customers", f"={l}/{t}"
@reg
def g_conversion():    c=cell(); v=cell(); return f"conversion rate: {c} conversions over {v} visitors", f"={c}/{v}"
@reg
def g_ltv():           a=cell(); l=cell(); return f"customer lifetime value: ARPU {a} times lifespan {l}", f"={a}*{l}"
@reg
def g_cac_payback():   c=cell(); m=cell(); return f"CAC payback months: CAC {c} over monthly margin {m}", f"={c}/{m}"
@reg
def g_run_rate():      m=cell(); return f"annual run rate from monthly {m}", f"={m}*12"
@reg
def g_currency():      a=cell(); r=cell(); return f"convert {a} at exchange rate {r}", f"={a}*{r}"

# ── industry metrics: SaaS / startup, real estate, accounting, forecasting ──
@reg
def g_mrr():           c=cell(); p=cell(); return f"monthly recurring revenue from {c} customers at {p} average price", f"={c}*{p}"
@reg
def g_arr():           m=cell(); return f"annual recurring revenue from MRR {m}", f"={m}*12"
@reg
def g_nrr():           s=cell(); e=cell(); c=cell(); return f"net revenue retention: start {s} plus expansion {e} minus churn {c} over start", f"=({s}+{e}-{c})/{s}"
@reg
def g_burn_rate():     s=cell(); e=cell(); m=cell(); return f"monthly burn: cash {s} minus {e} over {m} months", f"=({s}-{e})/{m}"
@reg
def g_runway():        c=cell(); b=cell(); return f"runway in months: cash {c} over monthly burn {b}", f"={c}/{b}"
@reg
def g_rule_of_40():    g=cell(); p=cell(); return f"rule of 40: growth {g} plus profit margin {p}", f"={g}+{p}"
@reg
def g_magic_number():  a=cell(); s=cell(); return f"magic number: new ARR {a} over sales and marketing spend {s}", f"={a}/{s}"
@reg
def g_gross_churn():   l=cell(); t=cell(); return f"gross MRR churn: {l} churned over {t} total MRR", f"={l}/{t}"
@reg
def g_expansion_rate():e=cell(); s=cell(); return f"expansion rate: {e} expansion over {s} starting MRR", f"={e}/{s}"
@reg
def g_cap_rate():      n=cell(); v=cell(); return f"cap rate: NOI {n} over property value {v}", f"={n}/{v}"
@reg
def g_noi():           g=cell(); e=cell(); return f"net operating income: gross income {g} minus operating expenses {e}", f"={g}-{e}"
@reg
def g_cash_on_cash():  c=cell(); i=cell(); return f"cash on cash return: annual cash flow {c} over cash invested {i}", f"={c}/{i}"
@reg
def g_grm():           p=cell(); r=cell(); return f"gross rent multiplier: price {p} over annual rent {r}", f"={p}/{r}"
@reg
def g_dscr():          n=cell(); d=cell(); return f"debt service coverage ratio: NOI {n} over debt service {d}", f"={n}/{d}"
@reg
def g_price_sqft():    p=cell(); s=cell(); return f"price per square foot: price {p} over {s} square feet", f"={p}/{s}"
@reg
def g_rental_yield():  r=cell(); p=cell(); return f"rental yield: annual rent {r} over price {p}", f"={r}/{p}"
@reg
def g_ltv_ratio():     l=cell(); v=cell(); return f"loan to value ratio: loan {l} over value {v}", f"={l}/{v}"
@reg
def g_dso():           a=cell(); r=cell(); return f"days sales outstanding: AR {a} over revenue {r} times 365", f"={a}/{r}*365"
@reg
def g_dpo():           a=cell(); c=cell(); return f"days payable outstanding: AP {a} over COGS {c} times 365", f"={a}/{c}*365"
@reg
def g_dio():           i=cell(); c=cell(); return f"days inventory outstanding: inventory {i} over COGS {c} times 365", f"={i}/{c}*365"
@reg
def g_ccc():           a=cell(); b=cell(); c=cell(); return f"cash conversion cycle: DSO {a} plus DIO {b} minus DPO {c}", f"={a}+{b}-{c}"
@reg
def g_working_capital():a=cell(); l=cell(); return f"working capital: current assets {a} minus current liabilities {l}", f"={a}-{l}"
@reg
def g_current_ratio(): a=cell(); l=cell(); return f"current ratio: current assets {a} over current liabilities {l}", f"={a}/{l}"
@reg
def g_quick_ratio():   a=cell(); i=cell(); l=cell(); return f"quick ratio: current assets {a} minus inventory {i} over current liabilities {l}", f"=({a}-{i})/{l}"
@reg
def g_operating_margin():o=cell(); r=cell(); return f"operating margin: operating income {o} over revenue {r}", f"={o}/{r}"
@reg
def g_gross_profit_calc():r=cell(); c=cell(); return f"gross profit: revenue {r} minus COGS {c}", f"={r}-{c}"
@reg
def g_seasonal_index():p=cell(); a=cell(); return f"seasonal index: period average {p} over overall average {a}", f"={p}/{a}"
@reg
def g_exp_smoothing(): x=cell(); p=cell(); return f"exponential smoothing of actual {x} and prior forecast {p} at alpha 0.3", f"=0.3*{x}+0.7*{p}"
@reg
def g_weighted_ma():   a=cell(); b=cell(); c=cell(); return f"weighted moving average of {a} {b} {c} weighted 3 2 1", f"=({a}*3+{b}*2+{c})/6"
@reg
def g_var_to_forecast():a=cell(); f=cell(); return f"percent variance of actual {a} to forecast {f}", f"=({a}-{f})/{f}"
@reg
def g_contribution_ratio():c=cell(); s=cell(); return f"contribution margin ratio: contribution {c} over sales {s}", f"={c}/{s}"

# ── time intelligence (YTD / MTD / rolling / prior year) ──
@reg
def g_ytd():        sc=col(); dc=col(); return f"year to date total of {sc} using dates in {dc}", f'=SUMIFS({sc}:{sc},{dc}:{dc},">="&DATE(YEAR(TODAY()),1,1),{dc}:{dc},"<="&TODAY())'
@reg
def g_mtd():        sc=col(); dc=col(); return f"month to date total of {sc} using dates in {dc}", f'=SUMIFS({sc}:{sc},{dc}:{dc},">="&EOMONTH(TODAY(),-1)+1,{dc}:{dc},"<="&TODAY())'
@reg
def g_rolling12():  sc=col(); dc=col(); return f"rolling 12 month total of {sc} using dates in {dc}", f'=SUMIFS({sc}:{sc},{dc}:{dc},">="&EDATE(TODAY(),-12),{dc}:{dc},"<="&TODAY())'
@reg
def g_prior_year(): sc=col(); dc=col(); return f"total {sc} for last year using dates in {dc}", f'=SUMIFS({sc}:{sc},{dc}:{dc},">="&DATE(YEAR(TODAY())-1,1,1),{dc}:{dc},"<="&DATE(YEAR(TODAY())-1,12,31))'

# ── allocation / proration ──
@reg
def g_allocate_even():c=cell(); return f"allocate {c} evenly across 12 months", f"={c}/12"
@reg
def g_prorate():    a=cell(); d=cell(); return f"prorate {a} for {d} days out of 30", f"={a}*{d}/30"
@reg
def g_split_parts():c=cell(); n=random.randint(2,12); return f"split {c} across {n} equal parts", f"={c}/{n}"

# ── complete-Excel coverage: bulk single/double-arg functions via a factory ──
def _bulk(name, sig, phrase):
    def g():
        if sig == "cell":  c=cell(); return phrase.format(x=c), f"={name}({c})"
        if sig == "range": r,d=rng(); return phrase.format(x=d), f"={name}({r})"
        if sig == "cell2": a=cell(); b=cell(); return phrase.format(a=a,b=b), f"={name}({a},{b})"
        if sig == "celln": c=cell(); n=random.randint(2,9); return phrase.format(x=c,n=n), f"={name}({c},{n})"
        if sig == "rangek": r,d=rng(); k=random.choice(["0.25","0.5","0.75","0.9"]); return phrase.format(x=d,k=k), f"={name}({r},{k})"
        if sig == "rangeq": r,d=rng(); q=random.randint(1,3); return phrase.format(x=d,q=q), f"={name}({r},{q})"
        if sig == "range2": r,d=rng(); r2,d2=rng(); return phrase.format(x=d,y=d2), f"={name}({r},{r2})"
        return phrase, f"={name}()"
    g.__name__ = "g_x_" + name.lower().replace(".", "")
    G.append(g)

_BULK = [
    # trigonometry
    ("SIN","cell","the sine of {x}"), ("COS","cell","the cosine of {x}"), ("TAN","cell","the tangent of {x}"),
    ("ASIN","cell","the arcsine of {x}"), ("ACOS","cell","the arccosine of {x}"), ("ATAN","cell","the arctangent of {x}"),
    ("SINH","cell","the hyperbolic sine of {x}"), ("COSH","cell","the hyperbolic cosine of {x}"), ("TANH","cell","the hyperbolic tangent of {x}"),
    ("ASINH","cell","the inverse hyperbolic sine of {x}"), ("ACOSH","cell","the inverse hyperbolic cosine of {x}"), ("ATANH","cell","the inverse hyperbolic tangent of {x}"),
    ("COT","cell","the cotangent of {x}"), ("ACOT","cell","the arccotangent of {x}"), ("SEC","cell","the secant of {x}"), ("CSC","cell","the cosecant of {x}"),
    ("DEGREES","cell","convert {x} radians to degrees"), ("RADIANS","cell","convert {x} degrees to radians"),
    ("PI","noarg","the value of pi"), ("ATAN2","cell2","the arctangent of the point {a} {b}"),
    # math
    ("SQRTPI","cell","the square root of {x} times pi"), ("GAMMALN","cell","the natural log of gamma of {x}"),
    ("FACTDOUBLE","cell","the double factorial of {x}"), ("GAUSS","cell","the gauss of {x}"), ("PHI","cell","the density of the standard normal at {x}"),
    ("FISHER","cell","the fisher transform of {x}"), ("FISHERINV","cell","the inverse fisher transform of {x}"),
    ("ARABIC","cell","convert the roman numeral in {x} to a number"), ("ROMAN","cell","{x} as roman numerals"),
    ("LOG","celln","log of {x} to base {n}"), ("BASE","celln","convert {x} to base {n}"),
    ("COMBINA","celln","combinations with repetition of {x} choose {n}"), ("PERMUTATIONA","celln","permutations with repetition of {x} choose {n}"),
    ("MULTINOMIAL","range","the multinomial of {x}"),
    # statistics
    ("AVERAGEA","range","the average of {x} counting text as zero"), ("STDEVA","range","sample standard deviation of {x} including text"),
    ("STDEVPA","range","population standard deviation of {x} including text"), ("VARA","range","sample variance of {x} including text"),
    ("VARPA","range","population variance of {x} including text"), ("MODE.SNGL","range","the single most common value in {x}"),
    ("SKEW.P","range","the population skewness of {x}"),
    # date / time
    ("HOUR","cell","the hour from {x}"), ("MINUTE","cell","the minute from {x}"), ("SECOND","cell","the second from {x}"),
    ("ISOWEEKNUM","cell","the ISO week number of {x}"), ("DATEVALUE","cell","convert the text date in {x} to a serial number"),
    ("TIMEVALUE","cell","convert the text time in {x} to a serial number"),
    ("DAYS360","cell2","days between {a} and {b} on a 360-day year"), ("YEARFRAC","cell2","the fraction of a year between {a} and {b}"),
    # text
    ("ASC","cell","convert {x} to single-byte characters"), ("PHONETIC","cell","the phonetic text in {x}"),
    ("BAHTTEXT","cell","{x} as Thai baht text"), ("DOLLAR","celln","format {x} as currency text with {n} decimals"),
    ("FIXED","celln","format {x} as text with {n} decimals"),
    # information
    ("ISERR","cell","check if {x} is an error other than N/A"), ("ISLOGICAL","cell","check if {x} is a logical value"),
    ("ISNONTEXT","cell","check if {x} is not text"), ("ISREF","cell","check if {x} is a reference"),
    ("ERROR.TYPE","cell","the error type number of {x}"),
    # engineering
    ("DEC2BIN","cell","convert {x} to binary"), ("DEC2HEX","cell","convert {x} to hexadecimal"), ("DEC2OCT","cell","convert {x} to octal"),
    ("BIN2DEC","cell","convert the binary {x} to a number"), ("HEX2DEC","cell","convert the hex {x} to a number"), ("OCT2DEC","cell","convert the octal {x} to a number"),
    ("ERF","cell","the error function of {x}"), ("ERFC","cell","the complementary error function of {x}"),
    ("DELTA","cell2","1 if {a} equals {b} otherwise 0"), ("GESTEP","cell2","1 if {a} is at least {b} otherwise 0"),
    ("BITAND","cell2","the bitwise AND of {a} and {b}"), ("BITOR","cell2","the bitwise OR of {a} and {b}"), ("BITXOR","cell2","the bitwise XOR of {a} and {b}"),
    # math / matrix
    ("GAMMA","cell","the gamma function of {x}"), ("CEILING.MATH","cell","round {x} up to the nearest integer"),
    ("FLOOR.MATH","cell","round {x} down to the nearest integer"),
    ("MDETERM","range","the determinant of the matrix {x}"), ("MINVERSE","range","the inverse of the matrix {x}"),
    ("MUNIT","cell","an identity matrix of size {x}"),
    # info / text
    ("N","cell","convert {x} to a number"), ("T","cell","return {x} only if it is text"),
    ("ENCODEURL","cell","URL-encode the text in {x}"), ("ARRAYTOTEXT","range","{x} as a single text string"),
    ("VALUETOTEXT","cell","{x} converted to text"),
    # statistics (exclusive / two-range)
    ("PERCENTILE.EXC","rangek","the exclusive {k} percentile of {x}"),
    ("QUARTILE.EXC","rangeq","exclusive quartile {q} of {x}"),
    ("COVARIANCE.S","range2","the sample covariance of {x} and {y}"),
    ("STEYX","range2","the standard error of the regression of {x} on {y}"),
]
for _n, _s, _p in _BULK:
    _bulk(_n, _s, _p)

# ── more analysis / wrangling formulas ──
@reg
def g_outlier():      c=cell(); cl=c[0]; return f"flag if {c} is an outlier in column {cl}", f"=ABS({c}-AVERAGE({cl}:{cl}))>2*STDEV({cl}:{cl})"
@reg
def g_zscore_col():   c=cell(); cl=c[0]; return f"z-score of {c} within column {cl}", f"=({c}-AVERAGE({cl}:{cl}))/STDEV({cl}:{cl})"
@reg
def g_normalize():    c=cell(); cl=c[0]; return f"normalize {c} to 0-1 within column {cl}", f"=({c}-MIN({cl}:{cl}))/(MAX({cl}:{cl})-MIN({cl}:{cl}))"
@reg
def g_above_median(): c=cell(); cl=c[0]; return f"is {c} above or below the {cl} median", f'=IF({c}>MEDIAN({cl}:{cl}),"above","below")'
@reg
def g_merge_cols():   a=cell(); b=cell(); return f"merge {a} and {b} into one cell", f'={a}&" "&{b}'
@reg
def g_pareto_cum():   c=cell(); cl=c[0]; return f"cumulative percent up to {c} in column {cl}", f"=SUM(${cl}$1:{c})/SUM({cl}:{cl})"
@reg
def g_moving_sum():   c=cell(); k=random.choice([3,5,7]); cl=c[0]; row=int(c[1:]); s=max(1,row-k+1); return f"{k}-period moving sum ending at {c}", f"=SUM({cl}{s}:{cl}{row})"
@reg
def g_pct_rank_col(): c=cell(); cl=c[0]; return f"percentile rank of {c} within column {cl}", f"=PERCENTRANK({cl}:{cl},{c})"
@reg
def g_running_count():c=cell(); cl=c[0]; return f"running count up to {c}", f"=COUNT(${cl}$1:{c})"
@reg
def g_count_above_avg():cl=col(); return f"count how many values in {cl} are above average", f'=COUNTIF({cl}:{cl},">"&AVERAGE({cl}:{cl}))'

# ── phrasing engine: wrap each base request the many ways real people type it ──
# (empties keep a good share clean; the rest add natural lead-ins / trailers)
LEADS = ["", "", "", "", "", "", "",
         "how do i ", "how do you ", "how to ",
         "formula to ", "formula for ", "i need a formula to ", "what's the formula to ",
         "i need ", "i want ", "i need to ", "i want to ",
         "give me ", "show me ", "get me ",
         "can you ", "could you ", "please ", "help me ",
         "what's ", "what is ", "calculate "]
TAILS = ["", "", "", "", "", "", "", " please", " for me", "?", " in excel", " thanks", " pls"]

# cell references: vary how a single cell is named in the DESCRIPTION only
# (the formula always keeps the bare ref). Ranges are left untouched so we
# never split "A3:A27" — RANGE_RE detects a cell-marker-cell pattern and bails.
CELL_RE  = re.compile(r"\b[A-N]\d+\b")
RANGE_RE = re.compile(r"[A-N]\d+\s*(?::|to|through)\s*[A-N]\d+")
CELL_FORMS = ["{c}", "{c}", "{c}", "cell {c}", "the value in {c}", "the {c} cell", "{c}'s value"]
def cellphrase(desc):
    if RANGE_RE.search(desc):
        return desc
    return CELL_RE.sub(lambda m: random.choice(CELL_FORMS).format(c=m.group(0)), desc)

def vary(desc):
    desc = random.choice(LEADS) + desc + random.choice(TAILS)
    if random.random() < 0.12:          # occasional sentence-case, like real typing
        desc = desc[0].upper() + desc[1:]
    return desc

# ── messy input: real users abbreviate and mistype. We only ever touch plain
# filler/intent words — never cell refs (have digits), headers, criteria values,
# sheet names (capitalized) or numbers — so the target formula stays correct. ──
# protect every word in any header (incl. multi-word) and every value from typos
HEADER_WORDS = set(w for h in HEADERS for w in h.split())
WORDS_SET = set(WORDS)
SHORT = {"columns": "cols", "column": "col", "average": "avg", "maximum": "max",
         "minimum": "min", "standard deviation": "stdev", "number of": "num of"}
def _typo_word(w):
    s = list(w); i = random.randrange(len(s) - 1)
    r = random.random()
    if r < 0.4:   s[i], s[i + 1] = s[i + 1], s[i]   # swap adjacent
    elif r < 0.7: s.pop(i)                          # drop a char
    else:         s.insert(i, s[i])                 # duplicate a char
    return "".join(s)
def messy(desc):
    if random.random() < 0.5:                       # shorthand / abbreviations
        for lng, sht in SHORT.items():
            if lng in desc and random.random() < 0.5:
                desc = desc.replace(lng, sht)
    if random.random() < 0.5:                       # one typo on a safe filler word
        ws = desc.split(" ")
        elig = [i for i, w in enumerate(ws)
                if w.isalpha() and w.islower() and len(w) >= 4
                and w not in HEADER_WORDS and w not in WORDS_SET]
        if elig:
            i = random.choice(elig); ws[i] = _typo_word(ws[i]); desc = " ".join(ws)
    return desc

def gen():
    """Pick a random formula type and return (name, description, formula)."""
    fn = random.choice(G)
    desc, formula = fn()
    desc = vary(cellphrase(desc))
    if random.random() < 0.25:          # a quarter of inputs are abbreviated / mistyped
        desc = messy(desc)
    return fn.__name__, desc, formula

# ── two extra tasks the same model learns: explain a formula, and fix a broken one ──
def gen_explain():
    fn = random.choice(G); desc, formula = fn()
    lead = random.choice(["explain ", "what does ", "describe ", "in plain english "])
    return lead + formula, desc

# common function-name misspellings people actually type (matched as NAME( so SUM != SUMIF)
FN_TYPOS = {
    "VLOOKUP": ["VLOKUP", "VLOOOKUP", "VLOOKUPP", "VLOOKP"], "HLOOKUP": ["HLOKUP", "HLOOKUPP"],
    "XLOOKUP": ["XLOKUP", "XLOOKUPP"], "SUM": ["SUMM", "SUmM"], "AVERAGE": ["AVERGAE", "AVRAGE", "AVEARGE"],
    "COUNT": ["COUNNT", "CONT"], "COUNTIF": ["COUNTIFF", "COUNITF"], "SUMIF": ["SUMIFF", "SUMIIF"],
    "SUMIFS": ["SUMIFFS"], "IFERROR": ["IFEROR", "IFERRROR", "IFERORR"], "INDEX": ["INDX", "INDEXX"],
    "MATCH": ["MACTH", "MATCHH"], "CONCATENATE": ["CONCATENAT", "CONCATNATE"], "TEXTJOIN": ["TEXJOIN", "TEXTJION"],
    "ROUND": ["ROUNND", "RUOND"], "TODAY": ["TODY"], "MEDIAN": ["MEDIANN", "MEDAIN"],
}
def _typo_fn(f):
    cands = [m.group(1) for m in re.finditer(r"([A-Z]+)\(", f) if m.group(1) in FN_TYPOS]
    if not cands: return f
    name = random.choice(cands)
    return f.replace(name + "(", random.choice(FN_TYPOS[name]) + "(", 1)
def _drop_last(f, ch):  i = f.rfind(ch); return f[:i] + f[i + 1:]
def _smart_quotes(f):   return f.replace('"', "“", 1).replace('"', "”", 1)   # curly “ ” from web paste

# each corrupter maps a correct formula -> a realistic broken version (return f unchanged = N/A)
CORRUPTERS = [
    lambda f: _drop_last(f, ")") if ")" in f else f,            # missing closing paren
    lambda f: f + ")",                                          # extra closing paren
    lambda f: f.replace("(", "", 1),                           # missing opening paren
    lambda f: _drop_last(f, ",") if "," in f else f,           # missing comma between args
    lambda f: f[1:],                                            # forgot the leading =
    lambda f: _drop_last(f, '"') if f.count('"') >= 2 else f,   # missing a quote
    lambda f: _smart_quotes(f) if f.count('"') >= 2 else f,     # curly “smart” quotes
    lambda f: f.replace(",", ";", 1) if "," in f else f,        # wrong separator (;)
    lambda f: f.replace(",", ",,", 1) if "," in f else f,       # extra/empty argument
    lambda f: f.replace(":", "", 1) if ":" in f else f,         # missing colon in range (A1A10)
    lambda f: f.replace("(", " (", 1),                         # stray space before paren
    lambda f: f.replace("(", "[", 1),                          # wrong bracket type
    _typo_fn,                                                   # misspelled function name
    lambda f: f.replace("=", "= ", 1) if f.startswith("=") else f,  # space after =
    lambda f: (lambda i: f[:i] + f[i + 1:])(random.randrange(1, len(f) - 1)),  # dropped char (catch-all)
]
def corrupt(f):
    order = CORRUPTERS[:]; random.shuffle(order)
    for c in order:
        try: g = c(f)
        except Exception: continue
        if g and g != f: return g
    return f[:-1]
def gen_fix():
    fn = random.choice(G); desc, formula = fn()
    broken = corrupt(formula)
    if broken == formula: broken = formula[:-1]
    lead = random.choice(["fix ", "repair ", "correct ", "what's wrong with ", "debug ", "fix the formula "])
    return lead + broken, formula

# ── formula editing: an existing formula + an instruction -> the modified formula ──
EDITS = []
def edit(fn): EDITS.append(fn); return fn

@edit
def e_swap_fn():
    r, d = rng()
    a, b, wrd = random.choice([("SUM","AVERAGE","an average"), ("AVERAGE","SUM","a sum"),
                               ("MAX","MIN","the minimum"), ("MIN","MAX","the maximum"),
                               ("SUM","MAX","the max"), ("COUNT","COUNTA","count everything")])
    return f"={a}({r})", f"make it {wrd}", f"={b}({r})"
@edit
def e_add_condition():
    sc=col(); cc=col(); w=word()
    fn, ifn = random.choice([("SUM","SUMIF"), ("AVERAGE","AVERAGEIF")])
    return f"={fn}({sc}:{sc})", f"only where {cc} is {w}", f'={ifn}({cc}:{cc},"{w}",{sc}:{sc})'
@edit
def e_count_condition():
    cc=col(); w=word()
    return f"=COUNT({cc}:{cc})", f"only the {w} ones", f'=COUNTIF({cc}:{cc},"{w}")'
@edit
def e_wrap_iferror():
    fn=random.choice(G); d,f=fn()
    label, val = random.choice([("0","0"), ("blank",'""'), ("not found",'"not found"')])
    return f, f"show {label} if it errors", f"=IFERROR({f[1:]},{val})"
@edit
def e_round_result():
    r,d=rng(); fn=random.choice(["SUM","AVERAGE","PRODUCT"]); k=random.randint(0,3)
    return f"={fn}({r})", f"round it to {k} decimals", f"=ROUND({fn}({r}),{k})"
@edit
def e_absolute():
    c=col(); a=random.randint(1,50); b=a+random.randint(5,40)
    return f"=SUM({c}{a}:{c}{b})", "lock the references", f"=SUM(${c}${a}:${c}${b})"
@edit
def e_change_threshold():
    c=col(); o=opn(); a,b=random.sample([5,10,20,25,50,100,200,500],2)
    return f'=COUNTIF({c}:{c},"{o}{a}")', f"use {b} instead of {a}", f'=COUNTIF({c}:{c},"{o}{b}")'
@edit
def e_change_value():
    cc=col(); sc=col(); w1,w2=random.sample(WORDS,2)
    return f'=SUMIF({cc}:{cc},"{w1}",{sc}:{sc})', f"change {w1} to {w2}", f'=SUMIF({cc}:{cc},"{w2}",{sc}:{sc})'
@edit
def e_add_second_condition():
    sc=col(); c1=col(); c2=col(); w1=word(); w2=word()
    return (f'=SUMIF({c1}:{c1},"{w1}",{sc}:{sc})', f"also where {c2} is {w2}",
            f'=SUMIFS({sc}:{sc},{c1}:{c1},"{w1}",{c2}:{c2},"{w2}")')
@edit
def e_as_percent():
    a=cell(); b=cell()
    return f"={a}/{b}", "show it as a percentage", f'=TEXT({a}/{b},"0.00%")'
@edit
def e_wrap_abs():
    a=cell(); b=cell()
    return f"={a}-{b}", "make it always positive", f"=ABS({a}-{b})"
@edit
def e_vlookup_approx():
    c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4)
    return f"=VLOOKUP({c},{t}:{t2},{k},FALSE)", "use approximate match", f"=VLOOKUP({c},{t}:{t2},{k},TRUE)"
@edit
def e_vlookup_col():
    c=cell(); t=col(); t2=chr(ord(t)+3); a,b=random.sample([2,3,4],2)
    return f"=VLOOKUP({c},{t}:{t2},{a},FALSE)", f"return column {b} instead", f"=VLOOKUP({c},{t}:{t2},{b},FALSE)"
@edit
def e_wrap_ifna():
    c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4)
    return f"=VLOOKUP({c},{t}:{t2},{k},FALSE)", "show a dash if not found", f'=IFNA(VLOOKUP({c},{t}:{t2},{k},FALSE),"-")'
@edit
def e_negate():
    c=col(); o,no=random.choice([(">","<="),("<",">="),(">=","<"),("<=",">")]); n=num()
    return f'=COUNTIF({c}:{c},"{o}{n}")', "flip the comparison", f'=COUNTIF({c}:{c},"{no}{n}")'
@edit
def e_to_max():
    r,d=rng()
    return f"=SUM({r})", "give me the biggest one instead", f"=MAX({r})"
@edit
def e_add_trim():
    a=cell(); b=cell()
    return f"=VLOOKUP({a},{b[0]}:{chr(ord(b[0])+1)},2,FALSE)", "ignore extra spaces in the lookup", f"=VLOOKUP(TRIM({a}),{b[0]}:{chr(ord(b[0])+1)},2,FALSE)"
@edit
def e_make_upper():
    a=cell()
    return f"={a}", "in uppercase", f"=UPPER({a})"
@edit
def e_pct_of_total():
    c=col(); r=random.randint(2,40)
    return f"={c}{r}", "as a percent of the column total", f"={c}{r}/SUM(${c}:${c})"
@edit
def e_change_decimals():
    r,d=rng(); a,b=random.sample([0,1,2,3,4],2)
    return f"=ROUND(SUM({r}),{a})", f"round to {b} decimals instead", f"=ROUND(SUM({r}),{b})"
@edit
def e_xlookup_default():
    c=cell(); k=col(); v=col()
    return f"=XLOOKUP({c},{k}:{k},{v}:{v})", "return not found if missing", f'=XLOOKUP({c},{k}:{k},{v}:{v},"not found")'
@edit
def e_swap_and_or():
    a=cell(); b=cell(); fr,to=random.choice([("AND","OR"),("OR","AND")])
    return f"={fr}({a}>0,{b}>0)", f"match if either holds" if to=="OR" else "require both", f"={to}({a}>0,{b}>0)"
@edit
def e_remove_condition():
    cc=col(); sc=col(); w=word()
    return f'=SUMIF({cc}:{cc},"{w}",{sc}:{sc})', "for everything, not just that one", f"=SUM({sc}:{sc})"
@edit
def e_change_operator():
    c=col(); o,no=random.choice([(">","<"),("<",">"),(">=","<="),("<=",">=")]); n=num()
    return f'=COUNTIF({c}:{c},"{o}{n}")', "go the other direction", f'=COUNTIF({c}:{c},"{no}{n}")'
@edit
def e_to_countifs():
    c1=col(); c2=col(); w1,w2=random.sample(WORDS,2)
    return f'=COUNTIF({c1}:{c1},"{w1}")', f"and where {c2} is {w2}", f'=COUNTIFS({c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@edit
def e_change_sheet():
    s1,s2=random.sample(SHEETS,2); c=cell()
    return f"={s1}!{c}", f"pull from {s2} instead", f"={s2}!{c}"
@edit
def e_lock_cols():
    c=col(); a=random.randint(1,40); b=a+random.randint(3,30)
    return f"=SUM({c}{a}:{c}{b})", "lock only the columns so it can fill down", f"=SUM(${c}{a}:${c}{b})"
@edit
def e_multiply_by():
    c=col(); r=random.randint(2,40); k=random.choice(["1.1","1.05","0.9","2"])
    return f"={c}{r}", f"multiplied by {k}", f"={c}{r}*{k}"
@edit
def e_concat_space():
    a=cell(); b=cell()
    return f"={a}&{b}", "put a space between them", f'={a}&" "&{b}'
@edit
def e_change_lookup_value():
    a=cell(); b=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,3)
    return f"=VLOOKUP({a},{t}:{t2},{k},FALSE)", f"look up {b} instead", f"=VLOOKUP({b},{t}:{t2},{k},FALSE)"
@edit
def e_add_wildcard():
    c=col(); w=word()
    return f'=COUNTIF({c}:{c},"{w}")', "count the ones that contain it", f'=COUNTIF({c}:{c},"*{w}*")'
@edit
def e_to_average():
    r,d=rng()
    return f"=SUM({r})", "average them instead", f"=AVERAGE({r})"
@edit
def e_make_relative():
    c=col(); a=random.randint(1,40); b=a+random.randint(3,30)
    return f"=SUM(${c}${a}:${c}${b})", "unlock the references", f"=SUM({c}{a}:{c}{b})"
@edit
def e_divide_by():
    c=col(); r=random.randint(2,40); n=random.choice([12,100,1000])
    return f"={c}{r}", f"divided by {n}", f"={c}{r}/{n}"
@edit
def e_subtract():
    a=cell(); b=cell()
    return f"={a}", f"minus {b}", f"={a}-{b}"
@edit
def e_negate():
    c=col(); r=random.randint(2,40)
    return f"={c}{r}", "make it negative", f"=-{c}{r}"
@edit
def e_pct_change():
    a=cell(); b=cell()
    return f"={a}", f"as a percent change from {b}", f"=({a}-{b})/{b}"
@edit
def e_extend_range():
    c=col(); a=random.randint(1,5); b=random.choice([10,20,50]); b2=b+random.choice([10,30,50])
    return f"=SUM({c}{a}:{c}{b})", f"include through row {b2}", f"=SUM({c}{a}:{c}{b2})"

EDIT_TEMPLATES = ["edit {o} to {i}", "change {o} so it {i}", "take {o} and {i}",
                  "{i}: {o}", "in {o}, {i}", "modify {o}: {i}"]
def gen_edit():
    o, i, new = random.choice(EDITS)()
    return random.choice(EDIT_TEMPLATES).format(o=o, i=i), new

# ── chart / pivot specs: intent -> a spec the add-in builds via Office.js ──
CHART_TYPES = ["bar", "column", "line", "pie", "scatter", "area", "doughnut"]
def gen_chart():
    if random.random() < 0.7:
        t=random.choice(CHART_TYPES); m=hdr1(); dim=hdr1()
        q=random.choice([f"{t} chart of {m} by {dim}",
                         f"make a {t} chart of {m} for each {dim}",
                         f"plot {m} against {dim} as a {t} chart"])
        return q, f"CHART type={t} values={m} category={dim}"
    m=hdr1(); dim=hdr1(); agg=random.choice(["sum","count","average"])
    q=random.choice([f"pivot {m} by {dim}", f"summarize {agg} of {m} by {dim}",
                     f"pivot table of {m} grouped by {dim}"])
    return q, f"PIVOT rows={dim} values={m} agg={agg}"

# ── conditional formatting: intent -> a FORMAT spec the add-in applies ──
COLORS = ["red", "green", "yellow", "orange", "blue"]
def gen_format():
    h = hdr1(); color = random.choice(COLORS); r = random.random()
    if r < 0.35:
        o = opn(); n = num()
        q = random.choice([f"highlight {h} {opw(o)} {n} in {color}",
                           f"color {h} cells {opw(o)} {n} {color}",
                           f"highlight the {h} column where it is {opw(o)} {n}"])
        return q, f"FORMAT range={h} rule={o}{n} color={color}"
    if r < 0.50:
        return random.choice([f"highlight negative {h} in red", f"color negative {h} values red"]), \
               f"FORMAT range={h} rule=<0 color=red"
    if r < 0.65:
        return random.choice([f"highlight duplicates in {h}", f"flag duplicate {h} values in {color}"]), \
               f"FORMAT range={h} rule=duplicate color={color}"
    if r < 0.80:
        k = random.choice([3, 5, 10])
        return random.choice([f"highlight the top {k} {h}", f"color the top {k} values in {h} {color}"]), \
               f"FORMAT range={h} rule=top{k} color={color}"
    if r < 0.85:
        w = word()
        return random.choice([f"highlight {h} containing {w}", f"color {h} cells that contain {w} {color}"]), \
               f"FORMAT range={h} rule=contains:{w} color={color}"
    if r < 0.93:
        return random.choice([f"add a color scale to {h}", f"apply a heat map to the {h} column"]), \
               f"FORMAT range={h} rule=colorscale"
    return random.choice([f"add data bars to {h}", f"show {h} as in-cell bars"]), \
           f"FORMAT range={h} rule=databar color={color}"

# ── data cleaning: intent -> a CLEAN spec the add-in runs via Office.js ──
def gen_clean():
    h = hdr1(); r = random.random()
    if r < 0.14:
        return random.choice(["remove duplicate rows", "delete duplicates"]), "CLEAN op=dedupe"
    if r < 0.26:
        _, nm = random.choice(DELIMS)
        return f"split the {h} column on the {nm}", f"CLEAN op=split col={h} by={nm.replace(' ', '')}"
    if r < 0.40:
        v = random.choice(["0", "n/a", word()])
        return f"fill blank cells in {h} with {v}", f"CLEAN op=fillblanks col={h} value={v}"
    if r < 0.52:
        return random.choice([f"trim extra spaces in {h}", f"remove extra spaces from {h}"]), f"CLEAN op=trim col={h}"
    if r < 0.62:
        return f"convert {h} to numbers", f"CLEAN op=tonumber col={h}"
    if r < 0.74:
        op, wrd = random.choice([("upper", "uppercase"), ("lower", "lowercase"), ("proper", "capitalize")])
        return f"make {h} {wrd}", f"CLEAN op={op} col={h}"
    if r < 0.82:
        a, b = random.sample(WORDS, 2)
        return f"replace {a} with {b} in {h}", f"CLEAN op=replace col={h} find={a} with={b}"
    if r < 0.88:
        return "remove blank rows", "CLEAN op=delblankrows"
    if r < 0.94:
        return f"standardize the dates in {h}", f"CLEAN op=stddate col={h}"
    return f"fill down the values in {h}", f"CLEAN op=filldown col={h}"

# ── bilingual: Spanish descriptions -> the same formulas (común, día a día) ──
SPANISH = []
def es(fn): SPANISH.append(fn); return fn
@es
def es_sum():     c=col(); return random.choice([f"suma la columna {c}", f"suma de {c}", f"sumar {c}"]), f"=SUM({c}:{c})"
@es
def es_avg():     c=col(); return random.choice([f"promedio de la columna {c}", f"media de {c}"]), f"=AVERAGE({c}:{c})"
@es
def es_count():   c=col(); return random.choice([f"cuenta los números en {c}", f"contar {c}"]), f"=COUNT({c}:{c})"
@es
def es_counta():  c=col(); return f"cuenta las celdas no vacías en {c}", f"=COUNTA({c}:{c})"
@es
def es_max():     c=col(); return random.choice([f"el máximo de {c}", f"el valor más alto en {c}"]), f"=MAX({c}:{c})"
@es
def es_min():     c=col(); return random.choice([f"el mínimo de {c}", f"el valor más bajo en {c}"]), f"=MIN({c}:{c})"
@es
def es_median():  c=col(); return f"la mediana de {c}", f"=MEDIAN({c}:{c})"
@es
def es_stdev():   c=col(); return f"desviación estándar de {c}", f"=STDEV({c}:{c})"
@es
def es_product(): c=col(); return f"multiplica todos los valores de {c}", f"=PRODUCT({c}:{c})"
@es
def es_sumif():   cc=col(); sc=col(); w=word(); return f"suma {sc} donde {cc} es {w}", f'=SUMIF({cc}:{cc},"{w}",{sc}:{sc})'
@es
def es_countif(): c=col(); w=word(); return f"cuenta cuántos {w} hay en {c}", f'=COUNTIF({c}:{c},"{w}")'
@es
def es_averageif():cc=col(); ac=col(); w=word(); return f"promedio de {ac} donde {cc} es {w}", f'=AVERAGEIF({cc}:{cc},"{w}",{ac}:{ac})'
@es
def es_sumifs():  sc=col(); c1=col(); c2=col(); w1=word(); w2=word(); return f"suma {sc} donde {c1} es {w1} y {c2} es {w2}", f'=SUMIFS({sc}:{sc},{c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@es
def es_countifs():c1=col(); c2=col(); w1=word(); w2=word(); return f"cuenta filas donde {c1} es {w1} y {c2} es {w2}", f'=COUNTIFS({c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@es
def es_if():      c=cell(); t=num(); return f"si {c} es mayor que {t} di alto si no bajo", f'=IF({c}>{t},"alto","bajo")'
@es
def es_iferror(): a=cell(); b=cell(); return f"divide {a} entre {b}, muestra 0 si hay error", f"=IFERROR({a}/{b},0)"
@es
def es_round():   c=cell(); k=random.randint(0,3); return f"redondea {c} a {k} decimales", f"=ROUND({c},{k})"
@es
def es_today():   return random.choice(["la fecha de hoy", "fecha de hoy"]), "=TODAY()"
@es
def es_vlookup(): c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4); return f"busca {c} en {t}:{t2} y devuelve la columna {k}", f"=VLOOKUP({c},{t}:{t2},{k},FALSE)"
@es
def es_concat():  a=cell(); b=cell(); return f"une {a} y {b} con un espacio", f'={a}&" "&{b}'
@es
def es_len():     c=cell(); return f"longitud de {c}", f"=LEN({c})"
@es
def es_upper():   c=cell(); return f"convierte {c} a mayúsculas", f"=UPPER({c})"
@es
def es_lower():   c=cell(); return f"convierte {c} a minúsculas", f"=LOWER({c})"
@es
def es_sum_named():h=hdr(); return f"suma la columna de {h}", f"=SUM({h})"
@es
def es_avg_named():h=hdr(); return f"promedio de {h}", f"=AVERAGE({h})"
@es
def es_pct_change():cl=col(); a=random.randint(1,80); b=a+1; return f"cambio porcentual de {cl}{a} a {cl}{b}", f"=({cl}{b}-{cl}{a})/{cl}{a}"
@es
def es_xlookup(): c=cell(); k=col(); v=col(); return f"busca {c} en {k} y devuelve {v}", f"=XLOOKUP({c},{k}:{k},{v}:{v})"
@es
def es_trim():    c=cell(); return f"elimina los espacios de {c}", f"=TRIM({c})"
@es
def es_left():    c=cell(); n=random.randint(2,4); return f"los primeros {n} caracteres de {c}", f"=LEFT({c},{n})"
@es
def es_right():   c=cell(); n=random.randint(2,4); return f"los últimos {n} caracteres de {c}", f"=RIGHT({c},{n})"
@es
def es_abs():     c=cell(); return f"el valor absoluto de {c}", f"=ABS({c})"
@es
def es_maxifs():  sc=col(); cc=col(); w=word(); return f"el máximo de {sc} donde {cc} es {w}", f'=MAXIFS({sc}:{sc},{cc}:{cc},"{w}")'
@es
def es_pct_total():c=col(); r=random.randint(2,40); return f"qué porcentaje del total es {c}{r}", f"={c}{r}/SUM({c}:{c})"
@es
def es_year():    c=cell(); return f"el año de la fecha {c}", f"=YEAR({c})"

# ── Portuguese ──
PORTUGUESE = []
def pt(fn): PORTUGUESE.append(fn); return fn
@pt
def pt_sum():     c=col(); return random.choice([f"soma da coluna {c}", f"somar {c}"]), f"=SUM({c}:{c})"
@pt
def pt_avg():     c=col(); return f"média da coluna {c}", f"=AVERAGE({c}:{c})"
@pt
def pt_count():   c=col(); return f"conte os números em {c}", f"=COUNT({c}:{c})"
@pt
def pt_max():     c=col(); return f"máximo de {c}", f"=MAX({c}:{c})"
@pt
def pt_min():     c=col(); return f"mínimo de {c}", f"=MIN({c}:{c})"
@pt
def pt_median():  c=col(); return f"mediana de {c}", f"=MEDIAN({c}:{c})"
@pt
def pt_sumif():   cc=col(); sc=col(); w=word(); return f"soma {sc} onde {cc} é {w}", f'=SUMIF({cc}:{cc},"{w}",{sc}:{sc})'
@pt
def pt_countif(): c=col(); w=word(); return f"conte {w} na coluna {c}", f'=COUNTIF({c}:{c},"{w}")'
@pt
def pt_if():      c=cell(); t=num(); return f"se {c} for maior que {t} diga alto senão baixo", f'=IF({c}>{t},"alto","baixo")'
@pt
def pt_round():   c=cell(); k=random.randint(0,3); return f"arredonde {c} para {k} casas decimais", f"=ROUND({c},{k})"
@pt
def pt_vlookup(): c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4); return f"procure {c} em {t}:{t2} e retorne a coluna {k}", f"=VLOOKUP({c},{t}:{t2},{k},FALSE)"
@pt
def pt_today():   return "a data de hoje", "=TODAY()"
@pt
def pt_concat():  a=cell(); b=cell(); return f"junte {a} e {b} com um espaço", f'={a}&" "&{b}'
@pt
def pt_upper():   c=cell(); return f"{c} em maiúsculas", f"=UPPER({c})"
@pt
def pt_lower():   c=cell(); return f"{c} em minúsculas", f"=LOWER({c})"
@pt
def pt_counta():  c=col(); return f"conte as células não vazias em {c}", f"=COUNTA({c}:{c})"
@pt
def pt_stdev():   c=col(); return f"desvio padrão de {c}", f"=STDEV({c}:{c})"
@pt
def pt_product(): c=col(); return f"multiplique todos os valores de {c}", f"=PRODUCT({c}:{c})"
@pt
def pt_averageif():cc=col(); ac=col(); w=word(); return f"média de {ac} onde {cc} é {w}", f'=AVERAGEIF({cc}:{cc},"{w}",{ac}:{ac})'
@pt
def pt_sumifs():  sc=col(); c1=col(); c2=col(); w1=word(); w2=word(); return f"some {sc} onde {c1} é {w1} e {c2} é {w2}", f'=SUMIFS({sc}:{sc},{c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@pt
def pt_countifs():c1=col(); c2=col(); w1=word(); w2=word(); return f"conte linhas onde {c1} é {w1} e {c2} é {w2}", f'=COUNTIFS({c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@pt
def pt_iferror(): a=cell(); b=cell(); return f"divida {a} por {b}, mostre 0 se houver erro", f"=IFERROR({a}/{b},0)"
@pt
def pt_len():     c=cell(); return f"comprimento de {c}", f"=LEN({c})"
@pt
def pt_xlookup(): c=cell(); k=col(); v=col(); return f"procure {c} em {k} e retorne {v}", f"=XLOOKUP({c},{k}:{k},{v}:{v})"
@pt
def pt_trim():    c=cell(); return f"remova os espaços de {c}", f"=TRIM({c})"
@pt
def pt_sum_named():h=hdr(); return f"soma da coluna {h}", f"=SUM({h})"
@pt
def pt_pct_change():cl=col(); a=random.randint(1,80); b=a+1; return f"variação percentual de {cl}{a} para {cl}{b}", f"=({cl}{b}-{cl}{a})/{cl}{a}"

# ── French ──
FRENCH = []
def fr(fn): FRENCH.append(fn); return fn
@fr
def fr_sum():     c=col(); return random.choice([f"somme de la colonne {c}", f"additionner {c}"]), f"=SUM({c}:{c})"
@fr
def fr_avg():     c=col(); return f"moyenne de la colonne {c}", f"=AVERAGE({c}:{c})"
@fr
def fr_count():   c=col(); return f"compter les nombres dans {c}", f"=COUNT({c}:{c})"
@fr
def fr_max():     c=col(); return f"maximum de {c}", f"=MAX({c}:{c})"
@fr
def fr_min():     c=col(); return f"minimum de {c}", f"=MIN({c}:{c})"
@fr
def fr_median():  c=col(); return f"médiane de {c}", f"=MEDIAN({c}:{c})"
@fr
def fr_sumif():   cc=col(); sc=col(); w=word(); return f"somme de {sc} où {cc} est {w}", f'=SUMIF({cc}:{cc},"{w}",{sc}:{sc})'
@fr
def fr_countif(): c=col(); w=word(); return f"compter {w} dans la colonne {c}", f'=COUNTIF({c}:{c},"{w}")'
@fr
def fr_if():      c=cell(); t=num(); return f"si {c} est supérieur à {t} dire haut sinon bas", f'=IF({c}>{t},"haut","bas")'
@fr
def fr_round():   c=cell(); k=random.randint(0,3); return f"arrondir {c} à {k} décimales", f"=ROUND({c},{k})"
@fr
def fr_vlookup(): c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4); return f"rechercher {c} dans {t}:{t2} et renvoyer la colonne {k}", f"=VLOOKUP({c},{t}:{t2},{k},FALSE)"
@fr
def fr_today():   return "la date d'aujourd'hui", "=TODAY()"
@fr
def fr_concat():  a=cell(); b=cell(); return f"joindre {a} et {b} avec un espace", f'={a}&" "&{b}'
@fr
def fr_upper():   c=cell(); return f"{c} en majuscules", f"=UPPER({c})"
@fr
def fr_lower():   c=cell(); return f"{c} en minuscules", f"=LOWER({c})"
@fr
def fr_counta():  c=col(); return f"compter les cellules non vides dans {c}", f"=COUNTA({c}:{c})"
@fr
def fr_stdev():   c=col(); return f"écart type de {c}", f"=STDEV({c}:{c})"
@fr
def fr_product(): c=col(); return f"multiplier toutes les valeurs de {c}", f"=PRODUCT({c}:{c})"
@fr
def fr_averageif():cc=col(); ac=col(); w=word(); return f"moyenne de {ac} où {cc} est {w}", f'=AVERAGEIF({cc}:{cc},"{w}",{ac}:{ac})'
@fr
def fr_sumifs():  sc=col(); c1=col(); c2=col(); w1=word(); w2=word(); return f"somme de {sc} où {c1} est {w1} et {c2} est {w2}", f'=SUMIFS({sc}:{sc},{c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@fr
def fr_countifs():c1=col(); c2=col(); w1=word(); w2=word(); return f"compter les lignes où {c1} est {w1} et {c2} est {w2}", f'=COUNTIFS({c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@fr
def fr_iferror(): a=cell(); b=cell(); return f"diviser {a} par {b}, afficher 0 en cas d'erreur", f"=IFERROR({a}/{b},0)"
@fr
def fr_len():     c=cell(); return f"longueur de {c}", f"=LEN({c})"
@fr
def fr_xlookup(): c=cell(); k=col(); v=col(); return f"rechercher {c} dans {k} et renvoyer {v}", f"=XLOOKUP({c},{k}:{k},{v}:{v})"
@fr
def fr_trim():    c=cell(); return f"supprimer les espaces de {c}", f"=TRIM({c})"
@fr
def fr_sum_named():h=hdr(); return f"somme de la colonne {h}", f"=SUM({h})"
@fr
def fr_pct_change():cl=col(); a=random.randint(1,80); b=a+1; return f"variation en pourcentage de {cl}{a} à {cl}{b}", f"=({cl}{b}-{cl}{a})/{cl}{a}"

# ── German ──
GERMAN = []
def de(fn): GERMAN.append(fn); return fn
@de
def de_sum():     c=col(); return random.choice([f"summe der spalte {c}", f"summiere {c}"]), f"=SUM({c}:{c})"
@de
def de_avg():     c=col(); return f"durchschnitt der spalte {c}", f"=AVERAGE({c}:{c})"
@de
def de_count():   c=col(); return f"zähle die zahlen in {c}", f"=COUNT({c}:{c})"
@de
def de_counta():  c=col(); return f"zähle die nicht leeren zellen in {c}", f"=COUNTA({c}:{c})"
@de
def de_max():     c=col(); return f"maximum von {c}", f"=MAX({c}:{c})"
@de
def de_min():     c=col(); return f"minimum von {c}", f"=MIN({c}:{c})"
@de
def de_median():  c=col(); return f"median von {c}", f"=MEDIAN({c}:{c})"
@de
def de_stdev():   c=col(); return f"standardabweichung von {c}", f"=STDEV({c}:{c})"
@de
def de_product(): c=col(); return f"multipliziere alle werte in {c}", f"=PRODUCT({c}:{c})"
@de
def de_sumif():   cc=col(); sc=col(); w=word(); return f"summiere {sc} wo {cc} gleich {w} ist", f'=SUMIF({cc}:{cc},"{w}",{sc}:{sc})'
@de
def de_countif(): c=col(); w=word(); return f"zähle wie viele {w} in {c} sind", f'=COUNTIF({c}:{c},"{w}")'
@de
def de_averageif():cc=col(); ac=col(); w=word(); return f"durchschnitt von {ac} wo {cc} gleich {w} ist", f'=AVERAGEIF({cc}:{cc},"{w}",{ac}:{ac})'
@de
def de_sumifs():  sc=col(); c1=col(); c2=col(); w1=word(); w2=word(); return f"summiere {sc} wo {c1} {w1} und {c2} {w2} ist", f'=SUMIFS({sc}:{sc},{c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@de
def de_if():      c=cell(); t=num(); return f"wenn {c} größer als {t} ist sage hoch sonst niedrig", f'=IF({c}>{t},"hoch","niedrig")'
@de
def de_iferror(): a=cell(); b=cell(); return f"teile {a} durch {b}, zeige 0 bei fehler", f"=IFERROR({a}/{b},0)"
@de
def de_round():   c=cell(); k=random.randint(0,3); return f"runde {c} auf {k} dezimalstellen", f"=ROUND({c},{k})"
@de
def de_today():   return "das heutige datum", "=TODAY()"
@de
def de_vlookup(): c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4); return f"suche {c} in {t}:{t2} und gib spalte {k} zurück", f"=VLOOKUP({c},{t}:{t2},{k},FALSE)"
@de
def de_xlookup(): c=cell(); k=col(); v=col(); return f"suche {c} in {k} und gib {v} zurück", f"=XLOOKUP({c},{k}:{k},{v}:{v})"
@de
def de_concat():  a=cell(); b=cell(); return f"verbinde {a} und {b} mit einem leerzeichen", f'={a}&" "&{b}'
@de
def de_len():     c=cell(); return f"länge von {c}", f"=LEN({c})"
@de
def de_upper():   c=cell(); return f"{c} in großbuchstaben", f"=UPPER({c})"
@de
def de_lower():   c=cell(); return f"{c} in kleinbuchstaben", f"=LOWER({c})"
@de
def de_sum_named():h=hdr(); return f"summe der spalte {h}", f"=SUM({h})"

# ── Italian ──
ITALIAN = []
def it(fn): ITALIAN.append(fn); return fn
@it
def it_sum():     c=col(); return random.choice([f"somma della colonna {c}", f"sommare {c}"]), f"=SUM({c}:{c})"
@it
def it_avg():     c=col(); return f"media della colonna {c}", f"=AVERAGE({c}:{c})"
@it
def it_count():   c=col(); return f"conta i numeri in {c}", f"=COUNT({c}:{c})"
@it
def it_counta():  c=col(); return f"conta le celle non vuote in {c}", f"=COUNTA({c}:{c})"
@it
def it_max():     c=col(); return f"massimo di {c}", f"=MAX({c}:{c})"
@it
def it_min():     c=col(); return f"minimo di {c}", f"=MIN({c}:{c})"
@it
def it_median():  c=col(); return f"mediana di {c}", f"=MEDIAN({c}:{c})"
@it
def it_stdev():   c=col(); return f"deviazione standard di {c}", f"=STDEV({c}:{c})"
@it
def it_product(): c=col(); return f"moltiplica tutti i valori di {c}", f"=PRODUCT({c}:{c})"
@it
def it_sumif():   cc=col(); sc=col(); w=word(); return f"somma {sc} dove {cc} è {w}", f'=SUMIF({cc}:{cc},"{w}",{sc}:{sc})'
@it
def it_countif(): c=col(); w=word(); return f"conta quanti {w} ci sono in {c}", f'=COUNTIF({c}:{c},"{w}")'
@it
def it_averageif():cc=col(); ac=col(); w=word(); return f"media di {ac} dove {cc} è {w}", f'=AVERAGEIF({cc}:{cc},"{w}",{ac}:{ac})'
@it
def it_sumifs():  sc=col(); c1=col(); c2=col(); w1=word(); w2=word(); return f"somma {sc} dove {c1} è {w1} e {c2} è {w2}", f'=SUMIFS({sc}:{sc},{c1}:{c1},"{w1}",{c2}:{c2},"{w2}")'
@it
def it_if():      c=cell(); t=num(); return f"se {c} è maggiore di {t} scrivi alto altrimenti basso", f'=IF({c}>{t},"alto","basso")'
@it
def it_iferror(): a=cell(); b=cell(); return f"dividi {a} per {b}, mostra 0 se c'è un errore", f"=IFERROR({a}/{b},0)"
@it
def it_round():   c=cell(); k=random.randint(0,3); return f"arrotonda {c} a {k} decimali", f"=ROUND({c},{k})"
@it
def it_today():   return "la data di oggi", "=TODAY()"
@it
def it_vlookup(): c=cell(); t=col(); t2=chr(ord(t)+1); k=random.randint(2,4); return f"cerca {c} in {t}:{t2} e restituisci la colonna {k}", f"=VLOOKUP({c},{t}:{t2},{k},FALSE)"
@it
def it_xlookup(): c=cell(); k=col(); v=col(); return f"cerca {c} in {k} e restituisci {v}", f"=XLOOKUP({c},{k}:{k},{v}:{v})"
@it
def it_concat():  a=cell(); b=cell(); return f"unisci {a} e {b} con uno spazio", f'={a}&" "&{b}'
@it
def it_len():     c=cell(); return f"lunghezza di {c}", f"=LEN({c})"
@it
def it_upper():   c=cell(); return f"{c} in maiuscolo", f"=UPPER({c})"
@it
def it_lower():   c=cell(); return f"{c} in minuscolo", f"=LOWER({c})"
@it
def it_sum_named():h=hdr(); return f"somma della colonna {h}", f"=SUM({h})"

def gen_spanish():    return random.choice(SPANISH)()
def gen_portuguese(): return random.choice(PORTUGUESE)()
def gen_french():     return random.choice(FRENCH)()
def gen_german():     return random.choice(GERMAN)()
def gen_italian():    return random.choice(ITALIAN)()
def gen_lang():       return random.choice(PORTUGUESE + FRENCH + GERMAN + ITALIAN)()

# ── finance pack: intent -> a MODEL spec; the add-in stamps the block of cells ──
_MODEL_SIMPLE = {
    "ratios": ["build a ratio analysis", "calculate the key financial ratios", "build the standard financial ratios"],
    "amortization": ["build a loan amortization table", "build an amortization schedule", "loan payoff schedule"],
    "breakeven": ["build a break-even analysis", "build a break-even model"],
    "cashflow": ["build a 3-month cash flow", "build a monthly cash flow projection"],
    "threestatement": ["build a 3-statement model", "build linked income statement balance sheet and cash flow"],
    "dcf": ["build a DCF valuation", "build a discounted cash flow model", "build an NPV valuation"],
    "depreciation": ["build a depreciation schedule", "build an asset depreciation table"],
    "sensitivity": ["build a sensitivity table", "build a two-variable what-if table"],
    "scenario": ["build a best base worst scenario analysis", "build a scenario model"],
    "budget": ["build a budget tracker", "build a monthly budget template"],
    "invoice": ["build an invoice template", "make an invoice"],
    "expense": ["build an expense report", "build an expense tracker"],
    "inventory": ["build an inventory tracker", "build a stock tracking sheet"],
    "dashboard": ["build a KPI dashboard", "build a metrics scorecard"],
    "montecarlo": ["build a monte carlo simulation", "build a monte carlo risk model"],
    "commission": ["build a sales commission calculator", "build a tiered commission model"],
    "runway": ["build a cash runway model", "calculate burn rate and runway"],
    "savings": ["build a savings goal calculator", "build a future value savings plan"],
    "loancompare": ["compare two loan options", "build a loan comparison"],
    "contribution": ["build a contribution margin analysis", "build a product margin breakdown"],
    "roi": ["build an ROI calculator", "build a payback period model"],
}
def gen_model():
    r = random.random()
    if r < 0.10:
        a = hdr1(); b = hdr1()
        return random.choice([f"variance report of actual {a} versus budget {b}",
                              f"build a budget variance for {a} vs {b}"]), f"MODEL type=variance actual={a} budget={b}"
    if r < 0.18:
        a = hdr1()
        return random.choice([f"build an aging report for {a}", f"AR aging of {a}"]), f"MODEL type=aging amount={a} date=date"
    t = random.choice(list(_MODEL_SIMPLE))
    return random.choice(_MODEL_SIMPLE[t]), f"MODEL type={t}"

# ── more sheet actions: data validation, sort, filter ──
def _a_validate_list():c=col(); v=random.sample(WORDS, random.randint(3,4)); return random.choice([f"add a dropdown of {', '.join(v)} in {c}", f"restrict {c} to {', '.join(v)}"]), f"VALIDATE col={c} type=list items={'|'.join(v)}"
def _a_validate_num(): c=col(); a=num(); b=a+num(); return f"only allow numbers between {a} and {b} in {c}", f"VALIDATE col={c} type=number min={a} max={b}"
def _a_sort():        h=hdr1(); o=random.choice(["desc","asc"]); wo="descending" if o=="desc" else "ascending"; return random.choice([f"sort by {h} {wo}", f"order by {h} {wo}"]), f"SORT by={h} order={o}"
def _a_filter():      c=col(); w=word(); return random.choice([f"filter to show only {w} in {c}", f"filter {c} to {w}"]), f"FILTERVIEW col={c} value={w}"
def _a_numfmt():      c=col(); f=random.choice(["currency","percent","date","comma"]); return f"format column {c} as {f}", f"NUMFMT col={c} as={f}"
def _a_freeze_row():  return random.choice(["freeze the top row","freeze row 1"]), "FREEZE rows=1"
def _a_freeze_col():  return "freeze the first column", "FREEZE cols=1"
def _a_autofit():     return random.choice(["autofit all columns","autofit the columns"]), "AUTOFIT"
def _a_hide():        c=col(); return f"hide column {c}", f"HIDECOL col={c}"
def _a_unhide():      c=col(); return f"unhide column {c}", f"UNHIDE col={c}"
def _a_delete():      c=col(); return random.choice([f"delete column {c}", f"remove column {c}"]), f"DELETECOL col={c}"
def _a_insertrow():   n=random.randint(2,50); return f"insert a row at row {n}", f"INSERTROW at={n}"
def _a_insertcol():   c=col(); return f"insert a column at {c}", f"INSERTCOL at={c}"
def _a_namerange():   c=col(); h=hdr1(); return f"name column {c} as {h}", f"NAMERANGE name={h} range={c}:{c}"
def _a_protect():     return random.choice(["lock the sheet","protect the sheet"]), "PROTECT"
def _a_width():       c=col(); n=random.choice([60,80,100,120,150]); return f"set column {c} width to {n}", f"WIDTH col={c} px={n}"
def _a_border():      c=col(); return random.choice([f"add borders to column {c}", f"outline column {c}"]), f"BORDER col={c}"
def _a_fillcolor():   c=col(); k=random.choice(COLORS); return f"fill column {c} with {k}", f"FILLCOLOR col={c} color={k}"
def _a_fontcolor():   c=col(); k=random.choice(COLORS); return f"make the font in {c} {k}", f"FONTCOLOR col={c} color={k}"
def _a_bold():        c=col(); return random.choice([f"bold column {c}", f"make {c} bold"]), f"BOLD col={c}"
def _a_align():       c=col(); al=random.choice(["center","left","right"]); return f"align column {c} to the {al}", f"ALIGN col={c} to={al}"
def _a_wrap():        c=col(); return f"wrap text in column {c}", f"WRAP col={c}"
def _a_clear():       c=col(); w=random.choice(["contents","formats"]); return f"clear the {w} of column {c}", f"CLEAR col={c} what={w}"
def _a_merge():       c=col(); a=random.randint(1,5); b=a+random.randint(1,4); return f"merge cells {c}{a} to {c}{b}", f"MERGE range={c}{a}:{c}{b}"
def _a_table():       c=col(); c2=chr(ord(c)+3); return f"convert {c}:{c2} to a table", f"TABLE range={c}:{c2}"
def _a_gridlines():   s=random.choice(["off","on"]); return f"turn gridlines {s}", f"GRIDLINES show={'false' if s=='off' else 'true'}"
def _a_tabcolor():    k=random.choice(COLORS); return f"color the sheet tab {k}", f"TABCOLOR color={k}"
FONTS = ["Arial", "Calibri", "Times New Roman", "Verdana"]
def _a_italic():      c=col(); return f"italicize column {c}", f"ITALIC col={c}"
def _a_underline():   c=col(); return f"underline column {c}", f"UNDERLINE col={c}"
def _a_strike():      c=col(); return f"strikethrough column {c}", f"STRIKE col={c}"
def _a_fontsize():    c=col(); n=random.choice([8,10,12,14,16,18,24]); return f"set column {c} font size to {n}", f"FONTSIZE col={c} pt={n}"
def _a_fontname():    c=col(); f=random.choice(FONTS); return f"set column {c} font to {f}", f"FONTNAME col={c} font={f.replace(' ','_')}"
def _a_valign():      c=col(); v=random.choice(["top","middle","bottom"]); return f"vertically align column {c} to {v}", f"VALIGN col={c} to={v}"
def _a_indent():      c=col(); return f"indent column {c}", f"INDENT col={c}"
def _a_rotate():      c=col(); d=random.choice([45,90,-45]); return f"rotate text in {c} by {d} degrees", f"ROTATE col={c} deg={d}"
def _a_shrinkfit():   c=col(); return f"shrink text to fit in {c}", f"SHRINKFIT col={c}"
def _a_hiderow():     n=random.randint(2,50); return f"hide row {n}", f"HIDEROW row={n}"
def _a_unhiderow():   n=random.randint(2,50); return f"unhide row {n}", f"UNHIDEROW row={n}"
def _a_deleterow():   n=random.randint(2,50); return f"delete row {n}", f"DELETEROW row={n}"
def _a_rowheight():   n=random.randint(2,50); h=random.choice([15,20,30,40]); return f"set row {n} height to {h}", f"ROWHEIGHT row={n} px={h}"
def _a_grouprows():   a=random.randint(2,20); b=a+random.randint(2,10); return f"group rows {a} to {b}", f"GROUPROWS from={a} to={b}"
def _a_groupcols():   c=col(); c2=chr(ord(c)+2); return f"group columns {c} to {c2}", f"GROUPCOLS from={c} to={c2}"
def _a_insertsheet(): h=hdr1(); return f"add a sheet called {h}", f"INSERTSHEET name={h}"
def _a_deletesheet(): h=hdr1(); return f"delete the {h} sheet", f"DELETESHEET name={h}"
def _a_renamesheet(): h=hdr1(); return f"rename the sheet to {h}", f"RENAMESHEET name={h}"
def _a_copysheet():   return random.choice(["duplicate the sheet","copy this sheet"]), "COPYSHEET"
def _a_hidesheet():   return "hide this sheet", "HIDESHEET"
def _a_clearfilter(): return random.choice(["clear all filters","remove the filter"]), "CLEARFILTER"
def _a_refresh():     return random.choice(["refresh all data","refresh the data connections"]), "REFRESH"
def _a_zoom():        n=random.choice([50,75,100,125,150]); return f"zoom to {n} percent", f"ZOOM pct={n}"
def _a_showformulas():s=random.choice(["true","false"]); return ("show formulas" if s=="true" else "hide formulas"), f"SHOWFORMULAS show={s}"
def _a_split():       return "split the panes", "SPLITPANES"
def _a_hyperlink():   c=cell(); return f"add a hyperlink in {c} to example.com", f"HYPERLINK cell={c} url=example.com"
def _a_comment():     c=cell(); w=word(); return f"add a note to {c} saying {w}", f"COMMENT cell={c} text={w}"
def _a_sparkline():   c=cell(); cl=col(); return f"add a sparkline in {c} for column {cl}", f"SPARKLINE cell={c} data={cl}:{cl}"
def _a_orientation(): o=random.choice(["landscape","portrait"]); return f"set page orientation to {o}", f"ORIENTATION to={o}"
def _a_printarea():   c=col(); c2=chr(ord(c)+3); return f"set the print area to {c}:{c2}", f"PRINTAREA range={c}:{c2}"
def _a_calcnow():     return random.choice(["recalculate now","force a recalculation"]), "CALCNOW"
def _a_precedents():  c=cell(); return f"trace the precedents of {c}", f"PRECEDENTS cell={c}"
def _a_texttocols():  c=col(); return f"split {c} into columns by delimiter", f"TEXTTOCOLS col={c}"
def _a_subtotal():    h=hdr1(); return f"add subtotals by {h}", f"SUBTOTAL by={h}"
_ACTIONS = [_a_validate_list, _a_validate_num, _a_sort, _a_filter, _a_numfmt, _a_freeze_row, _a_freeze_col,
            _a_autofit, _a_hide, _a_unhide, _a_delete, _a_insertrow, _a_insertcol, _a_namerange, _a_protect,
            _a_width, _a_border, _a_fillcolor, _a_fontcolor, _a_bold, _a_align, _a_wrap, _a_clear, _a_merge,
            _a_table, _a_gridlines, _a_tabcolor, _a_italic, _a_underline, _a_strike, _a_fontsize, _a_fontname,
            _a_valign, _a_indent, _a_rotate, _a_shrinkfit, _a_hiderow, _a_unhiderow, _a_deleterow, _a_rowheight,
            _a_grouprows, _a_groupcols, _a_insertsheet, _a_deletesheet, _a_renamesheet, _a_copysheet, _a_hidesheet,
            _a_clearfilter, _a_refresh, _a_zoom, _a_showformulas, _a_split, _a_hyperlink, _a_comment, _a_sparkline,
            _a_orientation, _a_printarea, _a_calcnow, _a_precedents, _a_texttocols, _a_subtotal]
def gen_action():
    return random.choice(_ACTIONS)()

# ── multi-step automation: chain several actions into one sequence (the "automate" tier) ──
def gen_steps():
    def step(k):
        h = hdr1()
        if k=="trim":       return f"trim spaces in {h}", f"CLEAN op=trim col={h}"
        if k=="upper":      return f"uppercase {h}", f"CLEAN op=upper col={h}"
        if k=="lower":      return f"lowercase {h}", f"CLEAN op=lower col={h}"
        if k=="dedupe":     return "remove duplicate rows", "CLEAN op=dedupe"
        if k=="delblank":   return "remove blank rows", "CLEAN op=delblankrows"
        if k=="fillblanks": v=random.choice(["0",word()]); return f"fill blanks in {h} with {v}", f"CLEAN op=fillblanks col={h} value={v}"
        if k=="fmt":        o=opn(); n=num(); return f"highlight {h} {opw(o)} {n}", f"FORMAT range={h} rule={o}{n} color=red"
        if k=="sort":       o=random.choice(["desc","asc"]); return f"sort by {h} {'descending' if o=='desc' else 'ascending'}", f"SORT by={h} order={o}"
        if k=="numfmt":     fmt=random.choice(["currency","percent","comma"]); return f"format {h} as {fmt}", f"NUMFMT col={h} as={fmt}"
        if k=="freeze":     return "freeze the top row", "FREEZE rows=1"
        if k=="autofit":    return "autofit the columns", "AUTOFIT"
        if k=="bold":       return f"bold the {h} header", f"BOLD col={h}"
        w=word(); return f"filter {h} to {w}", f"FILTERVIEW col={h} value={w}"
    kinds = random.sample(["trim","upper","lower","dedupe","delblank","fillblanks","fmt","sort","numfmt","freeze","autofit","bold","filt"], random.randint(3,6))
    steps = [step(k) for k in kinds]
    return ", then ".join(s[0] for s in steps), "STEPS " + " ; ".join(s[1] for s in steps)

# ── transpile: Excel formula -> Python / pandas ──
TRANSPILE = [
    ("=SUM(A:A)", "df['A'].sum()"), ("=AVERAGE(B:B)", "df['B'].mean()"),
    ("=COUNT(C:C)", "df['C'].count()"), ("=MAX(A:A)", "df['A'].max()"),
    ("=MIN(D:D)", "df['D'].min()"), ("=MEDIAN(A:A)", "df['A'].median()"),
    ("=STDEV(A:A)", "df['A'].std()"), ("=PRODUCT(A:A)", "df['A'].prod()"),
    ('=SUMIF(A:A,"x",B:B)', "df.loc[df['A']=='x','B'].sum()"),
    ('=COUNTIF(A:A,"x")', "(df['A']=='x').sum()"),
    ('=AVERAGEIF(A:A,"x",B:B)', "df.loc[df['A']=='x','B'].mean()"),
    ("=ROUND(A1,2)", "round(a, 2)"), ("=LEN(A1)", "len(a)"),
    ('=IF(A1>10,"hi","lo")', "'hi' if a > 10 else 'lo'"),
    ("=A1+B1", "a + b"), ('=A1&" "&B1', "a + ' ' + b"),
    ("=UNIQUE(A:A)", "df['A'].unique()"),
    ('=FILTER(A:A,B:B="x")', "df.loc[df['B']=='x','A']"),
    ("=VAR(A:A)", "df['A'].var()"), ("=COUNTA(A:A)", "df['A'].notna().sum()"),
    ('=SUMIFS(C:C,A:A,"x",B:B,"y")', "df.loc[(df['A']=='x')&(df['B']=='y'),'C'].sum()"),
    ('=COUNTIFS(A:A,"x",B:B,"y")', "((df['A']=='x')&(df['B']=='y')).sum()"),
    ("=UPPER(A1)", "a.upper()"), ("=LOWER(A1)", "a.lower()"), ("=PROPER(A1)", "a.title()"),
    ("=TRIM(A1)", "a.strip()"), ("=LEFT(A1,3)", "a[:3]"), ("=RIGHT(A1,3)", "a[-3:]"),
    ("=MID(A1,2,3)", "a[1:4]"), ('=SUBSTITUTE(A1,"x","y")', "a.replace('x','y')"),
    ("=ABS(A1)", "abs(a)"), ("=SQRT(A1)", "a**0.5"), ("=MOD(A1,3)", "a % 3"),
    ("=INT(A1)", "int(a)"), ("=POWER(A1,2)", "a**2"), ("=YEAR(A1)", "a.year"),
    ("=CORREL(A:A,B:B)", "df['A'].corr(df['B'])"),
    ("=COUNTA(UNIQUE(A:A))", "df['A'].nunique()"),
    ("=SORT(A:A)", "df['A'].sort_values()"),
    ("=VLOOKUP(A1,B:C,2,FALSE)", "df.set_index('B')['C'].get(a)"),
    ('=TEXTJOIN(",",TRUE,A:A)', "','.join(df['A'].astype(str))"),
]
SQL = [
    ("=SUM(A:A)", "SELECT SUM(A) FROM t"), ("=AVERAGE(A:A)", "SELECT AVG(A) FROM t"),
    ("=COUNT(A:A)", "SELECT COUNT(A) FROM t"), ("=MAX(A:A)", "SELECT MAX(A) FROM t"),
    ("=MIN(A:A)", "SELECT MIN(A) FROM t"),
    ('=SUMIF(A:A,"x",B:B)', "SELECT SUM(B) FROM t WHERE A = 'x'"),
    ('=COUNTIF(A:A,"x")', "SELECT COUNT(*) FROM t WHERE A = 'x'"),
    ('=AVERAGEIF(A:A,"x",B:B)', "SELECT AVG(B) FROM t WHERE A = 'x'"),
    ('=SUMIFS(C:C,A:A,"x",B:B,"y")', "SELECT SUM(C) FROM t WHERE A = 'x' AND B = 'y'"),
    ("=UNIQUE(A:A)", "SELECT DISTINCT A FROM t"),
    ("=STDEV(A:A)", "SELECT STDDEV(A) FROM t"), ("=VAR(A:A)", "SELECT VARIANCE(A) FROM t"),
    ("=COUNTA(A:A)", "SELECT COUNT(A) FROM t"),
    ('=MAXIFS(C:C,A:A,"x")', "SELECT MAX(C) FROM t WHERE A = 'x'"),
    ('=MINIFS(C:C,A:A,"x")', "SELECT MIN(C) FROM t WHERE A = 'x'"),
    ('=COUNTIFS(A:A,"x",B:B,"y")', "SELECT COUNT(*) FROM t WHERE A = 'x' AND B = 'y'"),
    ('=AVERAGEIFS(C:C,A:A,"x",B:B,"y")', "SELECT AVG(C) FROM t WHERE A = 'x' AND B = 'y'"),
    ("=SUMPRODUCT(A:A,B:B)", "SELECT SUM(A*B) FROM t"),
    ("=ROUND(A1,2)", "ROUND(A, 2)"), ("=ABS(A1)", "ABS(A)"),
    ("=UPPER(A1)", "UPPER(A)"), ("=LOWER(A1)", "LOWER(A)"),
    ("=LEN(A1)", "LENGTH(A)"), ("=TRIM(A1)", "TRIM(A)"), ("=LEFT(A1,3)", "LEFT(A, 3)"),
    ("=A1&B1", "CONCAT(A, B)"),
    ('=IF(A1>10,"hi","lo")', "CASE WHEN A > 10 THEN 'hi' ELSE 'lo' END"),
    ("=IFERROR(A1,0)", "COALESCE(A, 0)"),
    ('=SUBSTITUTE(A1,"x","y")', "REPLACE(A, 'x', 'y')"),
    ("=COUNTA(UNIQUE(A:A))", "SELECT COUNT(DISTINCT A) FROM t"),
    ("=MEDIAN(A:A)", "SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY A) FROM t"),
]
DAX = [
    ("=SUM(A:A)", "SUM(t[A])"), ("=AVERAGE(A:A)", "AVERAGE(t[A])"),
    ("=COUNT(A:A)", "COUNT(t[A])"), ("=MAX(A:A)", "MAX(t[A])"), ("=MIN(A:A)", "MIN(t[A])"),
    ('=SUMIF(A:A,"x",B:B)', 'CALCULATE(SUM(t[B]), t[A]="x")'),
    ('=COUNTIF(A:A,"x")', 'CALCULATE(COUNTROWS(t), t[A]="x")'),
    ("=COUNTA(A:A)", "COUNTA(t[A])"), ("=ROWS(A:A)", "COUNTROWS(t)"),
    ("=COUNTA(UNIQUE(A:A))", "DISTINCTCOUNT(t[A])"),
    ("=MEDIAN(A:A)", "MEDIAN(t[A])"), ("=STDEV(A:A)", "STDEV.S(t[A])"), ("=VAR(A:A)", "VAR.S(t[A])"),
    ('=AVERAGEIF(A:A,"x",B:B)', 'CALCULATE(AVERAGE(t[B]), t[A]="x")'),
    ('=SUMIFS(C:C,A:A,"x",B:B,"y")', 'CALCULATE(SUM(t[C]), t[A]="x", t[B]="y")'),
    ('=MAXIFS(C:C,A:A,"x")', 'CALCULATE(MAX(t[C]), t[A]="x")'),
    ("=IFERROR(A1/B1,0)", "DIVIDE(t[A], t[B], 0)"),
    ('=IF(A1>10,"hi","lo")', 'IF(t[A]>10, "hi", "lo")'),
    ("=ROUND(A1,2)", "ROUND(t[A], 2)"),
    ("=A1&B1", "t[A] & t[B]"), ("=UPPER(A1)", "UPPER(t[A])"), ("=LEN(A1)", "LEN(t[A])"),
    ("=SUMPRODUCT(A:A,B:B)", "SUMX(t, t[A]*t[B])"),
]
JS = [
    ("=SUM(A:A)", "data.reduce((s,r)=>s+r.A,0)"), ("=AVERAGE(A:A)", "data.reduce((s,r)=>s+r.A,0)/data.length"),
    ("=COUNT(A:A)", "data.length"), ("=MAX(A:A)", "Math.max(...data.map(r=>r.A))"),
    ("=MIN(A:A)", "Math.min(...data.map(r=>r.A))"), ('=IF(A1>10,"hi","lo")', "a>10?'hi':'lo'"),
    ("=ROUND(A1,2)", "Math.round(a*100)/100"), ("=LEN(A1)", "a.length"), ("=UPPER(A1)", "a.toUpperCase()"),
    ("=LOWER(A1)", "a.toLowerCase()"), ("=TRIM(A1)", "a.trim()"),
    ("=LEFT(A1,3)", "a.slice(0,3)"), ("=RIGHT(A1,3)", "a.slice(-3)"), ("=MID(A1,2,3)", "a.slice(1,4)"),
    ('=SUBSTITUTE(A1,"x","y")', "a.replaceAll('x','y')"),
    ("=ABS(A1)", "Math.abs(a)"), ("=SQRT(A1)", "Math.sqrt(a)"), ("=POWER(A1,2)", "a**2"),
    ("=MOD(A1,3)", "a%3"), ("=INT(A1)", "Math.floor(a)"),
    ("=CONCAT(A1,B1)", "a + '' + b"),
    ('=SUMIF(A:A,"x",B:B)', "data.filter(r=>r.A==='x').reduce((s,r)=>s+r.B,0)"),
    ('=COUNTIF(A:A,"x")', "data.filter(r=>r.A==='x').length"),
    ("=UNIQUE(A:A)", "[...new Set(data.map(r=>r.A))]"),
    ('=FILTER(A:A,B:B="x")', "data.filter(r=>r.B==='x').map(r=>r.A)"),
    ("=IFERROR(A1/B1,0)", "b ? a/b : 0"),
    ('=TEXTJOIN(",",TRUE,A:A)', "data.map(r=>r.A).join(',')"),
]
R = [
    ("=SUM(A:A)", "sum(df$A)"), ("=AVERAGE(A:A)", "mean(df$A)"), ("=COUNT(A:A)", "length(df$A)"),
    ("=MAX(A:A)", "max(df$A)"), ("=MIN(A:A)", "min(df$A)"), ("=MEDIAN(A:A)", "median(df$A)"),
    ("=STDEV(A:A)", "sd(df$A)"), ('=SUMIF(A:A,"x",B:B)', "sum(df$B[df$A=='x'])"),
    ("=VAR(A:A)", "var(df$A)"), ("=COUNTA(A:A)", "sum(!is.na(df$A))"), ("=PRODUCT(A:A)", "prod(df$A)"),
    ('=COUNTIF(A:A,"x")', "sum(df$A=='x')"),
    ('=AVERAGEIF(A:A,"x",B:B)', "mean(df$B[df$A=='x'])"),
    ('=SUMIFS(C:C,A:A,"x",B:B,"y")', "sum(df$C[df$A=='x' & df$B=='y'])"),
    ("=ROUND(A1,2)", "round(a, 2)"), ("=ABS(A1)", "abs(a)"), ("=SQRT(A1)", "sqrt(a)"),
    ("=UPPER(A1)", "toupper(a)"), ("=LOWER(A1)", "tolower(a)"), ("=LEN(A1)", "nchar(a)"),
    ("=TRIM(A1)", "trimws(a)"), ("=MOD(A1,3)", "a %% 3"),
    ('=IF(A1>10,"hi","lo")', "ifelse(a>10,'hi','lo')"),
    ("=UNIQUE(A:A)", "unique(df$A)"), ("=COUNTA(UNIQUE(A:A))", "length(unique(df$A))"),
    ("=CORREL(A:A,B:B)", "cor(df$A, df$B)"),
]
M = [
    ("=SUM(A:A)", "List.Sum(Source[A])"), ("=AVERAGE(A:A)", "List.Average(Source[A])"),
    ("=COUNT(A:A)", "List.Count(Source[A])"), ("=MAX(A:A)", "List.Max(Source[A])"), ("=MIN(A:A)", "List.Min(Source[A])"),
    ("=MEDIAN(A:A)", "List.Median(Source[A])"), ("=STDEV(A:A)", "List.StandardDeviation(Source[A])"),
    ("=PRODUCT(A:A)", "List.Product(Source[A])"), ("=UNIQUE(A:A)", "List.Distinct(Source[A])"),
    ("=COUNTA(UNIQUE(A:A))", "List.Count(List.Distinct(Source[A]))"),
    ('=SUMIF(A:A,"x",B:B)', 'List.Sum(Table.SelectRows(Source, each [A]="x")[B])'),
    ('=COUNTIF(A:A,"x")', 'Table.RowCount(Table.SelectRows(Source, each [A]="x"))'),
    ('=AVERAGEIF(A:A,"x",B:B)', 'List.Average(Table.SelectRows(Source, each [A]="x")[B])'),
    ('=FILTER(A:A,B:B="x")', 'Table.SelectRows(Source, each [B]="x")[A]'),
    ("=ROUND(A1,2)", "Number.Round(a, 2)"), ("=ABS(A1)", "Number.Abs(a)"),
    ("=UPPER(A1)", "Text.Upper(a)"), ("=LOWER(A1)", "Text.Lower(a)"),
    ("=LEN(A1)", "Text.Length(a)"), ("=TRIM(A1)", "Text.Trim(a)"),
    ("=A1&B1", "a & b"), ('=IF(A1>10,"hi","lo")', 'if a > 10 then "hi" else "lo"'),
]
def gen_transpile():
    tgt = random.choice(["python", "python", "sql", "dax", "js", "r", "m"])
    src, out = random.choice({"python": TRANSPILE, "sql": SQL, "dax": DAX, "js": JS, "r": R, "m": M}[tgt])
    lang = {"python": "python", "sql": "sql", "dax": "dax", "js": "javascript", "r": "r", "m": "power query"}[tgt]
    return random.choice([f"in {lang}: {src}", f"convert to {lang}: {src}", f"{src} in {lang}"]), out

# ── optimize: make a formula better / simpler ──
OPTIMIZE = [
    ("=VLOOKUP(A1,B:C,2,FALSE)", "=XLOOKUP(A1,B:B,C:C)"),
    ('=IF(A1>9,"a",IF(A1>5,"b","c"))', '=IFS(A1>9,"a",A1>5,"b",TRUE,"c")'),
    ("=SUM(A1,A2,A3,A4,A5)", "=SUM(A1:A5)"),
    ("=A1*1", "=A1"), ('=A1&""&B1', "=A1&B1"), ('=A1&""', "=A1"),
    ("=IF(A1>0,TRUE,FALSE)", "=A1>0"),
    ("=A1/B1", "=IFERROR(A1/B1,0)"),
    ('=SUMIF(A:A,">0",A:A)', '=SUMIF(A:A,">0")'),
    ("=INDEX(B:B,MATCH(A1,C:C,0))", "=XLOOKUP(A1,C:C,B:B)"),
    ("=IF(A1>B1,A1,B1)", "=MAX(A1,B1)"),
    ("=IF(A1<B1,A1,B1)", "=MIN(A1,B1)"),
    ("=CONCATENATE(A1,B1)", "=A1&B1"),
    ("=NOT(A1=B1)", "=A1<>B1"),
    ("=A1+A1*0.1", "=A1*1.1"),
    ("=A1-A1*0.1", "=A1*0.9"),
    ("=SUM(A1:A10)/COUNT(A1:A10)", "=AVERAGE(A1:A10)"),
    ('=IF(ISNUMBER(SEARCH("x",A1)),TRUE,FALSE)', '=ISNUMBER(SEARCH("x",A1))'),
    ('=SUMPRODUCT((A:A="x")*B:B)', '=SUMIF(A:A,"x",B:B)'),
    ('=SUMPRODUCT(--(A:A="x"))', '=COUNTIF(A:A,"x")'),
    ('=LEFT(A1,FIND(" ",A1)-1)', '=TEXTBEFORE(A1," ")'),
    ('=MID(A1,FIND("@",A1)+1,LEN(A1))', '=TEXTAFTER(A1,"@")'),
    ('=IFERROR(VLOOKUP(A1,B:C,2,FALSE),"")', '=IFNA(XLOOKUP(A1,B:B,C:C),"")'),
    ("=IF(A1=TRUE,1,0)", "=IF(A1,1,0)"),
    ("=A1*100&\"%\"", '=TEXT(A1,"0%")'),
    ("=ROUND(A1,0)+0", "=ROUND(A1,0)"),
    ("=AND(A1>0,A1>0)", "=A1>0"),
    ("=A1+0", "=A1"), ("=A1*1.0", "=A1"),
    ('=SUMIFS(C:C,A:A,"x")', '=SUMIF(A:A,"x",C:C)'),
    ('=AVERAGEIFS(C:C,A:A,"x")', '=AVERAGEIF(A:A,"x",C:C)'),
    ("=A1-(-B1)", "=A1+B1"), ("=A1*-1", "=-A1"),
    ("=SUM(A1:A1)", "=A1"), ("=PRODUCT(A1,B1)", "=A1*B1"),
    ("=POWER(A1,2)", "=A1^2"), ("=CONCAT(A1,B1)", "=A1&B1"),
    ('=DATEDIF(A1,B1,"d")', "=B1-A1"),
    ("=IF(A1<>0,B1/A1,0)", "=IFERROR(B1/A1,0)"),
    ("=IF(A1>=B1,A1,B1)", "=MAX(A1,B1)"),
    ("=A1^0.5", "=SQRT(A1)"), ("=A1^(1/2)", "=SQRT(A1)"),
    ('=A1&""&B1&""&C1', "=A1&B1&C1"),
    ("=IF(A1>0,A1*2,A1*2)", "=A1*2"),
    ("=-(-A1)", "=A1"),
    ("=NOT(A1<B1)", "=A1>=B1"), ("=NOT(A1>B1)", "=A1<=B1"),
    ('=SUMPRODUCT(1*(A:A="x"))', '=COUNTIF(A:A,"x")'),
    ("=MROUND(A1,1)", "=ROUND(A1,0)"),
    ('=TRIM(A1)&""', "=TRIM(A1)"),
]
def gen_optimize():
    bad, good = random.choice(OPTIMIZE)
    return random.choice([f"optimize {bad}", f"simplify {bad}", f"improve {bad}",
                          f"make {bad} better", f"shorten {bad}", f"clean up {bad}",
                          f"is there a better way to write {bad}"]), good

# ── audit: flag issues / best-practice problems in a formula ──
AUDIT = [
    ("=A1*1.08", "hardcoded tax rate 1.08 — put it in a cell and reference it"),
    ("=A1*0.15", "hardcoded rate 0.15 — use a cell reference instead"),
    ("=SUM(OFFSET(A1,0,0,10,1))", "OFFSET is volatile and recalculates constantly — use a fixed range"),
    ("=A1/B1", "no error handling — wrap in IFERROR in case B1 is zero or blank"),
    ("=VLOOKUP(A1,B:Z,5,TRUE)", "approximate match (TRUE) can return wrong values — use FALSE for exact match"),
    ("=SUM(A:A)+5", "hardcoded +5 added to the total — reference a cell instead"),
    ("=A1+A2+A3+A4+A5", "long manual addition — use SUM(A1:A5) instead"),
    ("=TODAY()", "TODAY() is volatile and changes every day — if you need a fixed date, paste it as a value"),
    ("=NOW()", "NOW() is volatile and updates on every edit — press Ctrl+; for a static timestamp"),
    ("=RAND()", "RAND() reshuffles on every change — copy and paste-special as values to lock the numbers"),
    ("=INDIRECT(A1)", "INDIRECT is volatile and breaks if a sheet is renamed — use a direct reference if you can"),
    ("=VLOOKUP(A1,B:C,2)", "missing the 4th argument, so it defaults to approximate match — add FALSE for an exact match"),
    ("=SUM(A:A)", "summing the whole column is slow on large files — limit it to the actual data range"),
    ("=IFERROR(VLOOKUP(A1,B:C,2,FALSE),0)", "IFERROR hides every error including typos — use IFNA so only 'not found' is caught"),
    ("=A1=B1", "comparing decimals directly can fail from rounding — wrap both sides in ROUND first"),
    ("=LEFT(A1,5)", "this assumes A1 has at least 5 characters — short text will be silently truncated"),
    ("=A1*A2*A3*A4*A5", "long manual multiplication — use PRODUCT(A1:A5) instead"),
    ("=A1&B1&C1&D1&E1", "many joins chained with & — TEXTJOIN is cleaner and lets you set a delimiter"),
    ("=VLOOKUP(A1,B:F,5,FALSE)", "the column index 5 breaks if columns are inserted — XLOOKUP or INDEX/MATCH is safer"),
    ("=A1>DATE(2024,1,1)", "hardcoded cutoff date — put the date in a cell and reference it"),
    ('="$"&A1', "building currency as text loses the numeric value — use a currency number format instead"),
    ("=SUMIF(A1:A50,B1,C1:C40)", "the criteria range and sum range are different sizes — they should line up"),
    ("=SUM(1:1)", "summing an entire row scans every column and is slow — use a bounded range"),
    ("=IFERROR(IFERROR(A1,B1),C1)", "nested IFERROR is hard to follow — restructure it or use a single IFS"),
    ("=OFFSET(A1,B1,0)", "OFFSET is volatile and recalculates constantly — INDEX is a non-volatile alternative"),
    ("=SUMPRODUCT(A:A,B:B)", "SUMPRODUCT over whole columns scans about a million rows — bound the ranges to your data"),
    ("=A1=TRUE", "comparing to TRUE is redundant — just use A1 on its own"),
    ("=ROUND(A1,2)+ROUND(B1,2)", "rounding each piece can drift from the real total — round the final result instead"),
    ("=A1/B1*100", "no guard for B1 being zero — wrap it in IFERROR or test B1 first"),
    ("=VLOOKUP(A1,B:F,5,FALSE)&VLOOKUP(A1,B:G,6,FALSE)", "the same row is looked up twice — do it once with LET or a helper column"),
    ("=A1+A2", "if these are merged cells only the top-left holds a value — merged cells break formulas and sorting"),
    ("=SUM(A1:A100)", "the range stops at row 100 — new data below is silently excluded; use a Table or A:A"),
    ("=VLOOKUP(A1,C:E,3,FALSE)", "VLOOKUP can't return columns left of the key — XLOOKUP or INDEX/MATCH is more flexible"),
    ('=IF(A1>0,"yes")', "IF has no value_if_false, so it returns FALSE on failure — add the else value"),
    ("=A1&B1", "joining numbers with & makes text you can't sum — keep them numeric or use a helper column"),
    ('=COUNTIF(A:A,"*text*")', "wildcards in COUNTIF only match text — numbers stored as numbers won't be found"),
    ("=SUMIF(A:A,B1)", "two-arg SUMIF sums the criteria range itself — add a sum range if you meant another column"),
    ('=A1=""', 'this is TRUE for empty cells AND formulas returning "" — use ISBLANK for truly empty'),
    ("=VLOOKUP(A1,External!B:C,2,0)", "a link to another workbook breaks when the file moves — paste as values or keep the source open"),
    ("=RANK(A1,A:A)", "RANK is legacy — use RANK.EQ or RANK.AVG and decide how ties are handled"),
    ('=IF(A1=1,"a",IF(A1=2,"b",IF(A1=3,"c",IF(A1=4,"d","e"))))', "deeply nested IFs are hard to maintain — use IFS, SWITCH, or a lookup table"),
    ('=IFERROR(A1,"")', "a blanket IFERROR hides real problems — only catch the specific error you expect"),
    ("=$A$1+B1", "one absolute and one relative ref — fine, but check that's intended before you fill it"),
    ('=DATEDIF(A1,B1,"m")', "DATEDIF is undocumented and buggy for some month/day combos — verify the edge cases"),
]
def gen_audit():
    f, issue = random.choice(AUDIT)
    return random.choice([f"audit {f}", f"review {f}", f"any issues with {f}", f"critique {f}",
                          f"what's wrong with the design of {f}", f"is {f} good practice"]), issue

# ── reverse transpile: Python/pandas -> Excel formula ──
def gen_reverse():
    f, py = random.choice(TRANSPILE)
    return random.choice([f"excel formula for: {py}", f"convert {py} to a formula", f"{py} as an excel formula"]), f

# ── natural language -> SQL ──
NLSQL = [
    ("total sales by region", "SELECT region, SUM(sales) FROM t GROUP BY region"),
    ("count customers by status", "SELECT status, COUNT(*) FROM t GROUP BY status"),
    ("average price per category", "SELECT category, AVG(price) FROM t GROUP BY category"),
    ("top 10 customers by revenue", "SELECT customer, SUM(revenue) AS r FROM t GROUP BY customer ORDER BY r DESC LIMIT 10"),
    ("total revenue where region is west", "SELECT SUM(revenue) FROM t WHERE region = 'west'"),
    ("number of paid orders", "SELECT COUNT(*) FROM t WHERE status = 'paid'"),
    ("sum of amount for each month", "SELECT month, SUM(amount) FROM t GROUP BY month"),
    ("list distinct products", "SELECT DISTINCT product FROM t"),
    ("max revenue by salesperson", "SELECT salesperson, MAX(revenue) FROM t GROUP BY salesperson"),
    ("average order value", "SELECT AVG(amount) FROM t"),
    ("total quantity sold", "SELECT SUM(quantity) FROM t"),
    ("how many distinct customers", "SELECT COUNT(DISTINCT customer) FROM t"),
    ("all orders over 1000", "SELECT * FROM t WHERE amount > 1000"),
    ("orders between 100 and 500", "SELECT * FROM t WHERE amount BETWEEN 100 AND 500"),
    ("all customers in the west region", "SELECT * FROM t WHERE region = 'west'"),
    ("average revenue per region", "SELECT region, AVG(revenue) FROM t GROUP BY region"),
    ("revenue by month in order", "SELECT month, SUM(revenue) AS r FROM t GROUP BY month ORDER BY month"),
    ("customers with more than 5 orders", "SELECT customer FROM t GROUP BY customer HAVING COUNT(*) > 5"),
    ("find duplicate emails", "SELECT email FROM t GROUP BY email HAVING COUNT(*) > 1"),
    ("bottom 5 products by sales", "SELECT product, SUM(sales) AS s FROM t GROUP BY product ORDER BY s ASC LIMIT 5"),
    ("the highest paid employee", "SELECT name FROM t ORDER BY salary DESC LIMIT 1"),
    ("second highest salary", "SELECT MAX(salary) FROM t WHERE salary < (SELECT MAX(salary) FROM t)"),
    ("running total of revenue by month", "SELECT month, SUM(revenue) OVER (ORDER BY month) FROM t"),
    ("rank customers by revenue", "SELECT customer, RANK() OVER (ORDER BY SUM(revenue) DESC) AS rnk FROM t GROUP BY customer"),
]
def gen_nlsql():
    q, sql = random.choice(NLSQL)
    return random.choice([f"sql for: {q}", f"write sql to get {q}", f"query for {q}"]), sql

# ── debug: formula + the error it throws -> diagnosis & fix ──
DEBUG = [
    ("=A1/B1", "#DIV/0!", "B1 is zero or blank — wrap it: =IFERROR(A1/B1,0)"),
    ("=VLOOKUP(A1,B:C,2,FALSE)", "#N/A", "A1 isn't found in column B — check the value or wrap in IFNA"),
    ("=SUM(A1:A10 B1:B10)", "#NULL!", "missing comma between ranges: =SUM(A1:A10,B1:B10)"),
    ("=A1+Cc", "#NAME?", "Cc isn't a valid cell or name — did you mean a real cell?"),
    ("=B1*#REF!", "#REF!", "the formula points at a deleted cell — rebuild the reference"),
    ("=DATE(2024,13,1)", "#NUM!", "month 13 is invalid — months are 1 to 12"),
    ('=FILTER(A:A,B:B="x")', "#CALC!", 'FILTER found no matching rows — add a fallback: =FILTER(A:A,B:B="x","none")'),
    ("=SORT(A1:A10)", "#SPILL!", "something is blocking the spill range — clear the cells below the formula"),
    ('=A1*"x"', "#VALUE!", "you're doing math on text — make sure the inputs are numbers"),
    ("=XLOOKUP(A1,B:B,C:C)", "#N/A", 'A1 isn\'t in column B — add a not-found value: =XLOOKUP(A1,B:B,C:C,"missing")'),
    ("=SUM(A1:A10)", "0", "the numbers are stored as text — convert them with VALUE or multiply by 1"),
    ("=A1", "circular", "the cell refers back to itself — point it at a different cell"),
    ("=DATE(2024,1,32)", "#NUM!", "day 32 doesn't exist — days run 1 to 31"),
    ("=SQRT(-4)", "#NUM!", "you can't square-root a negative — check or ABS the input"),
    ("=VLOOKUP(A1,B:C,5,FALSE)", "#REF!", "column 5 is outside the B:C table — the index is too big"),
    ("=IF(A1>10)", "error", "IF is missing its value_if_true — add the result arguments"),
    ("=Sheet3!A1", "#REF!", "Sheet3 was deleted or renamed — fix the sheet reference"),
    ("=A1+B1", "date", "the result is showing as a date — set the cell format back to General or Number"),
    ("=AVERAGE(A1:A10)", "#DIV/0!", "the range has no numbers to average — the cells are blank or text"),
    ("=COUNTIF(A:A,B1)", "0", "B1 has trailing spaces so nothing matches — wrap it in TRIM"),
    ("=A1:A10*2", "#VALUE!", "a legacy array formula needs Ctrl+Shift+Enter, or use a spill-aware version"),
    ("=A1", "#GETTING_DATA", "an external or data-model query is still loading — wait for it to finish"),
    ("=A1.Price", "#FIELD!", "that field doesn't exist on the linked data type — choose a valid field"),
    ("=VLOOKUP(A1,B:C,2,TRUE)", "wrong value", "approximate match needs column B sorted ascending — sort it, or use FALSE"),
    ("=A1=B1", "FALSE", "they look equal but one has trailing spaces or is text vs a number — TRIM and match the types"),
    ('=IFS(A1>10,"big")', "#N/A", "no IFS condition matched — add TRUE as a final catch-all"),
    ("='Sales Data'!A1", "#REF!", "the sheet was renamed or deleted — fix the sheet name (spaces need single quotes)"),
    ('=SUMIF(A:A,">1/1/2024",B:B)', "0", 'a date inside text criteria won\'t compare — use ">"&DATE(2024,1,1)'),
    ("=XLOOKUP(A1,B:B,C:D)", "#VALUE!", "the return array is two columns wide — point it at a single column"),
    ("=VLOOKUP(123,A:B,2,FALSE)", "#N/A", "the key is a number but the column stores it as text (or vice versa) — match the data types"),
    ("=INDEX(A:A,B1)", "#REF!", "B1 is bigger than the number of rows — the index is out of range"),
    ("=A1*B1", "#####", "that's not an error — the column is too narrow to show the number; just widen it"),
    ("=A1=A2", "FALSE", "floating-point math means 0.1+0.2 isn't exactly 0.3 — compare with ROUND or a small tolerance"),
    ("=A1&B1", "wrong", "& always returns text — if you meant to add the numbers, use + or SUM"),
]
def gen_debug():
    f, err, fix = random.choice(DEBUG)
    return random.choice([f"{f} returns {err}, why?", f"why does {f} give {err}", f"{f} shows {err}, fix it",
                          f"{f} is throwing {err}", f"help, {f} = {err}"]), fix

# ── convert references: relative <-> absolute ──
def gen_absref():
    cs = [f"{col()}{random.randint(1,50)}" for _ in range(2)]; op = random.choice(["+","-","*","/"])
    rel = "=" + op.join(cs); absf = "=" + op.join(f"${c[0]}${c[1:]}" for c in cs)
    if random.random() < 0.5:
        return random.choice([f"make {rel} use absolute references", f"lock the references in {rel}"]), absf
    return random.choice([f"make {absf} relative", f"unlock the references in {absf}"]), rel

# ── document: formula -> a plain-English note/comment ──
def gen_doc():
    fn = random.choice(G); d, f = fn()
    return random.choice([f"document {f}", f"write a comment for {f}", f"describe {f} for a note"]), d

# ── modernize: replace legacy functions with their Excel-365 equivalents ──
MODERNIZE = [
    ("=VLOOKUP(A2,B:F,5,FALSE)", "=XLOOKUP(A2,B:B,F:F)"),
    ("=VLOOKUP(A2,B:F,5,0)", "=XLOOKUP(A2,B:B,F:F)"),
    ("=HLOOKUP(A2,B1:Z2,2,FALSE)", "=XLOOKUP(A2,B1:Z1,B2:Z2)"),
    ("=INDEX(F:F,MATCH(A2,B:B,0))", "=XLOOKUP(A2,B:B,F:F)"),
    ('=IF(A2>90,"A",IF(A2>80,"B",IF(A2>70,"C","F")))', '=IFS(A2>90,"A",A2>80,"B",A2>70,"C",TRUE,"F")'),
    ('=IF(A2=1,"one",IF(A2=2,"two","other"))', '=SWITCH(A2,1,"one",2,"two","other")'),
    ('=CONCATENATE(A2," ",B2)', '=TEXTJOIN(" ",TRUE,A2,B2)'),
    ('=A2&" "&B2&" "&C2', '=TEXTJOIN(" ",TRUE,A2,B2,C2)'),
    ('=IFERROR(VLOOKUP(A2,B:F,5,FALSE),"")', '=IFNA(XLOOKUP(A2,B:B,F:F),"")'),
    ('=IF(ISNA(VLOOKUP(A2,B:F,5,FALSE)),"",VLOOKUP(A2,B:F,5,FALSE))', '=IFNA(XLOOKUP(A2,B:B,F:F),"")'),
    ('=LEFT(A2,FIND(" ",A2)-1)', '=TEXTBEFORE(A2," ")'),
    ('=MID(A2,FIND("@",A2)+1,LEN(A2))', '=TEXTAFTER(A2,"@")'),
    ('=SUMPRODUCT((A:A="x")*B:B)', '=SUMIF(A:A,"x",B:B)'),
    ("=TRANSPOSE(A1:A5)", "=TOROW(A1:A5)"),
    ('=IF(COUNTIF(B:B,A2)>0,"yes","no")', '=IF(ISNUMBER(XMATCH(A2,B:B)),"yes","no")'),
    ("=SMALL(A:A,1)", "=MIN(A:A)"),
    ("=LARGE(A:A,1)", "=MAX(A:A)"),
    ('=SUM(IF(A:A="x",B:B))', '=SUMIF(A:A,"x",B:B)'),
    ('=SUMPRODUCT((A:A=E1)*(B:B=F1)*C:C)', '=SUMIFS(C:C,A:A,E1,B:B,F1)'),
    ('=RIGHT(A2,LEN(A2)-FIND("@",A2))', '=TEXTAFTER(A2,"@")'),
    ('=MID(A2,1,FIND(" ",A2)-1)', '=TEXTBEFORE(A2," ")'),
    ('=A2&", "&B2&", "&C2', '=TEXTJOIN(", ",TRUE,A2:C2)'),
    ('=IF(ISERROR(A2),"",A2)', '=IFERROR(A2,"")'),
    ('=IF(ISNA(A2),0,A2)', '=IFNA(A2,0)'),
    ("=A2*B2-A2*C2", "=LET(x,A2,x*B2-x*C2)"),
    ('=INDEX(B:B,MATCH(1,(C:C="x")*(D:D="y"),0))', '=XLOOKUP(1,(C:C="x")*(D:D="y"),B:B)'),
    ('=SUMPRODUCT(--(A:A>0))', '=COUNTIF(A:A,">0")'),
    ('=CONCATENATE(A2,B2,C2)', '=TEXTJOIN("",TRUE,A2:C2)'),
]
def gen_modernize():
    old, new = random.choice(MODERNIZE)
    return random.choice([f"modernize {old}", f"update {old} to new functions",
                          f"use modern functions for {old}", f"rewrite {old} the new way",
                          f"convert {old} to dynamic functions"]), new

# ── add error handling: wrap any formula in IFERROR / IFNA ──
def gen_adderror():
    fn = random.choice(G); d, f = fn()
    val, label = random.choice([("0", "0"), ('""', "blank"), ('"N/A"', "N/A"), ('"-"', "a dash")])
    is_lookup = any(x in f for x in ("VLOOKUP", "XLOOKUP", "HLOOKUP", "MATCH", "INDEX"))
    wrap = "IFNA" if (is_lookup and random.random() < 0.6) else "IFERROR"
    out = f"={wrap}({f[1:]},{val})"
    return random.choice([f"add error handling to {f}", f"wrap {f} so errors show {label}",
                          f"handle errors in {f}", f"make {f} return {label} on error",
                          f"catch errors in {f}"]), out

# ── strip error handling: unwrap IFERROR / IFNA to expose the real result ──
def gen_striperror():
    fn = random.choice(G); d, f = fn()
    val = random.choice(["0", '""', '"N/A"', '"-"'])
    wrap = random.choice(["IFERROR", "IFNA"])
    wrapped = f"={wrap}({f[1:]},{val})"
    return random.choice([f"remove the error handling from {wrapped}", f"strip the {wrap} from {wrapped}",
                          f"show the real error in {wrapped}", f"unwrap {wrapped}"]), f

# ── directional anchoring: set the right mixed $ refs for filling across / down ──
def gen_reflock():
    c = col(); r = random.randint(1, 40)
    d1, d2, out = random.choice([
        ("when you drag it right",  "lock the column",        f"${c}{r}"),   # $A1
        ("when you drag it down",   "lock the row",           f"{c}${r}"),   # A$1
        ("when you copy it anywhere","keep both fixed",        f"${c}${r}"),  # $A$1
    ])
    return random.choice([f"{d2} for {c}{r}", f"anchor {c}{r} so it stays put {d1}",
                          f"keep {c}{r} from moving {d1}"]), "=" + out

# ── A1 <-> R1C1 notation (absolute refs, unambiguous) ──
def _col_num(s):
    n = 0
    for ch in s: n = n * 26 + (ord(ch) - 64)
    return n
def gen_r1c1():
    c = col(); r = random.randint(1, 30); a1 = f"${c}${r}"; r1c1 = f"R{r}C{_col_num(c)}"
    if random.random() < 0.5:
        return random.choice([f"convert {a1} to R1C1", f"what is {a1} in R1C1 notation",
                              f"{a1} in R1C1"]), r1c1
    return random.choice([f"convert {r1c1} to A1 notation", f"what cell is {r1c1}",
                          f"{r1c1} in A1"]), a1

# ── locale: swap , <-> ; argument separators (quote-free formulas only, so it's exact) ──
def gen_locale():
    f = "=SUM(A1,B1,C1)"
    for _ in range(20):
        fn = random.choice(G); _, cand = fn()
        if '"' not in cand and "," in cand: f = cand; break
    if random.random() < 0.5:
        return random.choice([f"convert {f} to European format", f"use semicolons in {f}",
                              f"{f} with semicolon separators"]), f.replace(",", ";")
    eu = f.replace(",", ";")
    return random.choice([f"convert {eu} to US format", f"use commas in {eu}",
                          f"{eu} with comma separators"]), f

# ── dynamic range: turn a fixed range into a whole-column reference ──
def gen_dynamic():
    c = col(); a = random.randint(2, 5); b = random.choice([50, 100, 200, 500, 1000])
    fn = random.choice(["SUM", "AVERAGE", "COUNT", "MAX", "MIN", "COUNTA"])
    fixed = f"={fn}({c}{a}:{c}{b})"
    return random.choice([f"make {fixed} cover the whole column", f"convert {fixed} to a full-column reference",
                          f"make {fixed} include new rows automatically", f"make {fixed} dynamic"]), f"={fn}({c}:{c})"

# ── evaluate step by step: walk a nested formula inner-to-outer (like Excel's Evaluate Formula) ──
EVALUATE = [
    ("=ROUND(AVERAGE(A1:A10),2)", "1) AVERAGE(A1:A10) gets the mean of the range. 2) ROUND(...,2) rounds that to 2 decimals."),
    ('=IF(SUM(B:B)>1000,"high","low")', '1) SUM(B:B) totals column B. 2) check if that is over 1000. 3) return "high" if true, else "low".'),
    ("=VLOOKUP(A2,D:F,3,FALSE)", "1) take the value in A2. 2) find it in column D. 3) return the value 3 columns across (F) on that row."),
    ('=IFERROR(A1/B1,0)', "1) compute A1/B1. 2) if that errors (B1 is 0 or blank), return 0 instead."),
    ("=SUMIF(A:A,\"west\",C:C)", '1) look down column A for cells equal to "west". 2) add up the matching cells in column C.'),
    ("=LEFT(A1,FIND(\" \",A1)-1)", '1) FIND(" ",A1) gets the position of the first space. 2) LEFT takes that many minus one characters, giving the first word.'),
    ("=INDEX(F:F,MATCH(A2,B:B,0))", "1) MATCH(A2,B:B,0) finds which row A2 sits on in column B. 2) INDEX returns the value on that row of column F."),
    ('=TEXTJOIN(", ",TRUE,A1:A5)', '1) take the values A1:A5. 2) drop the blanks (TRUE). 3) glue them together separated by a comma and space.'),
    ('=IFERROR(VLOOKUP(A2,D:F,3,FALSE),"not found")', '1) look up A2 in column D. 2) return column F on that row. 3) if it errors, show "not found" instead.'),
    ('=SUMIFS(D:D,A:A,"west",B:B,"paid")', '1) find rows where column A is "west" and column B is "paid". 2) add up column D for just those rows.'),
    ("=ROUND(B2*(1+C2),2)", "1) 1+C2 turns the rate into a multiplier. 2) B2 times that applies the increase. 3) ROUND trims it to 2 decimals."),
    ('=IF(AND(A2>0,B2>0),"ok","check")', '1) test A2>0 and B2>0. 2) AND is true only if both are. 3) return "ok" if both pass, else "check".'),
    ('=LEFT(A2,2)&"-"&RIGHT(A2,4)', '1) LEFT grabs the first 2 characters. 2) RIGHT grabs the last 4. 3) join them with a dash between.'),
    ("=XLOOKUP(MAX(B:B),B:B,A:A)", "1) MAX(B:B) finds the largest value in column B. 2) XLOOKUP finds that value in B. 3) return the matching name from column A."),
    ("=A2/SUM(A:A)", "1) SUM(A:A) totals the whole column. 2) divide A2 by that total to get its share (format it as % to read it as a percentage)."),
    ("=EOMONTH(A2,0)", "1) take the date in A2. 2) EOMONTH with 0 returns the last day of that same month."),
    ('=IFS(A2>=90,"A",A2>=80,"B",TRUE,"C")', '1) check A2>=90 first, that gives "A". 2) else check A2>=80, that gives "B". 3) TRUE is the catch-all, gives "C".'),
    ('=SUMPRODUCT((A:A="x")*B:B)', '1) (A:A="x") makes a column of TRUE/FALSE. 2) times B:B turns TRUE into the B value and FALSE into 0. 3) SUMPRODUCT adds them up.'),
    ('=TEXT(A2,"0.0%")', "1) take the number in A2. 2) TEXT formats it as a percent with one decimal, returning text."),
]
def gen_evaluate():
    f, steps = random.choice(EVALUATE)
    return random.choice([f"evaluate {f} step by step", f"walk through {f}", f"break down how {f} works",
                          f"trace {f}"]), steps

# ── solve: rearrange to find the unknown ──
SOLVE = [
    ("what revenue gives {p} profit when cost is {c}", "={p}+{c}"),
    ("what price gives {m} margin on cost {c}", "={c}/(1-{m})"),
    ("what quantity at price {p} reaches {t} in revenue", "={t}/{p}"),
    ("what cost leaves {p} profit from revenue {t}", "={t}-{p}"),
    ("what selling price gives {m} markup on cost {c}", "={c}*(1+{m})"),
    ("what was the original price if {p} is after a {m} discount", "={p}/(1-{m})"),
    ("what pre-tax amount gives {t} after {m} tax", "={t}/(1+{m})"),
    ("how many units at {p} each to reach {t} in sales", "={t}/{p}"),
    ("how many hours at {p} per hour to earn {t}", "={t}/{p}"),
    ("what sales at a {m} commission rate yield {t} in commission", "={t}/{m}"),
    ("what profit on a {c} investment gives a {m} return", "={c}*{m}"),
    ("what value gives {m} growth over {c}", "={c}*(1+{m})"),
    ("what units cover {c} fixed costs at {m} contribution each", "={c}/{m}"),
    ("how much can I spend to keep {p} of a {t} budget", "={t}-{p}"),
    ("what cost gives {m} margin at price {p}", "={p}*(1-{m})"),
    ("what revenue covers {c} costs plus {p} target profit", "={c}+{p}"),
    ("what monthly payment on a {p} loan at {m} monthly rate over {t} months", "=PMT({m},{t},-{p})"),
    ("what annual growth rate from {c} to {t} over {p} years", "=({t}/{c})^(1/{p})-1"),
    ("what value is needed to reach an average of {t} across {p} items totaling {c}", "={t}*{p}-{c}"),
    ("what {c} grows to at {m} per period over {t} periods", "={c}*(1+{m})^{t}"),
]
def gen_solve():
    tpl, ans = random.choice(SOLVE)
    v = {k: cell() for k in ["p", "c", "m", "t"]}
    return tpl.format(**v), ans.format(**v)

# ── from examples (Flash-Fill): infer the transform ──
FROMEX = [
    ("hello -> HELLO, world -> WORLD", "=UPPER(A1)"), ("HELLO -> hello", "=LOWER(A1)"),
    ("john smith -> John Smith", "=PROPER(A1)"), ("  hi  -> hi", "=TRIM(A1)"),
    ("john@x.com -> x.com", '=TEXTAFTER(A1,"@")'), ("2024-01-15 -> 2024", "=YEAR(A1)"),
    ("hello -> 5", "=LEN(A1)"), ("first last -> first", '=TEXTBEFORE(A1," ")'),
    ("first.last@x.com -> first.last", '=TEXTBEFORE(A1,"@")'),
    ("first last -> last", '=TEXTAFTER(A1," ")'),
    ("2024-01-15 -> January", '=TEXT(A1,"mmmm")'),
    ("2024-01-15 -> 15", "=DAY(A1)"), ("2024-01-15 -> 1", "=MONTH(A1)"),
    ("0.25 -> 25%", '=TEXT(A1,"0%")'),
    ("1234.5 -> 1,234.50", '=TEXT(A1,"#,##0.00")'),
    ("hello -> h", "=LEFT(A1,1)"), ("hello -> o", "=RIGHT(A1,1)"),
    ("SKU-12345 -> 12345", '=TEXTAFTER(A1,"-")'),
    ("john -> john@company.com", '=A1&"@company.com"'),
    ("5 -> 5.00", '=TEXT(A1,"0.00")'),
    ("cat -> cats", '=A1&"s"'),
    ("TRUE -> Yes, FALSE -> No", '=IF(A1,"Yes","No")'),
    ("John Smith -> J.S.", '=LEFT(A1,1)&"."&MID(A1,FIND(" ",A1)+1,1)&"."'),
    ("John Smith -> Smith, John", '=MID(A1,FIND(" ",A1)+1,LEN(A1))&", "&LEFT(A1,FIND(" ",A1)-1)'),
    ("john smith jones -> jones", '=TEXTAFTER(A1," ",-1)'),
    ("2024-01-15 -> Q1", '="Q"&ROUNDUP(MONTH(A1)/3,0)'),
    ("5 -> 005", '=TEXT(A1,"000")'),
    ("1234567 -> 1,234,567", '=TEXT(A1,"#,##0")'),
    ("$1234 -> 1234", '=VALUE(SUBSTITUTE(A1,"$",""))'),
    ("john_smith -> john smith", '=SUBSTITUTE(A1,"_"," ")'),
]
def gen_fromex():
    ex, f = random.choice(FROMEX)
    return random.choice([f"examples: {ex}", f"fill the pattern: {ex}", f"infer the formula: {ex}"]), f

# ── rules table -> nested formula (commission tiers, grade bands, mappings, approvals) ──
def _rule_text2():
    c=cell(); w1,w2=random.sample(WORDS,2); a,b=random.choice([(0.1,0.05),(0.2,0.1),(0.15,0.08)])
    return f"on {c}: {w1} gives {a}, {w2} gives {b}, otherwise 0", f'=IFS({c}="{w1}",{a},{c}="{w2}",{b},TRUE,0)'
def _rule_text3():
    c=cell(); w1,w2,w3=random.sample(WORDS,3)
    return f"map {c}: {w1} to 0.2, {w2} to 0.1, {w3} to 0.05, else 0", f'=IFS({c}="{w1}",0.2,{c}="{w2}",0.1,{c}="{w3}",0.05,TRUE,0)'
def _rule_tiers():
    c=cell(); a,b=random.choice([(1000,500),(100,50),(10000,5000)])
    return f"{c}: over {a} gives 0.1, over {b} gives 0.05, else 0", f'=IFS({c}>{a},0.1,{c}>{b},0.05,TRUE,0)'
def _rule_grade():
    c=cell(); return f"grade {c}: 90+ is A, 80+ is B, 70+ is C, else F", f'=IFS({c}>=90,"A",{c}>=80,"B",{c}>=70,"C",TRUE,"F")'
def _rule_switch():
    c=cell(); k1,k2,k3=random.sample(WORDS,3); return f"switch on {c}: {k1}=1, {k2}=2, {k3}=3", f'=SWITCH({c},"{k1}",1,"{k2}",2,"{k3}",3)'
def _rule_approve():
    c=cell(); t=num(); return f"flag {c}: over {t} needs review, otherwise ok", f'=IF({c}>{t},"review","ok")'
def _rule_shipping():
    c=cell(); return f"shipping for weight {c}: under 1 is 5, under 5 is 10, else 20", f'=IFS({c}<1,5,{c}<5,10,TRUE,20)'
def _rule_lookup():
    c=cell(); t=col(); t2=chr(ord(t)+1); return f"look up the rate for {c} in the {t}:{t2} rate table", f"=VLOOKUP({c},{t}:{t2},2,FALSE)"
def _rule_overdue():
    c=cell(); return f"mark {c} overdue if its due date is before today", f'=IF({c}<TODAY(),"overdue","ok")'
def _rule_multi():
    c1=cell(); c2=cell(); t=num(); return f'approve if {c1} is over {t} and {c2} is yes', f'=IF(AND({c1}>{t},{c2}="yes"),"approve","deny")'
RULES_GEN = [_rule_text2, _rule_text3, _rule_tiers, _rule_grade, _rule_switch, _rule_approve, _rule_shipping,
             _rule_lookup, _rule_overdue, _rule_multi]
def gen_rules():
    return random.choice(RULES_GEN)()

# ── how-to Q&A: Excel UI instructions ──
HOWTO = [
    ("freeze the top row", "View -> Freeze Panes -> Freeze Top Row"),
    ("remove duplicates", "Data -> Remove Duplicates"),
    ("add a filter", "Data -> Filter (or Ctrl+Shift+L)"),
    ("make a dropdown", "Data -> Data Validation -> List"),
    ("wrap text", "Home -> Wrap Text"),
    ("insert a pivot table", "Insert -> PivotTable"),
    ("merge cells", "Home -> Merge & Center"),
    ("freeze the first column", "View -> Freeze Panes -> Freeze First Column"),
    ("find all the errors", "Home -> Find & Select -> Go To Special -> Formulas -> Errors"),
    ("check for circular references", "Formulas -> Error Checking -> Circular References"),
    ("trace a formula's precedents", "Formulas -> Trace Precedents"),
    ("see what a cell feeds into", "Formulas -> Trace Dependents"),
    ("protect a sheet", "Review -> Protect Sheet"),
    ("compare two workbooks", "Inquire add-in -> Compare Files"),
    ("add conditional formatting", "Home -> Conditional Formatting"),
    ("create a named range", "Formulas -> Define Name (or type it in the Name Box)"),
    ("split text into columns", "Data -> Text to Columns"),
    ("use flash fill", "Data -> Flash Fill (or Ctrl+E)"),
    ("group rows together", "select the rows -> Data -> Group"),
    ("add subtotals", "Data -> Subtotal"),
    ("record a macro", "View -> Macros -> Record Macro"),
    ("open the VBA editor", "press Alt+F11"),
    ("insert a slicer", "select a table or pivot -> Insert -> Slicer"),
    ("sort by cell color", "Data -> Sort -> Sort On: Cell Color"),
    ("show formulas instead of values", "Formulas -> Show Formulas (shortcut: Ctrl + grave accent)"),
    ("convert a range to a table", "Insert -> Table (or Ctrl+T)"),
    ("paste values only", "copy -> Paste Special -> Values (Ctrl+Alt+V, then V)"),
    ("transpose rows and columns", "copy -> Paste Special -> Transpose"),
    ("set a print area", "Page Layout -> Print Area -> Set Print Area"),
    ("fit everything on one page", "Page Layout -> Scale to Fit -> Width: 1 page"),
    ("highlight duplicate values", "Home -> Conditional Formatting -> Highlight Cells Rules -> Duplicate Values"),
    ("add data bars", "Home -> Conditional Formatting -> Data Bars"),
    ("add a trendline to a chart", "click the chart -> Chart Design -> Add Chart Element -> Trendline"),
    ("lock specific cells", "Format Cells -> Protection -> Locked, then Review -> Protect Sheet"),
    ("insert a header or footer", "Insert -> Header & Footer"),
    ("run spell check", "Review -> Spelling (or F7)"),
    ("use Goal Seek", "Data -> What-If Analysis -> Goal Seek"),
    ("use Solver", "Data -> Solver (enable it under File -> Options -> Add-ins first)"),
    ("get data from a CSV or the web", "Data -> Get Data (Power Query)"),
    ("refresh a pivot table", "PivotTable Analyze -> Refresh (or right-click -> Refresh)"),
    ("change a pivot value to average", "right-click the value -> Summarize Values By -> Average"),
    ("add a sparkline", "Insert -> Sparklines -> Line"),
    ("create a scenario", "Data -> What-If Analysis -> Scenario Manager"),
    ("add a secondary axis", "click the series -> Format Data Series -> Secondary Axis"),
    ("make a custom number format", "Format Cells -> Number -> Custom"),
    ("autofit row height", "Home -> Format -> AutoFit Row Height"),
]
def gen_howto():
    q, a = random.choice(HOWTO)
    return random.choice([f"how do i {q}", f"how to {q}", f"steps to {q}"]), a

# ── chart recommendation ──
CHARTREC = [
    ("sales over time", "line chart"), ("market share by product", "pie chart"),
    ("revenue by region", "bar chart"), ("price vs demand", "scatter chart"),
    ("monthly totals", "column chart"), ("distribution of values", "histogram"),
    ("comparison across categories", "bar chart"), ("a trend over months", "line chart"),
    ("parts of a whole", "pie chart"), ("cumulative total over time", "area chart"),
    ("progress toward a goal", "bar chart"), ("ranking of items", "sorted bar chart"),
    ("a change broken into contributions", "waterfall chart"),
    ("budget versus actual", "clustered column chart"),
    ("data by country or state", "map chart"), ("a single key metric", "big-number card"),
    ("nested categories by size", "treemap"), ("performance across many metrics", "radar chart"),
    ("steps in a conversion funnel", "funnel chart"),
    ("composition by category over time", "stacked column chart"),
    ("relationship between three variables", "bubble chart"),
    ("stock prices over a day", "candlestick chart"),
    ("two measures on different scales", "combo chart with a secondary axis"),
    ("the vital few causes (80/20)", "pareto chart"),
    ("spread and outliers of a dataset", "box and whisker chart"),
    ("a single value against a target", "gauge chart"),
    ("a tiny trend inside one cell", "sparkline"),
]
def gen_chartrec():
    q, a = random.choice(CHARTREC)
    return random.choice([f"best chart for {q}", f"what chart for {q}", f"which chart shows {q}"]), a

# ── Office Script / macro generation ──
SCRIPT = [
    ("bold the header row", "sheet.getRange('1:1').format.font.bold = true;"),
    ("autofit all columns", "sheet.getUsedRange().format.autofitColumns();"),
    ("clear the sheet", "sheet.getUsedRange().clear();"),
    ("freeze the top row", "sheet.freezePanes.freezeRows(1);"),
    ("add a sheet called Summary", "workbook.addWorksheet('Summary');"),
    ("delete the active sheet", "sheet.delete();"),
    ("rename the sheet to Data", "sheet.setName('Data');"),
    ("color the tab red", "sheet.setTabColor('#FF0000');"),
    ("set A1 to Hello", "sheet.getRange('A1').setValue('Hello');"),
    ("put a sum in B1", "sheet.getRange('B1').setFormula('=SUM(A:A)');"),
    ("make column A bold", "sheet.getRange('A:A').format.font.bold = true;"),
    ("fill A1 yellow", "sheet.getRange('A1').format.fill.setSolidColor('#FFFF00');"),
    ("add a border to A1:C3", "sheet.getRange('A1:C3').format.borders.getItem('EdgeBottom').style = ExcelScript.BorderLineStyle.continuous;"),
    ("set the number format to currency", "sheet.getRange('B:B').setNumberFormat('$#,##0.00');"),
    ("sort the used range by column A", "sheet.getUsedRange().getSort().apply([{key: 0, ascending: true}]);"),
    ("turn on the autofilter", "sheet.getUsedRange().setAutoFilter();"),
    ("convert the range to a table", "sheet.addTable(sheet.getUsedRange(), true);"),
    ("hide column C", "sheet.getRange('C:C').setColumnHidden(true);"),
    ("insert a row at row 2", "sheet.getRange('2:2').insert(ExcelScript.InsertShiftDirection.down);"),
    ("delete rows 2 to 5", "sheet.getRange('2:5').delete(ExcelScript.DeleteShiftDirection.up);"),
    ("loop the rows and log each value", "sheet.getUsedRange().getValues().forEach(r=>console.log(r[0]));"),
    ("protect the worksheet", "sheet.getProtection().protect();"),
    ("set the column width", "sheet.getRange('A:A').format.setColumnWidth(120);"),
]
def gen_script():
    q, a = random.choice(SCRIPT)
    return random.choice([f"office script to {q}", f"a macro to {q}", f"script that will {q}"]), a

# ── keyboard shortcuts ──
KEYS = [
    ("sum a column quickly", "Alt + ="), ("fill down", "Ctrl + D"), ("insert today's date", "Ctrl + ;"),
    ("toggle absolute references", "F4"), ("create a chart", "Alt + F1"), ("apply a filter", "Ctrl + Shift + L"),
    ("go to a cell", "Ctrl + G"), ("format as currency", "Ctrl + Shift + $"),
    ("format as percent", "Ctrl + Shift + %"), ("select the whole column", "Ctrl + Space"),
    ("fill right", "Ctrl + R"), ("select the whole row", "Shift + Space"),
    ("insert the current time", "Ctrl + Shift + ;"), ("edit the active cell", "F2"),
    ("flash fill", "Ctrl + E"), ("open format cells", "Ctrl + 1"),
    ("select to the last cell", "Ctrl + Shift + End"), ("jump to the edge of data", "Ctrl + Arrow"),
    ("insert a new row or column", "Ctrl + Shift + +"), ("delete a row or column", "Ctrl + -"),
    ("repeat the last action", "Ctrl + Y"), ("undo", "Ctrl + Z"),
    ("find and replace", "Ctrl + H"), ("new line inside a cell", "Alt + Enter"),
    ("enter an array formula (legacy)", "Ctrl + Shift + Enter"), ("show or hide the ribbon", "Ctrl + F1"),
    ("add a comment", "Shift + F2"), ("name manager", "Ctrl + F3"),
    ("group rows or columns", "Shift + Alt + Right"), ("toggle formulas view", "Ctrl + grave accent"),
]
def gen_keyboard():
    q, a = random.choice(KEYS)
    return random.choice([f"shortcut to {q}", f"keyboard shortcut to {q}", f"hotkey to {q}"]), a

# ── VBA macros ──
VBA = [
    ("bold the header row", "Rows(1).Font.Bold = True"), ("autofit columns", "Columns.AutoFit"),
    ("clear the sheet", "ActiveSheet.UsedRange.Clear"), ("show a message box", 'MsgBox "done"'),
    ("turn off screen updating", "Application.ScreenUpdating = False"),
    ("turn on screen updating", "Application.ScreenUpdating = True"),
    ("loop through the used rows", "For Each r In ActiveSheet.UsedRange.Rows: Next r"),
    ("count the rows of data", "n = ActiveSheet.UsedRange.Rows.Count"),
    ("find the last row in column A", "lastRow = Cells(Rows.Count, 1).End(xlUp).Row"),
    ("put a value in A1", 'Range("A1").Value = "Hello"'),
    ("put a sum formula in B1", 'Range("B1").Formula = "=SUM(A:A)"'),
    ("color A1 yellow", "Range(\"A1\").Interior.Color = vbYellow"),
    ("add a worksheet", "Worksheets.Add"),
    ("delete the active sheet", "Application.DisplayAlerts = False: ActiveSheet.Delete"),
    ("rename the active sheet", 'ActiveSheet.Name = "Data"'),
    ("select the last cell", "ActiveSheet.UsedRange.SpecialCells(xlCellTypeLastCell).Select"),
    ("copy A1 to B1", 'Range("A1").Copy Range("B1")'),
    ("delete blank rows", "On Error Resume Next: Columns(1).SpecialCells(xlCellTypeBlanks).EntireRow.Delete"),
    ("save the workbook", "ActiveWorkbook.Save"),
    ("loop 1 to 10", "For i = 1 To 10: Cells(i, 1) = i: Next i"),
    ("turn off alerts", "Application.DisplayAlerts = False"),
]
def gen_vba():
    q, a = random.choice(VBA)
    return random.choice([f"vba to {q}", f"a vba macro to {q}", f"vba code to {q}"]), a

# ── generate sample data -> GENDATA spec ──
GENDATA_COLS = ["region", "product", "amount", "date", "customer", "status", "price", "quantity",
                "email", "phone", "city", "country", "category", "sku", "discount", "tax", "total",
                "name", "department", "salesperson", "invoice", "due_date", "rating", "cost"]
def gen_gendata():
    n = random.choice([10, 20, 25, 50, 100, 200, 500])
    cs = random.sample(GENDATA_COLS, random.randint(2, 5))
    return random.choice([f"generate {n} rows of sample {cs[0]} data", f"make {n} rows of fake data with {', '.join(cs)}",
                          f"create {n} sample rows of {', '.join(cs)}", f"mock up {n} rows: {', '.join(cs)}"]), \
           f"GENDATA rows={n} cols={','.join(cs)}"

# ── spreadsheet unit test (assertion) ──
def _ut_eq():     c=cell(); n=num(); return random.choice([f"assert {c} equals {n}", f"test that {c} is {n}"]), f"=({c}={n})"
def _ut_gt():     c=cell(); n=num(); return f"check that {c} is greater than {n}", f"=({c}>{n})"
def _ut_lt():     c=cell(); n=num(); return f"check that {c} is less than {n}", f"=({c}<{n})"
def _ut_between():c=cell(); a=num(); b=a+num(); return f"check {c} is between {a} and {b}", f"=AND({c}>={a},{c}<={b})"
def _ut_pos():    c=cell(); return f"assert {c} is positive", f"=({c}>0)"
def _ut_notblank():c=cell(); return f"check {c} is not blank", f'=({c}<>"")'
def _ut_isnum():  c=cell(); return f"assert {c} is a number", f"=ISNUMBER({c})"
def _ut_noerror():c=cell(); return f"check {c} has no error", f"=NOT(ISERROR({c}))"
def _ut_approx(): c=cell(); n=num(); return f"assert {c} is about {n} within 0.01", f"=(ABS({c}-{n})<0.01)"
def _ut_text():   c=cell(); w=word(); return f'assert {c} equals "{w}"', f'=({c}="{w}")'
def _ut_sum():    r,d=rng(); n=num(); return f"check the total of {r} equals {n}", f"=(SUM({r})={n})"
def _ut_count():  c=col(); w=word(); n=num(); return f'check there are {n} "{w}" in {c}', f'=(COUNTIF({c}:{c},"{w}")={n})'
def _ut_inlist(): c=cell(); cl=col(); return f"check {c} appears somewhere in {cl}", f"=(COUNTIF({cl}:{cl},{c})>0)"
def _ut_nodupes():c=col(); return f"check {c} has no duplicates", f"=(COUNTA({c}:{c})=COUNTA(UNIQUE({c}:{c})))"
def _ut_rowcount():c=col(); n=num(); return f"check {c} has {n} non-empty cells", f"=(COUNTA({c}:{c})={n})"
def _ut_allpos(): c=col(); return f"check every value in {c} is positive", f'=(COUNTIF({c}:{c},"<=0")=0)'
UNITTEST_GEN = [_ut_eq, _ut_gt, _ut_lt, _ut_between, _ut_pos, _ut_notblank, _ut_isnum, _ut_noerror, _ut_approx, _ut_text,
                _ut_sum, _ut_count, _ut_inlist, _ut_nodupes, _ut_rowcount, _ut_allpos]
def gen_unittest():
    return random.choice(UNITTEST_GEN)()

# ── data dictionary: real field descriptions (type — meaning) ──
DATADICT = {
    "revenue": "currency — total sales amount for the row",
    "cost": "currency — cost of goods or expense for the row",
    "region": "text — sales territory (north/south/east/west)",
    "date": "date — when the transaction happened",
    "customer": "text — customer name or account ID",
    "quantity": "integer — number of units",
    "status": "text — order state (open/paid/cancelled)",
    "price": "currency — price per unit",
    "margin": "percent — profit as a share of revenue",
    "email": "text — contact email address",
    "sku": "text — stock-keeping unit / product code",
    "discount": "percent — reduction applied to the price",
    "tax": "currency — tax charged on the row",
    "total": "currency — line total after tax and discount",
    "salesperson": "text — rep who closed the deal",
}
def _infer_field(c):
    if c in DATADICT: return DATADICT[c]
    cl = c.lower()
    if cl.startswith(("is_", "has_")) or cl in ("active", "paid", "flag"): return "boolean — a TRUE/FALSE flag"
    if cl.endswith("date") or cl in ("date", "day", "month", "year"): return "date — a date value"
    if any(k in cl for k in ("price", "cost", "revenue", "amount", "total", "salary", "fee", "balance", "value")): return "currency — a monetary amount"
    if any(k in cl for k in ("qty", "quantity", "count", "units", "age", "number")): return "integer — a whole-number count"
    if any(k in cl for k in ("rate", "pct", "percent", "margin", "discount", "growth", "ratio")): return "percent — a rate or ratio"
    if any(k in cl for k in ("email", "name", "id", "sku", "code", "status", "region", "city", "country", "category", "type", "description", "department")): return "text — a label or identifier"
    return "text — a value for each row"
DATADICT_POOL = list(DATADICT) + ["unit_price", "order_date", "ship_date", "is_active", "has_paid",
                                  "employee_id", "product_name", "city", "country", "growth_rate",
                                  "balance", "age", "units", "department"]
def gen_datadict():
    cs = random.sample(DATADICT_POOL, 3)
    return random.choice([f"data dictionary for {', '.join(cs)}", f"document the columns {', '.join(cs)}",
                          f"describe the fields {', '.join(cs)}"]), \
           "; ".join(f"{c}: {_infer_field(c)}" for c in cs)

# ── data-grounded: read a small inline table and answer from the actual values ──
# Teaches the model to GROUND in data (read/compare/compute), not just map a phrase to a formula.
_DG_LABELS = ["west", "east", "north", "south", "q1", "q2", "q3", "q4", "jan", "feb", "mar", "apr",
              "alice", "bob", "carol", "dave", "acme", "globex", "initech", "widgets", "gadgets", "gizmos"]
def _dg_table():
    n = random.randint(3, 4)
    labels = random.sample(_DG_LABELS, n)
    vals = [num() for _ in range(n)]
    return labels, vals
def _dg_fmt(L, V):
    return "[" + ", ".join(f"{l}={v}" for l, v in zip(L, V)) + "]"
def _dg_which_max():
    L, V = _dg_table(); return f"in {_dg_fmt(L,V)} which is highest", L[V.index(max(V))]
def _dg_which_min():
    L, V = _dg_table(); return f"in {_dg_fmt(L,V)} which is lowest", L[V.index(min(V))]
def _dg_total():
    L, V = _dg_table(); return f"what is the total of {_dg_fmt(L,V)}", str(sum(V))
def _dg_maxval():
    L, V = _dg_table(); return f"the highest value in {_dg_fmt(L,V)}", str(max(V))
def _dg_minval():
    L, V = _dg_table(); return f"the lowest value in {_dg_fmt(L,V)}", str(min(V))
def _dg_lookup():
    L, V = _dg_table(); i = random.randrange(len(L)); return f"in {_dg_fmt(L,V)} what is {L[i]}", str(V[i])
def _dg_diff():
    L, V = _dg_table(); i, j = random.sample(range(len(L)), 2); return f"in {_dg_fmt(L,V)} the difference between {L[i]} and {L[j]}", str(abs(V[i]-V[j]))
def _dg_compare():
    L, V = _dg_table(); i, j = random.sample(range(len(L)), 2); return f"in {_dg_fmt(L,V)} is {L[i]} more than {L[j]}", ("yes" if V[i] > V[j] else "no")
def _dg_count_over():
    L, V = _dg_table(); t = random.choice([20, 50, 100, 200]); return f"in {_dg_fmt(L,V)} how many are over {t}", str(sum(1 for v in V if v > t))
def _dg_range():
    L, V = _dg_table(); return f"the range (max minus min) of {_dg_fmt(L,V)}", str(max(V)-min(V))
def _dg_count_rows():
    L, V = _dg_table(); return f"how many rows are in {_dg_fmt(L,V)}", str(len(L))
def _dg_sum_formula():
    L, V = _dg_table(); return f"given {_dg_fmt(L,V)}, write a formula for the total", "=" + "+".join(str(v) for v in V)
def _dg_avg_of_two():
    L, V = _dg_table(); i, j = random.sample(range(len(L)), 2); s = V[i] + V[j]
    return f"in {_dg_fmt(L,V)} the average of {L[i]} and {L[j]}", str(s // 2) if s % 2 == 0 else f"{s/2:.1f}"
# multi-column: filter by a category column, THEN aggregate — the core of real analysis
_DG2_COLS = [("name", "status", "amount"), ("region", "type", "sales"), ("item", "category", "price"), ("rep", "stage", "deal")]
def _dg2_build():
    cols = random.choice(_DG2_COLS); n = 3   # keep multi-col tables short to fit the context window
    labels = random.sample(_DG_LABELS, n)
    catset = random.choice([["paid", "open"], ["new", "old"], ["yes", "no"], ["hot", "cold"]])
    rows = [(labels[i], random.choice(catset), num()) for i in range(n)]
    return cols, rows
def _dg2_fmt(cols, rows):
    return f"{cols[0]}/{cols[1]}/{cols[2]}: " + "; ".join(f"{l},{c},{v}" for l, c, v in rows)
def _dg2_sum_where():
    cols, rows = _dg2_build(); k = random.choice([c for _, c, _ in rows])
    return f"in [{_dg2_fmt(cols,rows)}] total {cols[2]} where {cols[1]} is {k}", str(sum(v for _, c, v in rows if c == k))
def _dg2_count_where():
    cols, rows = _dg2_build(); k = random.choice([c for _, c, _ in rows])
    return f"in [{_dg2_fmt(cols,rows)}] how many rows have {cols[1]} = {k}", str(sum(1 for _, c, _ in rows if c == k))
def _dg2_max_where():
    cols, rows = _dg2_build(); k = random.choice([c for _, c, _ in rows])
    return f"in [{_dg2_fmt(cols,rows)}] the highest {cols[2]} where {cols[1]} is {k}", str(max(v for _, c, v in rows if c == k))
def _dg2_which_max():
    cols, rows = _dg2_build(); top = max(rows, key=lambda r: r[2])
    return f"in [{_dg2_fmt(cols,rows)}] which {cols[0]} has the highest {cols[2]}", top[0]
def _dg2_diff_cat():
    cols, rows = _dg2_build(); cats = list(dict.fromkeys(c for _, c, _ in rows))
    if len(cats) < 2: return _dg2_sum_where()
    a, b = cats[0], cats[1]
    return f"in [{_dg2_fmt(cols,rows)}] the difference in total {cols[2]} between {a} and {b}", str(abs(sum(v for _, c, v in rows if c == a) - sum(v for _, c, v in rows if c == b)))
_DATAGROUND = [_dg_which_max, _dg_which_min, _dg_total, _dg_maxval, _dg_minval, _dg_lookup,
               _dg_diff, _dg_compare, _dg_count_over, _dg_range, _dg_count_rows, _dg_sum_formula, _dg_avg_of_two,
               _dg2_sum_where, _dg2_count_where, _dg2_max_where, _dg2_which_max, _dg2_diff_cat]
def gen_dataground():
    return random.choice(_DATAGROUND)()

# ── harder formulas: the gnarly real-analyst constructs (shifts the complexity up) ──
def _h_sumifs_dates():
    sc=col(); dc=col(); y=random.choice([2023,2024,2025])
    return (f"total {sc} where {dc} is in the first half of {y}",
            f'=SUMIFS({sc}:{sc},{dc}:{dc},">="&DATE({y},1,1),{dc}:{dc},"<="&DATE({y},6,30))')
def _h_averageifs_dates():
    sc=col(); dc=col(); y=random.choice([2023,2024])
    return (f"average {sc} for the year {y}",
            f'=AVERAGEIFS({sc}:{sc},{dc}:{dc},">="&DATE({y},1,1),{dc}:{dc},"<="&DATE({y},12,31))')
def _h_index_match_2d():
    a=cell(); b=cell()
    return (f"two-way lookup: find the value for row key {a} and column key {b}",
            f"=INDEX(B2:F20,MATCH({a},A2:A20,0),MATCH({b},B1:F1,0))")
def _h_let_margin():
    return ("net margin with LET using revenue A1 and cost B1",
            "=LET(rev,A1,cost,B1,(rev-cost)/rev)")
def _h_filter_sum():
    sc=col(); cc=col(); w=word()
    return (f"sum of {sc} for only the {w} rows using FILTER",
            f'=SUM(FILTER({sc}:{sc},{cc}:{cc}="{w}"))')
def _h_sort_unique():
    c=col(); return (f"a sorted list of the unique values in {c}", f"=SORT(UNIQUE({c}2:{c}100))")
def _h_xlookup_full():
    a=cell(); k=col(); v=col()
    return (f"look up {a} in {k}, return {v}, exact match, or 'not found'",
            f'=XLOOKUP({a},{k}:{k},{v}:{v},"not found",0)')
def _h_iferror_chain():
    a=cell(); k1=col(); v1=col(); k2=col(); v2=col()
    return (f"look up {a} in {k1}/{v1}, and if missing try {k2}/{v2}",
            f"=IFERROR(XLOOKUP({a},{k1}:{k1},{v1}:{v1}),XLOOKUP({a},{k2}:{k2},{v2}:{v2}))")
def _h_sumproduct_multi():
    a=col(); b=col(); c=col(); w=word(); n=num()
    return (f"sum {c} where {a} is {w} and {b} is over {n}",
            f'=SUMPRODUCT(({a}:{a}="{w}")*({b}:{b}>{n})*{c}:{c})')
def _h_weighted_avg():
    v=col(); w=col(); return (f"weighted average of {v} weighted by {w}", f"=SUMPRODUCT({v}:{v},{w}:{w})/SUM({w}:{w})")
def _h_distinct_count():
    c=col(); return (f"count the distinct values in {c}", f"=SUMPRODUCT(1/COUNTIF({c}2:{c}50,{c}2:{c}50))")
def _h_running_total():
    c=col(); r=random.randint(2,40); return (f"running total down {c} at row {r}", f"=SUM(${c}$2:{c}{r})")
def _h_rank_no_ties():
    c=col(); r=random.randint(2,40); return (f"rank of {c}{r} with ties broken by order", f"=RANK.EQ({c}{r},{c}:{c})+COUNTIF(${c}$2:{c}{r},{c}{r})-1")
def _h_map_lambda():
    c=col(); return (f"double every value in {c} with MAP and LAMBDA", f"=MAP({c}2:{c}20,LAMBDA(x,x*2))")
def _h_textjoin_filter():
    a=col(); b=col(); w=word(); return (f"a comma list of {a} where {b} is {w}", f'=TEXTJOIN(", ",TRUE,FILTER({a}2:{a}50,{b}2:{b}50="{w}"))')
def _h_nested_ifs():
    c=cell(); return (f"letter grade for {c}", f'=IFS({c}>=90,"A",{c}>=80,"B",{c}>=70,"C",{c}>=60,"D",TRUE,"F")')
def _h_countifs_multi():
    a=col(); b=col(); w=word(); n=num(); return (f"count rows where {a} is {w} and {b} is over {n}", f'=COUNTIFS({a}:{a},"{w}",{b}:{b},">"&{n})')
def _h_vstack():
    a=col(); b=col(); return (f"stack {a} on top of {b} into one list", f"=VSTACK({a}2:{a}20,{b}2:{b}20)")
HARD = [_h_sumifs_dates,_h_averageifs_dates,_h_index_match_2d,_h_let_margin,_h_filter_sum,_h_sort_unique,
        _h_xlookup_full,_h_iferror_chain,_h_sumproduct_multi,_h_weighted_avg,_h_distinct_count,_h_running_total,
        _h_rank_no_ties,_h_map_lambda,_h_textjoin_filter,_h_nested_ifs,_h_countifs_multi,_h_vstack]
def gen_hard():
    return random.choice(HARD)()

# ── domain depth: accounting + FP&A terminology -> the right formula ──
def _d_dso():       return ("days sales outstanding from receivables A1 and revenue B1", "=A1/B1*365")
def _d_dpo():       return ("days payable outstanding from payables A1 and COGS B1", "=A1/B1*365")
def _d_inv_turn():  return ("inventory turnover from COGS A1 and average inventory B1", "=A1/B1")
def _d_quick():     return ("quick ratio from current assets A1, inventory B1, current liabilities C1", "=(A1-B1)/C1")
def _d_gross_marg():return ("gross margin from revenue A1 and COGS B1", "=(A1-B1)/A1")
def _d_recon():     a=cell(); b=cell(); return (f"reconcile {a} against {b}", f'=IF({a}={b},"OK","off by "&({a}-{b}))')
def _d_sln():       return ("straight-line depreciation from cost A1, salvage B1, life C1", "=(A1-B1)/C1")
def _d_ddb():       return ("declining-balance depreciation from book value A1 and rate B1", "=A1*B1")
def _d_yoy():       a=cell(); b=cell(); return (f"year-over-year growth from {a} to {b}", f"=({b}-{a})/{a}")
def _d_mom():       c=col(); r=random.randint(3,40); return (f"month-over-month growth in {c} at row {r}", f"=({c}{r}-{c}{r-1})/{c}{r-1}")
def _d_cagr():      return ("CAGR from beginning A1, ending B1, over C1 years", "=(B1/A1)^(1/C1)-1")
def _d_var_budget():return ("variance to budget from actual A1 and budget B1", "=(A1-B1)/B1")
def _d_run_rate():  c=cell(); return (f"annualized run rate from monthly value {c}", f"={c}*12")
def _d_pct_total(): c=col(); r=random.randint(2,40); return (f"{c}{r} as a percent of the column total", f"={c}{r}/SUM({c}:{c})")
def _d_ytd():       c=col(); r=random.randint(2,40); return (f"year-to-date cumulative {c} at row {r}", f"=SUM(${c}$2:{c}{r})")
def _d_contrib():   return ("contribution margin ratio from price A1 and variable cost B1", "=(A1-B1)/A1")
def _d_breakeven(): return ("break-even units from fixed costs A1, price B1, variable cost C1", "=A1/(B1-C1)")
def _d_retention(): return ("customer retention from starting count A1 and retained B1", "=B1/A1")
def _d_roas():      return ("return on ad spend from revenue A1 and ad cost B1", "=A1/B1")
def _d_ebitda_marg():return ("EBITDA margin from EBITDA A1 and revenue B1", "=A1/B1")
# tax
def _d_sales_tax():  return ("sales tax on A1 at rate B1", "=A1*B1")
def _d_after_tax():  return ("after-tax amount of A1 at tax rate B1", "=A1*(1-B1)")
def _d_pretax():     return ("pre-tax amount from gross A1 at rate B1", "=A1/(1+B1)")
def _d_eff_rate():   return ("effective tax rate from tax paid A1 and income B1", "=A1/B1")
def _d_gross_tax():  return ("gross amount including B1 tax on net A1", "=A1*(1+B1)")
# payroll
def _d_gross_pay():  return ("gross pay from hours A1 and hourly rate B1", "=A1*B1")
def _d_overtime():   return ("overtime pay for A1 hours beyond 40 at rate B1", "=(A1-40)*B1*1.5")
def _d_annualize():  return ("annual salary from hourly rate A1 at 40h over 52 weeks", "=A1*40*52")
def _d_net_pay():    return ("net pay from gross A1 and deductions B1", "=A1-B1")
def _d_fica():       return ("FICA tax at 7.65% on wages A1", "=A1*0.0765")
# retail / commerce
def _d_markup():     return ("markup percent from price A1 and cost B1", "=(A1-B1)/B1")
def _d_sell_through():return ("sell-through rate from units sold A1 and received B1", "=A1/B1")
def _d_aov():        return ("average order value from revenue A1 and orders B1", "=A1/B1")
def _d_conversion(): return ("conversion rate from orders A1 and visits B1", "=A1/B1")
# SaaS metrics
def _d_mrr():        return ("MRR from customers A1 and ARPU B1", "=A1*B1")
def _d_arr():        return ("ARR from MRR A1", "=A1*12")
def _d_churn():      return ("churn rate from customers lost A1 and total B1", "=A1/B1")
def _d_ltv():        return ("customer lifetime value from ARPU A1 and churn rate B1", "=A1/B1")
def _d_ltv_cac():    return ("LTV to CAC ratio from LTV A1 and CAC B1", "=A1/B1")
def _d_nrr():        return ("net revenue retention from ending MRR A1 and starting MRR B1", "=A1/B1")
def _d_arpu():       return ("ARPU from revenue A1 and active users B1", "=A1/B1")
# real estate
def _d_cap_rate():   return ("cap rate from NOI A1 and property price B1", "=A1/B1")
def _d_cash_cash(): return ("cash-on-cash return from annual cash flow A1 and cash invested B1", "=A1/B1")
def _d_price_sqft(): return ("price per square foot from price A1 and area B1", "=A1/B1")
DOMAIN = [_d_dso,_d_dpo,_d_inv_turn,_d_quick,_d_gross_marg,_d_recon,_d_sln,_d_ddb,_d_yoy,_d_mom,_d_cagr,
          _d_var_budget,_d_run_rate,_d_pct_total,_d_ytd,_d_contrib,_d_breakeven,_d_retention,_d_roas,_d_ebitda_marg,
          _d_sales_tax,_d_after_tax,_d_pretax,_d_eff_rate,_d_gross_tax,
          _d_gross_pay,_d_overtime,_d_annualize,_d_net_pay,_d_fica,
          _d_markup,_d_sell_through,_d_aov,_d_conversion,
          _d_mrr,_d_arr,_d_churn,_d_ltv,_d_ltv_cac,_d_nrr,_d_arpu,
          _d_cap_rate,_d_cash_cash,_d_price_sqft]
def gen_domain():
    return random.choice(DOMAIN)()

# ── industry KPIs: signature metric of each field -> the right calc (the vocabulary layer) ──
KPI = [
    # logistics / supply chain / warehouse / shipping / receiving
    ("on-time delivery rate from on-time A1 and total deliveries B1", "=A1/B1"),
    ("order fill rate from filled A1 and ordered B1", "=A1/B1"),
    ("freight cost per unit from total freight A1 and units B1", "=A1/B1"),
    ("average lead time from order date A1 to receipt date B1", "=B1-A1"),
    ("days of inventory on hand from inventory A1 and daily usage B1", "=A1/B1"),
    ("pick accuracy from correct picks A1 and total picks B1", "=A1/B1"),
    ("damage rate from damaged units A1 and received B1", "=A1/B1"),
    ("backorder rate from backordered A1 and total orders B1", "=A1/B1"),
    ("inventory accuracy from counted A1 and system count B1", "=A1/B1"),
    # manufacturing / production / quality
    ("defect rate from defects A1 and units produced B1", "=A1/B1"),
    ("first pass yield from good units A1 and total units B1", "=A1/B1"),
    ("scrap rate from scrap A1 and total material B1", "=A1/B1"),
    ("capacity utilization from actual output A1 and max capacity B1", "=A1/B1"),
    ("overall equipment effectiveness from availability A1, performance B1, quality C1", "=A1*B1*C1"),
    ("units per labor hour from units A1 and labor hours B1", "=A1/B1"),
    ("downtime percent from downtime hours A1 and total hours B1", "=A1/B1"),
    ("production cycle time from start A1 and end B1", "=B1-A1"),
    ("inspection pass rate from passed A1 and inspected B1", "=A1/B1"),
    # sales / sales ops
    ("win rate from deals won A1 and total deals B1", "=A1/B1"),
    ("quota attainment from actual A1 and quota B1", "=A1/B1"),
    ("average deal size from revenue A1 and deals B1", "=A1/B1"),
    ("sales cycle length from first contact A1 to close B1", "=B1-A1"),
    ("pipeline coverage from pipeline A1 and quota B1", "=A1/B1"),
    ("lead conversion rate from converted A1 and leads B1", "=A1/B1"),
    ("revenue per rep from revenue A1 and reps B1", "=A1/B1"),
    # marketing / digital / ads / email / social / seo
    ("click-through rate from clicks A1 and impressions B1", "=A1/B1"),
    ("cost per click from spend A1 and clicks B1", "=A1/B1"),
    ("cost per thousand impressions from spend A1 and impressions B1", "=A1/B1*1000"),
    ("cost per lead from spend A1 and leads B1", "=A1/B1"),
    ("email open rate from opens A1 and delivered B1", "=A1/B1"),
    ("email click rate from clicks A1 and delivered B1", "=A1/B1"),
    ("bounce rate from bounces A1 and sessions B1", "=A1/B1"),
    ("engagement rate from engagements A1 and followers B1", "=A1/B1"),
    ("website conversion rate from conversions A1 and visitors B1", "=A1/B1"),
    # HR / recruiting / workforce
    ("employee turnover rate from departures A1 and average headcount B1", "=A1/B1"),
    ("time to hire from posting date A1 to offer date B1", "=B1-A1"),
    ("offer acceptance rate from accepted A1 and offers B1", "=A1/B1"),
    ("absenteeism rate from absent days A1 and workdays B1", "=A1/B1"),
    ("cost per hire from recruiting cost A1 and hires B1", "=A1/B1"),
    ("training completion rate from completed A1 and enrolled B1", "=A1/B1"),
    ("revenue per employee from revenue A1 and employees B1", "=A1/B1"),
    ("headcount growth from start A1 and end B1", "=(B1-A1)/A1"),
    # healthcare
    ("bed occupancy rate from occupied A1 and total beds B1", "=A1/B1"),
    ("claim denial rate from denied A1 and submitted B1", "=A1/B1"),
    ("days in AR from receivables A1 and daily charges B1", "=A1/B1"),
    ("patient no-show rate from no-shows A1 and appointments B1", "=A1/B1"),
    ("cost per patient from total cost A1 and patients B1", "=A1/B1"),
    # restaurant / hotel / retail / hospitality
    ("food cost percentage from food cost A1 and food sales B1", "=A1/B1"),
    ("labor cost percentage from labor A1 and sales B1", "=A1/B1"),
    ("prime cost from food cost A1 and labor cost B1", "=A1+B1"),
    ("table turnover from covers A1 and seats B1", "=A1/B1"),
    ("average check from sales A1 and covers B1", "=A1/B1"),
    ("hotel occupancy from rooms sold A1 and rooms available B1", "=A1/B1"),
    ("average daily rate from room revenue A1 and rooms sold B1", "=A1/B1"),
    ("revenue per available room from room revenue A1 and rooms available B1", "=A1/B1"),
    ("sales per square foot from sales A1 and floor area B1", "=A1/B1"),
    ("shrinkage rate from shrinkage A1 and sales B1", "=A1/B1"),
    # project / program / construction
    ("percent complete from completed tasks A1 and total tasks B1", "=A1/B1"),
    ("cost performance index from earned value A1 and actual cost B1", "=A1/B1"),
    ("schedule performance index from earned value A1 and planned value B1", "=A1/B1"),
    ("days until deadline from due date A1", "=A1-TODAY()"),
    ("budget burn from spent A1 and budget B1", "=A1/B1"),
    ("cost variance from earned value A1 and actual cost B1", "=A1-B1"),
    # procurement / purchasing / vendor
    ("cost savings from list price A1 and negotiated price B1", "=(A1-B1)/A1"),
    ("supplier on-time rate from on-time A1 and total deliveries B1", "=A1/B1"),
    ("purchase price variance from actual A1 and standard B1", "=(A1-B1)/B1"),
    ("spend under management from managed spend A1 and total spend B1", "=A1/B1"),
    # IT / devops / support / help desk / security
    ("uptime percentage from uptime hours A1 and total hours B1", "=A1/B1"),
    ("SLA compliance from met A1 and total tickets B1", "=A1/B1"),
    ("ticket resolution rate from resolved A1 and total tickets B1", "=A1/B1"),
    ("first contact resolution from resolved on first contact A1 and total B1", "=A1/B1"),
    ("mean time to resolve from total resolution hours A1 and incidents B1", "=A1/B1"),
    # nonprofit / fundraising / grants
    ("cost per dollar raised from fundraising cost A1 and amount raised B1", "=A1/B1"),
    ("donor retention from retained A1 and prior donors B1", "=A1/B1"),
    ("program expense ratio from program expense A1 and total expense B1", "=A1/B1"),
    ("average gift size from total donations A1 and donors B1", "=A1/B1"),
    # education / admissions / financial aid
    ("acceptance rate from accepted A1 and applicants B1", "=A1/B1"),
    ("admissions yield from enrolled A1 and accepted B1", "=A1/B1"),
    ("student retention from returning A1 and prior enrollment B1", "=A1/B1"),
    ("attendance rate from days present A1 and school days B1", "=A1/B1"),
    ("student to teacher ratio from students A1 and teachers B1", "=A1/B1"),
    # real estate / property / leasing
    ("occupancy rate from occupied units A1 and total units B1", "=A1/B1"),
    ("vacancy rate from vacant units A1 and total units B1", "=A1/B1"),
    ("gross rent multiplier from price A1 and annual rent B1", "=A1/B1"),
    # finance / treasury / risk / investment
    ("debt service coverage from operating income A1 and debt payments B1", "=A1/B1"),
    ("interest coverage from EBIT A1 and interest expense B1", "=A1/B1"),
    ("simple payback from investment A1 and annual savings B1", "=A1/B1"),
]
def gen_kpi():
    q, a = random.choice(KPI)
    return random.choice([q, f"formula for {q}", f"how do I calculate {q}", f"{q} as a formula"]), a

# ══════════════════════════════════════════════════════════════════════
#  ACCOUNTING COWORKER: advice, interpretation, judgment (not just formulas)
# ══════════════════════════════════════════════════════════════════════

# ── metric verdicts: look at a value and give a real coworker take ──
def _adv_current_ratio():
    v = random.choice(["0.6","0.8","1.2","1.6","2.0","3.5"]); f = float(v)
    a = (f"A current ratio of {v} is a worry — current liabilities exceed current assets, so short-term bills could get tight. Aim for 1.5 to 2." if f < 1 else
         f"A current ratio of {v} is healthy — you can cover short-term obligations comfortably. 1.5 to 2 is the sweet spot." if f <= 2.2 else
         f"A current ratio of {v} is high — very liquid, but idle cash or inventory may mean capital isn't working hard enough.")
    return random.choice([f"is a current ratio of {v} good", f"my current ratio is {v}, should I worry", f"what does a current ratio of {v} mean"]), a
def _adv_net_margin():
    v = random.choice(["2%","5%","12%","20%","35%"]); n = int(v[:-1])
    a = (f"A {v} net margin is thin — little cushion for surprises. It can be fine for high-volume retail, but watch costs closely." if n < 6 else
         f"A {v} net margin is solid for most businesses — healthy profitability with room to absorb shocks." if n <= 22 else
         f"A {v} net margin is strong — typical of software or premium brands. Make sure it's sustainable, not under-investment.")
    return random.choice([f"is a {v} net margin good", f"my net margin is {v}, how is that", f"what does a {v} net margin tell me"]), a
def _adv_dso():
    v = random.choice([28,40,55,75,95])
    a = (f"A DSO of {v} days is good — you're collecting quickly, which keeps cash flowing." if v <= 45 else
         f"A DSO of {v} days is on the high side — cash is tied up in receivables. Tighten terms and chase overdue invoices." if v <= 75 else
         f"A DSO of {v} days is a red flag — collections are slow and cash is stuck. Review credit policy and follow up aggressively.")
    return random.choice([f"is a DSO of {v} days good", f"my DSO is {v} days, is that bad", f"what does a {v} day DSO mean"]), a
def _adv_churn():
    v = random.choice(["1%","3%","5%","8%","12%"]); n = int(v[:-1])
    a = (f"{v} monthly churn is excellent — customers are sticking around, which compounds growth." if n <= 2 else
         f"{v} monthly churn is workable but worth improving — over a year that's a big chunk of your base." if n <= 5 else
         f"{v} monthly churn is high — you're losing customers faster than is sustainable. Fixing retention beats chasing new sign-ups.")
    return random.choice([f"is {v} monthly churn good", f"my churn is {v} a month, should I worry", f"what does {v} churn mean for my saas"]), a
def _adv_runway():
    v = random.choice([3,6,12,18,30])
    a = (f"{v} months of runway is dangerous — start raising or cutting now; fundraising itself takes months." if v <= 6 else
         f"{v} months of runway is comfortable — enough to hit milestones, but keep an eye on burn." if v <= 18 else
         f"{v} months of runway is very safe — you have room to invest in growth rather than just survive.")
    return random.choice([f"is {v} months of runway enough", f"i have {v} months of runway, what should I do", f"what does {v} months runway mean"]), a
def _adv_debt_equity():
    v = random.choice(["0.3","0.8","1.5","2.5","4.0"]); f = float(v)
    a = (f"A debt-to-equity of {v} is conservative — low leverage and low risk, though you may be under-using cheap debt." if f < 1 else
         f"A debt-to-equity of {v} is moderate — a normal amount of leverage for most industries." if f <= 2 else
         f"A debt-to-equity of {v} is high — heavy leverage magnifies risk if revenue dips. Lenders may get nervous.")
    return random.choice([f"is a debt to equity of {v} good", f"my debt to equity is {v}, is that risky", f"what does a {v} debt to equity ratio mean"]), a
def _adv_quick_ratio():
    v = random.choice(["0.5","0.9","1.2","2.0"]); f = float(v)
    a = (f"A quick ratio of {v} is tight — without selling inventory you can't fully cover current liabilities. Watch cash closely." if f < 1 else
         f"A quick ratio of {v} is healthy — you can cover short-term liabilities even without touching inventory.")
    return random.choice([f"is a quick ratio of {v} good", f"my quick ratio is {v}, should I worry"]), a
def _adv_ltv_cac():
    v = random.choice(["0.8","2.0","3.5","6.0"]); f = float(v)
    a = (f"An LTV:CAC of {v} is unsustainable — you're spending more to acquire customers than they're worth. Fix unit economics first." if f < 1 else
         f"An LTV:CAC of {v} is okay but thin — 3:1 is the usual healthy target." if f < 3 else
         f"An LTV:CAC of {v} is strong — customers are well worth their cost. If it's very high you might even spend more on growth.")
    return random.choice([f"is an ltv to cac of {v} good", f"my ltv cac ratio is {v}, how is that"]), a
def _adv_gross_margin():
    v = random.choice(["18%","35%","55%","80%"]); n = int(v[:-1])
    a = (f"A {v} gross margin is slim — common in retail or distribution; you'll need volume and tight overhead to profit." if n < 30 else
         f"A {v} gross margin is solid — healthy room to cover operating costs and still profit." if n < 65 else
         f"A {v} gross margin is excellent — typical of software or services, leaving lots of room for growth spend.")
    return random.choice([f"is a {v} gross margin good", f"my gross margin is {v}, how does that look"]), a
def _adv_inv_turnover():
    v = random.choice([2,6,12,20])
    a = (f"Inventory turnover of {v}x is low — stock is sitting too long, tying up cash and risking obsolescence." if v <= 4 else
         f"Inventory turnover of {v}x is healthy — you're selling through stock at a good clip." if v <= 14 else
         f"Inventory turnover of {v}x is very high — efficient, but make sure you're not stocking out and losing sales.")
    return random.choice([f"is inventory turnover of {v} good", f"my inventory turns {v} times a year, is that good"]), a
ADVISE = [_adv_current_ratio,_adv_net_margin,_adv_dso,_adv_churn,_adv_runway,_adv_debt_equity,
          _adv_quick_ratio,_adv_ltv_cac,_adv_gross_margin,_adv_inv_turnover]
def gen_advise():
    return random.choice(ADVISE)()

# ── concepts: explain accounting / finance terms like a patient coworker ──
CONCEPTS = {
    "accrual vs cash accounting": "Accrual records revenue and expenses when they're earned or incurred; cash accounting records them only when money actually moves. Accrual shows truer performance.",
    "working capital": "Current assets minus current liabilities — the short-term cash cushion that funds day-to-day operations. Positive is good; negative can signal a cash crunch.",
    "EBITDA": "Earnings before interest, taxes, depreciation and amortization — a rough proxy for operating cash profitability, stripping out financing and accounting choices.",
    "depreciation": "Spreading the cost of a physical asset over its useful life, so the expense matches the years it helps generate revenue, instead of hitting all at once.",
    "amortization": "Like depreciation, but for intangible assets (patents, software) or for paying down a loan's principal over time.",
    "deferred revenue": "Cash you've collected for goods or services not yet delivered. It's a liability until you earn it, because you still owe the customer.",
    "FIFO vs LIFO": "Inventory costing methods: FIFO assumes the oldest stock sells first, LIFO the newest. In rising prices, FIFO shows higher profit, LIFO lower taxes.",
    "gross vs net profit": "Gross profit is revenue minus the direct cost of goods; net profit is what's left after ALL expenses, interest and taxes.",
    "fixed vs variable costs": "Fixed costs (rent, salaries) stay the same regardless of output; variable costs (materials, shipping) rise and fall with how much you produce.",
    "contribution margin": "Revenue minus variable costs — how much each sale contributes toward covering fixed costs and then profit.",
    "accounts receivable": "Money customers owe you for sales already made on credit. It's an asset, but only useful once you actually collect it.",
    "accounts payable": "Money you owe suppliers for purchases made on credit. Managed well, it's a free short-term source of financing.",
    "retained earnings": "Cumulative profit the business has kept and reinvested rather than paid out as dividends.",
    "COGS": "Cost of goods sold — the direct costs of producing what you sold (materials and direct labor), but not overhead or sales costs.",
    "capex vs opex": "Capex is spending on long-lived assets (equipment, buildings) capitalized over time; opex is day-to-day running costs expensed immediately.",
    "accrued expenses": "Costs you've incurred but not yet paid (like wages earned before payday). They're recorded as a liability to match the period they belong to.",
    "prepaid expenses": "Costs paid in advance (like annual insurance). They sit as an asset and are expensed gradually as you use them up.",
    "goodwill": "The premium paid to acquire a business above the fair value of its net assets — it reflects brand, relationships and other intangibles.",
    "double-entry bookkeeping": "Every transaction hits at least two accounts so debits always equal credits, keeping the books in balance and catching errors.",
    "the accounting equation": "Assets = Liabilities + Equity. It must always balance; it's the foundation of the balance sheet.",
    "cash flow vs profit": "Profit is an accounting measure that can include non-cash items; cash flow is the actual money in and out. A profitable company can still run out of cash.",
    "burn rate": "How fast you're spending cash each month. Net burn is expenses minus revenue — what's actually draining the bank.",
    "runway": "How many months of cash you have left at your current burn rate before you run out.",
    "debit vs credit": "Bookkeeping entries: debits increase assets and expenses, credits increase liabilities, equity and revenue. Every entry needs both sides.",
    "balance sheet": "A snapshot at one point in time of what you own (assets), owe (liabilities) and the owners' stake (equity).",
    "income statement": "Shows revenue, expenses and profit over a period — how the business performed, not what it owns.",
    "cash flow statement": "Tracks actual cash moving through operations, investing and financing — it reconciles profit to the change in your bank balance.",
    "break-even point": "The sales level where total revenue exactly covers total costs, so profit is zero. Past it, each sale adds profit.",
    "net present value": "Today's value of future cash flows discounted for the time value of money. Positive NPV means an investment should add value.",
    "overhead": "Ongoing costs of running the business that aren't tied to a specific product — rent, admin, utilities, insurance.",
    "deferred tax": "A timing difference between accounting profit and taxable profit, creating tax you'll pay (or save) in a future period.",
    "write-off": "Removing an asset's value from the books when it's no longer recoverable, like uncollectable receivables or obsolete inventory.",
    "trial balance": "A list of all account balances used to check that total debits equal total credits before preparing financial statements.",
    "operating vs net income": "Operating income is profit from core operations; net income subtracts interest, taxes and one-offs to get the true bottom line.",
}
def gen_concept():
    t = random.choice(list(CONCEPTS))
    return random.choice([f"what is {t}", f"explain {t}", f"what does {t} mean", f"can you explain {t}"]), CONCEPTS[t]

# ── consulting: improve / diagnose / decide — actionable coworker guidance ──
CONSULT = [
    ("how do I lower my DSO", "Invoice the moment work is done, tighten payment terms, offer a small early-payment discount, and follow up on overdue accounts weekly."),
    ("how can I improve my gross margin", "Raise prices where you can, negotiate supplier costs, cut waste in production, and shift the mix toward higher-margin products."),
    ("how do I reduce churn", "Onboard customers well, watch for early warning signs of disengagement, fix the top cancellation reasons, and check in before renewals."),
    ("how do I extend my runway", "Cut non-essential spend, slow hiring, focus on revenue that lands fast, and renegotiate big contracts — every month bought is leverage."),
    ("how do I improve cash flow", "Speed up collections, slow down (without straining) payables, trim inventory, and bill in advance or in milestones where possible."),
    ("how do I reduce inventory costs", "Order in smaller, more frequent batches, drop slow-moving SKUs, use demand forecasts, and negotiate consignment terms with suppliers."),
    ("how do I increase average order value", "Bundle products, offer tiered pricing, add relevant upsells at checkout, and set free-shipping thresholds above your current average."),
    ("how do I lower customer acquisition cost", "Double down on the channels that already convert, improve landing-page conversion, and lean on referrals and retention over paid ads."),
    ("how do I speed up collections", "Send invoices immediately, automate reminders, make paying easy, and put repeat late-payers on prepayment or shorter terms."),
    ("how do I cut overhead", "Audit recurring subscriptions, renegotiate rent and insurance, consolidate vendors, and question any cost that doesn't drive revenue."),
    ("my AR is growing faster than revenue, what does that mean", "Customers are taking longer to pay — collections aren't keeping up with sales. Cash is tied up; tighten terms and chase overdue accounts."),
    ("I have negative working capital, is that bad", "Often yes — it means short-term liabilities exceed short-term assets, a possible cash crunch. But some efficient businesses run it deliberately."),
    ("my profit is up but cash is down, why", "Profit includes non-cash items and credit sales. Cash can fall while profit rises if receivables, inventory, or capex are growing."),
    ("my margins are shrinking, what should I look at", "Check whether costs rose, prices fell, discounting crept up, or the sales mix shifted toward cheaper products — isolate which one moved."),
    ("my expenses are growing faster than revenue, what now", "That's unsustainable — find which cost lines outpaced sales, freeze discretionary spend, and tie new spending to revenue it generates."),
    ("inventory keeps rising, what does that signal", "You're buying or making faster than you sell — cash gets stuck and obsolescence risk grows. Tighten purchasing to actual demand."),
    ("should I lease or buy equipment", "Buy if you'll use it long-term and have the cash; lease to preserve cash, stay flexible, or for fast-obsoleting gear. Compare total cost either way."),
    ("should I raise my prices", "If you have pricing power and aren't losing deals on price, a small increase usually flows straight to profit. Test on a segment first."),
    ("should I hire or use a contractor", "Hire for ongoing core work you can keep busy; use contractors for spiky, specialized, or short-term needs to stay flexible."),
    ("when should I raise capital", "Raise from a position of strength — when growth is proven and you have 6+ months runway — not when you're nearly out of cash."),
    ("should I offer early payment discounts", "Worth it if you need cash faster and the discount costs less than your financing. A 2% discount for 20 days early is a common trade."),
    ("how do I know if I'm pricing too low", "Signs: you win nearly every deal, customers never push back on price, and margins are below industry norms. That's room to raise."),
    ("what should I do if a customer won't pay", "Send a firm reminder with the due amount, pause further work, offer a payment plan, then escalate to collections or small claims as a last resort."),
    ("how do I forecast cash flow", "Start with beginning cash, add expected collections by timing, subtract known payments, and roll it forward weekly — be conservative on inflows."),
    ("is it better to focus on revenue or margin", "Both, but margin first — growing unprofitable revenue just loses money faster. Fix unit economics, then scale."),
]
def gen_consult():
    return random.choice(CONSULT)

# ── sheet design: "set me up a tracker for X" -> the right columns (a coworker skill) ──
SCHEMA = {
    "accounts payable tracker": "Vendor, Invoice Number, Amount, Invoice Date, Due Date, Status, Date Paid",
    "accounts receivable tracker": "Customer, Invoice Number, Amount, Invoice Date, Due Date, Days Overdue, Status",
    "expense tracker": "Date, Category, Description, Amount, Payment Method, Receipt",
    "inventory tracker": "SKU, Product, In Stock, Reorder Point, Unit Cost, Supplier, Status",
    "project tracker": "Task, Owner, Start Date, Due Date, Status, Percent Complete, Notes",
    "sales pipeline": "Company, Contact, Deal Value, Stage, Close Date, Owner, Probability",
    "employee roster": "Name, Employee ID, Department, Role, Start Date, Salary, Status",
    "payroll register": "Employee, Hours, Rate, Gross Pay, Deductions, Net Pay, Pay Date",
    "time tracking sheet": "Date, Employee, Project, Hours, Billable, Rate",
    "budget sheet": "Category, Planned, Actual, Variance, Notes",
    "invoice log": "Invoice Number, Client, Date, Due Date, Amount, Tax, Total, Status",
    "maintenance log": "Asset, Last Service, Next Service, Cost, Technician, Status",
    "fleet tracker": "Vehicle, Mileage, Last Service, Fuel Cost, Driver, Status",
    "recruiting tracker": "Candidate, Role, Stage, Interview Date, Status, Source",
    "marketing campaign tracker": "Campaign, Channel, Budget, Spend, Leads, Conversions, ROAS",
    "support ticket log": "Ticket ID, Customer, Issue, Priority, Status, Opened, Resolved",
    "rent roll": "Property, Unit, Tenant, Rent, Lease End, Status",
    "donation tracker": "Donor, Date, Amount, Campaign, Method, Acknowledged",
    "grant tracker": "Grant, Funder, Amount, Start Date, End Date, Spent, Report Due",
    "commission tracker": "Rep, Sales, Quota, Attainment, Commission Rate, Commission",
    "cash flow sheet": "Month, Beginning Cash, Inflows, Outflows, Ending Cash",
    "kpi dashboard": "Metric, Target, Actual, Variance, Status",
    "asset register": "Asset, Purchase Date, Cost, Depreciation, Book Value, Location",
    "vendor list": "Vendor, Contact, Category, Contract End, Rating, Annual Spend",
    "purchase order log": "PO Number, Vendor, Item, Quantity, Unit Price, Total, Status",
    "shipment tracker": "Order, Carrier, Tracking Number, Ship Date, Delivery Date, Status",
    "production log": "Batch, Product, Quantity, Start, End, Defects, Status",
    "quality inspection log": "Inspection, Product, Date, Inspector, Result, Defects, Action",
    "gradebook": "Student, Assignment, Score, Max Score, Percent, Grade",
    "attendance sheet": "Date, Name, Status, Time In, Time Out, Hours",
    "event guest list": "Guest, RSVP, Table, Meal, Plus One, Checked In",
    "patient log": "Patient, Date of Birth, Visit Date, Provider, Diagnosis, Billed, Insurance",
    "subscription tracker": "Customer, Plan, MRR, Start Date, Renewal Date, Status",
    "contract tracker": "Party, Type, Start Date, End Date, Value, Renewal, Status",
    "loan amortization sheet": "Period, Payment, Interest, Principal, Balance",
    "risk register": "Risk, Likelihood, Impact, Score, Owner, Mitigation, Status",
    "content calendar": "Date, Title, Channel, Author, Status, Performance",
    "warehouse bin sheet": "SKU, Location, Quantity, Received, Picked, Status",
    "petty cash log": "Date, Description, Cash In, Cash Out, Balance",
    "mileage log": "Date, Start, Destination, Miles, Purpose, Rate",
}
def gen_schema():
    t = random.choice(list(SCHEMA))
    return random.choice([f"what columns should a {t} have", f"set me up a {t}, what fields do I need",
                          f"what should a {t} include", f"design a {t}"]), SCHEMA[t]

# ── weighted task mix (easy to extend; "formula" is the core branch) ──
MODES = [
    (40, "formula"), (6, gen_spanish), (8, gen_lang), (5, gen_explain), (5, gen_fix), (5, gen_edit),
    (3, gen_chart), (3, gen_format), (3, gen_clean), (2.5, gen_model), (2.5, gen_action),
    (2, gen_steps), (3, gen_transpile), (2, gen_reverse), (2, gen_optimize),
    (2, gen_audit), (2, gen_nlsql), (2.5, gen_debug), (2, gen_absref), (1.5, gen_doc),
    (2, gen_solve), (2, gen_fromex), (2, gen_rules), (2, gen_howto),
    (2, gen_chartrec), (1.5, gen_script), (1.5, gen_keyboard), (1.5, gen_vba),
    (1.5, gen_gendata), (2, gen_unittest), (1.5, gen_datadict),
    # ── understand-&-fix expansion: formula refactoring / comprehension ──
    (2, gen_modernize), (1.5, gen_adderror), (1, gen_striperror), (1.5, gen_reflock),
    (1, gen_r1c1), (1, gen_locale), (1.5, gen_dynamic), (1.5, gen_evaluate),
    # ── data-grounded reasoning: read an inline table and answer from the values ──
    (5, gen_dataground),
    # ── harder formulas + business-domain depth (accounting / FP&A) ──
    (4, gen_hard), (4, gen_domain),
    # ── accounting coworker: advice / concepts / consulting (talk, not just compute) ──
    (4, gen_advise), (5, gen_concept), (5, gen_consult),
    # ── industry KPI vocabulary (120+ business functions -> the right metric) ──
    (6, gen_kpi),
    # ── sheet design: set up a domain tracker with the right columns ──
    (4, gen_schema),
]
_MODE_FNS = [f for _, f in MODES]
_MODE_WTS = [w for w, _ in MODES]
def sample():
    fn = random.choices(_MODE_FNS, weights=_MODE_WTS)[0]
    if fn == "formula":
        _, q, a = gen(); return q, a
    return fn()

if __name__ == "__main__":
    with open("excel.txt", "w", encoding="utf-8") as f:
        for _ in range(N):
            q, a = sample()
            f.write(f"Q: {q}\nA: {a}\n\n")
    print(f"wrote {N} examples to excel.txt  ({len(G)} formula types + explain + fix-it)")
