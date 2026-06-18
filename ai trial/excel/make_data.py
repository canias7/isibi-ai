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
    if r < 0.18:
        return random.choice(["remove duplicate rows", "delete duplicates", "drop duplicate rows"]), \
               "CLEAN op=dedupe"
    if r < 0.34:
        _, nm = random.choice(DELIMS)
        return random.choice([f"split {h} into separate columns by the {nm}", f"split the {h} column on the {nm}"]), \
               f"CLEAN op=split col={h} by={nm.replace(' ', '')}"
    if r < 0.50:
        v = random.choice(["0", "n/a", word()])
        return random.choice([f"fill blank cells in {h} with {v}", f"replace empties in {h} with {v}"]), \
               f"CLEAN op=fillblanks col={h} value={v}"
    if r < 0.62:
        return random.choice([f"trim extra spaces in {h}", f"remove extra spaces from {h}"]), \
               f"CLEAN op=trim col={h}"
    if r < 0.74:
        return random.choice([f"convert {h} to numbers", f"turn the text in {h} into numbers"]), \
               f"CLEAN op=tonumber col={h}"
    if r < 0.86:
        op, wrd = random.choice([("upper", "uppercase"), ("lower", "lowercase"), ("proper", "capitalize")])
        return random.choice([f"make {h} {wrd}", f"{wrd} the {h} column"]), f"CLEAN op={op} col={h}"
    a, b = random.sample(WORDS, 2)
    return random.choice([f"replace {a} with {b} in {h}", f"change all {a} to {b} in {h}"]), \
           f"CLEAN op=replace col={h} find={a} with={b}"

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

def gen_spanish():
    return random.choice(SPANISH)()

# ── finance pack: intent -> a MODEL spec; the add-in stamps the block of cells ──
def gen_model():
    r = random.random()
    if r < 0.22:
        q = random.choice(["build a ratio analysis", "calculate the key financial ratios",
                           "show liquidity and profitability ratios", "make a financial ratios block",
                           "build the standard financial ratios"])
        return q, "MODEL type=ratios"
    if r < 0.40:
        a = hdr1(); b = hdr1()
        q = random.choice([f"variance report of actual {a} versus budget {b}",
                           f"build a budget variance for {a} vs {b}",
                           f"actual {a} vs budget {b} with variance"])
        return q, f"MODEL type=variance actual={a} budget={b}"
    if r < 0.55:
        a = hdr1()
        q = random.choice([f"build an aging report for {a}", f"AR aging of {a}", f"age {a} into buckets"])
        return q, f"MODEL type=aging amount={a} date=date"
    if r < 0.72:
        q = random.choice(["build a loan amortization table", "amortization schedule",
                           "build an amortization model", "loan payoff schedule"])
        return q, "MODEL type=amortization"
    if r < 0.87:
        q = random.choice(["build a break-even analysis", "break-even model", "break even calculation"])
        return q, "MODEL type=breakeven"
    q = random.choice(["build a 3-month cash flow", "monthly cash flow projection", "cash flow model"])
    return q, "MODEL type=cashflow"

# ── more sheet actions: data validation, sort, filter ──
def gen_action():
    r = random.random()
    if r < 0.35:
        c=col(); vals=random.sample(WORDS, random.randint(3,4))
        q=random.choice([f"add a dropdown of {', '.join(vals)} in {c}",
                         f"restrict {c} to {', '.join(vals)}",
                         f"data validation list of {', '.join(vals)} in column {c}"])
        return q, f"VALIDATE col={c} type=list items={'|'.join(vals)}"
    if r < 0.55:
        c=col(); a=num(); b=a+num()
        q=random.choice([f"only allow numbers between {a} and {b} in {c}",
                         f"restrict {c} to numbers from {a} to {b}"])
        return q, f"VALIDATE col={c} type=number min={a} max={b}"
    if r < 0.80:
        h=hdr1(); o=random.choice(["desc","asc"]); wo="descending" if o=="desc" else "ascending"
        q=random.choice([f"sort by {h} {wo}", f"sort the data by {h} {wo}", f"order by {h} {wo}"])
        return q, f"SORT by={h} order={o}"
    c=col(); w=word()
    q=random.choice([f"filter to show only {w} in {c}", f"show only {w} rows in {c}", f"filter {c} to {w}"])
    return q, f"FILTERVIEW col={c} value={w}"

def sample():
    r = random.random()
    if r < 0.58: _, q, a = gen(); return q, a   # English description -> formula (core)
    if r < 0.66: return gen_spanish()           # Spanish description -> formula
    if r < 0.73: return gen_explain()           # explain a formula -> plain english
    if r < 0.80: return gen_fix()               # fix a broken formula -> correct formula
    if r < 0.87: return gen_edit()              # edit an existing formula -> new formula
    if r < 0.90: return gen_chart()             # chart / pivot intent -> spec
    if r < 0.93: return gen_format()            # conditional formatting -> FORMAT spec
    if r < 0.96: return gen_clean()             # data cleaning -> CLEAN spec
    if r < 0.98: return gen_model()             # finance model -> MODEL spec
    return gen_action()                         # validation / sort / filter -> action spec

if __name__ == "__main__":
    with open("excel.txt", "w", encoding="utf-8") as f:
        for _ in range(N):
            q, a = sample()
            f.write(f"Q: {q}\nA: {a}\n\n")
    print(f"wrote {N} examples to excel.txt  ({len(G)} formula types + explain + fix-it)")
