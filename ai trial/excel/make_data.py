# make_data.py — synthesize (description -> Excel formula) training pairs.
# 100+ formula types across every category. Unlimited, clean, generated data.
# Format: "Q: <plain-english request>\nA: <excel formula>\n\n"

import os, re, random

random.seed(0)
N = int(os.environ.get("N", 200000))
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

def corrupt(f):
    r = random.random()
    if r < 0.25 and ")" in f:           # drop a closing paren
        i = f.rfind(")"); return f[:i] + f[i + 1:]
    if r < 0.45 and "," in f:           # drop a comma
        i = f.rfind(","); return f[:i] + f[i + 1:]
    if r < 0.60:                        # forget the leading =
        return f[1:]
    if r < 0.80 and f.count('"') >= 2:  # drop a quote
        i = f.find('"'); return f[:i] + f[i + 1:]
    i = random.randrange(1, len(f) - 1) # drop a char in the middle
    return f[:i] + f[i + 1:]
def gen_fix():
    fn = random.choice(G); desc, formula = fn()
    broken = corrupt(formula)
    if broken == formula: broken = formula[:-1]
    lead = random.choice(["fix ", "repair ", "correct ", "what's wrong with "])
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

EDIT_TEMPLATES = ["edit {o} to {i}", "change {o} so it {i}", "take {o} and {i}",
                  "{i}: {o}", "in {o}, {i}", "modify {o}: {i}"]
def gen_edit():
    o, i, new = random.choice(EDITS)()
    return random.choice(EDIT_TEMPLATES).format(o=o, i=i), new

# ── chart / pivot specs: intent -> a spec the add-in builds via Office.js ──
CHART_TYPES = ["bar", "column", "line", "pie", "scatter"]
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
    if r < 0.90:
        w = word()
        return random.choice([f"highlight {h} containing {w}", f"color {h} cells that contain {w} {color}"]), \
               f"FORMAT range={h} rule=contains:{w} color={color}"
    return random.choice([f"add a color scale to {h}", f"apply a heat map to the {h} column"]), \
           f"FORMAT range={h} rule=colorscale"

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

def gen_spanish():
    return random.choice(SPANISH)()
def gen_lang():
    return random.choice(SPANISH + PORTUGUESE + FRENCH)()

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
    def one():
        k = random.choice(["trim","upper","lower","dedupe","fillblanks","fmt","sort","filt"]); h = hdr1()
        if k=="trim":       return f"trim spaces in {h}", f"CLEAN op=trim col={h}"
        if k=="upper":      return f"uppercase {h}", f"CLEAN op=upper col={h}"
        if k=="lower":      return f"lowercase {h}", f"CLEAN op=lower col={h}"
        if k=="dedupe":     return "remove duplicate rows", "CLEAN op=dedupe"
        if k=="fillblanks": v=random.choice(["0",word()]); return f"fill blanks in {h} with {v}", f"CLEAN op=fillblanks col={h} value={v}"
        if k=="fmt":        o=opn(); n=num(); return f"highlight {h} {opw(o)} {n}", f"FORMAT range={h} rule={o}{n} color=red"
        if k=="sort":       o=random.choice(["desc","asc"]); return f"sort by {h} {'descending' if o=='desc' else 'ascending'}", f"SORT by={h} order={o}"
        w=word(); return f"filter {h} to {w}", f"FILTERVIEW col={h} value={w}"
    steps = [one() for _ in range(random.randint(2,3))]
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
]
DAX = [
    ("=SUM(A:A)", "SUM(t[A])"), ("=AVERAGE(A:A)", "AVERAGE(t[A])"),
    ("=COUNT(A:A)", "COUNT(t[A])"), ("=MAX(A:A)", "MAX(t[A])"), ("=MIN(A:A)", "MIN(t[A])"),
    ('=SUMIF(A:A,"x",B:B)', 'CALCULATE(SUM(t[B]), t[A]="x")'),
    ('=COUNTIF(A:A,"x")', 'CALCULATE(COUNTROWS(t), t[A]="x")'),
]
JS = [
    ("=SUM(A:A)", "data.reduce((s,r)=>s+r.A,0)"), ("=AVERAGE(A:A)", "data.reduce((s,r)=>s+r.A,0)/data.length"),
    ("=COUNT(A:A)", "data.length"), ("=MAX(A:A)", "Math.max(...data.map(r=>r.A))"),
    ("=MIN(A:A)", "Math.min(...data.map(r=>r.A))"), ('=IF(A1>10,"hi","lo")', "a>10?'hi':'lo'"),
    ("=ROUND(A1,2)", "Math.round(a*100)/100"), ("=LEN(A1)", "a.length"), ("=UPPER(A1)", "a.toUpperCase()"),
]
R = [
    ("=SUM(A:A)", "sum(df$A)"), ("=AVERAGE(A:A)", "mean(df$A)"), ("=COUNT(A:A)", "length(df$A)"),
    ("=MAX(A:A)", "max(df$A)"), ("=MIN(A:A)", "min(df$A)"), ("=MEDIAN(A:A)", "median(df$A)"),
    ("=STDEV(A:A)", "sd(df$A)"), ('=SUMIF(A:A,"x",B:B)', "sum(df$B[df$A=='x'])"),
]
M = [
    ("=SUM(A:A)", "List.Sum(Source[A])"), ("=AVERAGE(A:A)", "List.Average(Source[A])"),
    ("=COUNT(A:A)", "List.Count(Source[A])"), ("=MAX(A:A)", "List.Max(Source[A])"), ("=MIN(A:A)", "List.Min(Source[A])"),
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
    ("=A1*1", "=A1"), ('=A1&""&B1', "=A1&B1"),
    ("=IF(A1>0,TRUE,FALSE)", "=A1>0"),
    ("=A1/B1", "=IFERROR(A1/B1,0)"),
    ('=SUMIF(A:A,">0",A:A)', '=SUMIF(A:A,">0")'),
    ("=INDEX(B:B,MATCH(A1,C:C,0))", "=XLOOKUP(A1,C:C,B:B)"),
]
def gen_optimize():
    bad, good = random.choice(OPTIMIZE)
    return random.choice([f"optimize {bad}", f"simplify {bad}", f"improve {bad}", f"make {bad} better"]), good

# ── audit: flag issues / best-practice problems in a formula ──
AUDIT = [
    ("=A1*1.08", "hardcoded tax rate 1.08 — put it in a cell and reference it"),
    ("=A1*0.15", "hardcoded rate 0.15 — use a cell reference instead"),
    ("=SUM(OFFSET(A1,0,0,10,1))", "OFFSET is volatile and recalculates constantly — use a fixed range"),
    ("=A1/B1", "no error handling — wrap in IFERROR in case B1 is zero or blank"),
    ("=VLOOKUP(A1,B:Z,5,TRUE)", "approximate match (TRUE) can return wrong values — use FALSE for exact match"),
    ("=SUM(A:A)+5", "hardcoded +5 added to the total — reference a cell instead"),
    ("=A1+A2+A3+A4+A5", "long manual addition — use SUM(A1:A5) instead"),
]
def gen_audit():
    f, issue = random.choice(AUDIT)
    return random.choice([f"audit {f}", f"review {f}", f"any issues with {f}", f"critique {f}"]), issue

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
]
def gen_debug():
    f, err, fix = random.choice(DEBUG)
    return random.choice([f"{f} returns {err}, why?", f"why does {f} give {err}", f"{f} shows {err}, fix it"]), fix

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

# ── solve: rearrange to find the unknown ──
SOLVE = [
    ("what revenue gives {p} profit when cost is {c}", "={p}+{c}"),
    ("what price gives {m} margin on cost {c}", "={c}/(1-{m})"),
    ("what quantity at price {p} reaches {t} in revenue", "={t}/{p}"),
    ("what cost leaves {p} profit from revenue {t}", "={t}-{p}"),
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
]
def gen_fromex():
    ex, f = random.choice(FROMEX)
    return random.choice([f"examples: {ex}", f"fill the pattern: {ex}", f"infer the formula: {ex}"]), f

# ── rules table -> nested formula ──
def gen_rules():
    c = cell(); w1, w2 = random.sample(WORDS, 2); a, b = random.choice([(0.1,0.05),(0.2,0.1),(0.15,0.08)])
    return f"on {c}: {w1} gives {a}, {w2} gives {b}, otherwise 0", f'=IFS({c}="{w1}",{a},{c}="{w2}",{b},TRUE,0)'

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
]
def gen_keyboard():
    q, a = random.choice(KEYS)
    return random.choice([f"shortcut to {q}", f"keyboard shortcut to {q}", f"hotkey to {q}"]), a

# ── VBA macros ──
VBA = [
    ("bold the header row", "Rows(1).Font.Bold = True"), ("autofit columns", "Columns.AutoFit"),
    ("clear the sheet", "ActiveSheet.UsedRange.Clear"), ("show a message box", 'MsgBox "done"'),
    ("turn off screen updating", "Application.ScreenUpdating = False"),
]
def gen_vba():
    q, a = random.choice(VBA)
    return random.choice([f"vba to {q}", f"a vba macro to {q}", f"vba code to {q}"]), a

# ── generate sample data -> GENDATA spec ──
def gen_gendata():
    n = random.choice([10, 20, 50, 100])
    cs = random.sample(["region", "product", "amount", "date", "customer", "status", "price", "quantity"], random.randint(2, 4))
    return random.choice([f"generate {n} rows of sample {cs[0]} data", f"make {n} rows of fake data with {', '.join(cs)}",
                          f"create {n} sample rows of {', '.join(cs)}"]), f"GENDATA rows={n} cols={','.join(cs)}"

# ── spreadsheet unit test (assertion) ──
def gen_unittest():
    c = cell(); n = num()
    return random.choice([f"assert {c} equals {n}", f"test that {c} is {n}", f"check {c} equals {n}"]), f"=({c}={n})"

# ── data dictionary ──
def gen_datadict():
    cs = random.sample(["revenue", "cost", "region", "date", "customer", "quantity", "status", "price"], 3)
    return random.choice([f"data dictionary for {', '.join(cs)}", f"document the columns {', '.join(cs)}"]), \
           "; ".join(f"{c}: the {c} for each row" for c in cs)

# ── weighted task mix (easy to extend; "formula" is the core branch) ──
MODES = [
    (40, "formula"), (6, gen_spanish), (5, gen_explain), (5, gen_fix), (5, gen_edit),
    (3, gen_chart), (3, gen_format), (3, gen_clean), (2.5, gen_model), (2.5, gen_action),
    (2, gen_steps), (2, gen_transpile), (1.5, gen_reverse), (1.5, gen_optimize),
    (1.5, gen_audit), (1.5, gen_nlsql), (2, gen_debug), (2, gen_absref), (1.5, gen_doc),
    (1.5, gen_solve), (2, gen_fromex), (1.5, gen_rules), (1.5, gen_howto),
    (1.5, gen_chartrec), (1.5, gen_script), (1.5, gen_keyboard), (1.5, gen_vba),
    (1.5, gen_gendata), (1.5, gen_unittest), (1.5, gen_datadict),
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
