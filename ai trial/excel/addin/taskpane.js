// taskpane.js — the bot's brain inside Excel.
//  1. read the active cell's current formula (so a request can EDIT it)
//  2. send text (or "edit <formula> to <text>") to the model API (serve.py :8000)
//  3. route the answer:
//       =FORMULA   -> sheet-bridge headers to ranges, write into the cell
//       CHART ...   -> build a chart via Office.js
//       PIVOT ...   -> show the spec (auto-build is next)
//       plain text  -> explanation / fix message
// The sheet bridge maps header names (e.g. "revenue") to real columns ("C:C").

const API = "http://127.0.0.1:8000/formula";
const CHART_ENUM = { bar: "barClustered", column: "columnClustered",
                     line: "line", pie: "pie", scatter: "xyScatter" };

Office.onReady(() => {
  document.getElementById("go").onclick = run;
  document.getElementById("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
  });
});

function setOut(html) { document.getElementById("out").innerHTML = html; }

async function run() {
  const text = document.getElementById("q").value.trim();
  if (!text) return;
  setOut('<span class="muted">thinking…</span>');

  // 1. read the active cell's current formula (enables "edit this formula")
  let current = "";
  try {
    await Excel.run(async (ctx) => {
      const cell = ctx.workbook.getActiveCell();
      cell.load("formulas");
      await ctx.sync();
      const v = cell.formulas[0][0];
      if (typeof v === "string" && v.startsWith("=")) current = v;
    });
  } catch (e) { /* no cell / no formula — treat as a fresh request */ }

  // 2. if the cell already holds a formula, this is an edit; else a new request
  const prompt = current ? `edit ${current} to ${text}` : text;

  // 3. ask the model
  let result;
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: prompt }),
    });
    result = (await r.json()).result;
  } catch (e) {
    setOut('<span class="err">Can\'t reach the model API. Is <code>serve.py</code> running on :8000?</span>');
    return;
  }
  if (!result) { setOut('<span class="err">empty response</span>'); return; }

  // 4. route by output type
  if (result.startsWith("STEPS")) return applySteps(result);
  if (result.startsWith("CHART")) return buildChart(result);
  if (result.startsWith("PIVOT")) {
    setOut(`<div class="formula">${escapeHtml(result)}</div><div class="muted">pivot spec (auto-build coming next)</div>`);
    return;
  }
  if (result.startsWith("FORMAT")) return applyFormat(result);
  if (result.startsWith("CLEAN")) return applyClean(result);
  if (result.startsWith("MODEL")) return applyModel(result);
  if (result.startsWith("VALIDATE")) return applyValidate(parseSpec(result));
  if (result.startsWith("SORT")) return applySort(parseSpec(result));
  if (result.startsWith("FILTERVIEW")) return applyFilter(parseSpec(result));
  if (!result.startsWith("=")) { setOut(escapeHtml(result)); return; }  // explain / fix text

  // 5. a formula: bridge header names -> ranges, write it, and READ BACK the answer
  try {
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const used = sheet.getUsedRangeOrNullObject();
      used.load("values,columnIndex,isNullObject");
      await ctx.sync();

      const headerMap = used.isNullObject ? {} : buildHeaderMap(used);
      const finalFormula = applyBridge(result, headerMap);

      const cell = ctx.workbook.getActiveCell();
      cell.formulas = [[finalFormula]];
      cell.load("values");                 // ask-your-data: read the computed result
      await ctx.sync();

      const val = cell.values[0][0];
      const answer = (val !== "" && val != null && !String(val).startsWith("#"))
        ? `<div class="answer">= ${escapeHtml(String(val))}</div>` : "";
      const note = finalFormula !== result
        ? `<div class="muted" style="margin-top:6px">from ${escapeHtml(result)}</div>` : "";
      setOut(`<div class="formula">${escapeHtml(finalFormula)}</div>${answer}${note}`);
    });
  } catch (e) {
    setOut('<span class="err">Couldn\'t write to the cell: ' + escapeHtml(e.message) + "</span>");
  }
}

// "CHART type=bar values=sales category=region" -> build it from the matching columns
async function buildChart(spec) {
  const m = parseSpec(spec);
  const want = CHART_ENUM[(m.type || "bar").toLowerCase()] || "columnClustered";
  try {
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const used = sheet.getUsedRangeOrNullObject();
      used.load("columnIndex,rowCount,values,isNullObject");
      await ctx.sync();
      if (used.isNullObject) return setOut('<span class="err">No data on the sheet to chart.</span>');

      const hm = buildHeaderMap(used);
      const vCol = hm[(m.values || "").toLowerCase()];
      const cCol = hm[(m.category || "").toLowerCase()];
      if (!vCol || !cCol)
        return setOut('<span class="err">Couldn\'t match those columns to your headers.</span>');

      const lo = Math.min(letterToIdx(cCol), letterToIdx(vCol));
      const hi = Math.max(letterToIdx(cCol), letterToIdx(vCol));
      const range = sheet.getRange(`${colLetter(lo)}1:${colLetter(hi)}${used.rowCount}`);
      const chart = sheet.charts.add(Excel.ChartType[want], range, Excel.ChartSeriesBy.columns);
      chart.title.text = `${m.values} by ${m.category}`;
      await ctx.sync();
      setOut(`<div class="formula">${escapeHtml(spec)}</div><div class="muted">created ${escapeHtml(m.type)} chart</div>`);
    });
  } catch (e) {
    setOut('<span class="err">Chart failed: ' + escapeHtml(e.message) + "</span>");
  }
}

// "FORMAT range=sales rule=>100 color=red" -> conditional formatting via Office.js
const FILL = { red: "#FFC7CE", green: "#C6EFCE", yellow: "#FFEB9C", orange: "#FFD966", blue: "#BDD7EE" };
async function applyFormat(spec) {
  const m = parseSpec(spec);
  const rule = m.rule || "";
  const fill = FILL[(m.color || "red").toLowerCase()] || "#FFC7CE";
  try {
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const used = sheet.getUsedRangeOrNullObject();
      used.load("values,columnIndex,isNullObject");
      await ctx.sync();
      const hm = used.isNullObject ? {} : buildHeaderMap(used);
      const col = hm[(m.range || "").toLowerCase()] || (m.range || "").toUpperCase();
      const range = sheet.getRange(`${col}:${col}`);
      if (rule === "duplicate") {
        const cf = range.conditionalFormats.add(Excel.ConditionalFormatType.presetCriteria);
        cf.preset.rule = { criterion: Excel.ConditionalFormatPresetCriterion.duplicateValues };
        cf.preset.format.fill.color = fill;
      } else if (rule === "colorscale") {
        const cf = range.conditionalFormats.add(Excel.ConditionalFormatType.colorScale);
        cf.colorScale.criteria = {
          minimum: { type: Excel.ConditionalFormatColorCriterionType.lowestValue, color: "#FFFFFF" },
          maximum: { type: Excel.ConditionalFormatColorCriterionType.highestValue, color: "#63BE7B" },
        };
      } else if (rule.startsWith("top")) {
        const k = parseInt(rule.slice(3), 10) || 10;
        const cf = range.conditionalFormats.add(Excel.ConditionalFormatType.topBottom);
        cf.topBottom.rule = { type: Excel.ConditionalTopBottomCriterionType.topItems, rank: k };
        cf.topBottom.format.fill.color = fill;
      } else if (rule.startsWith("contains:")) {
        const cf = range.conditionalFormats.add(Excel.ConditionalFormatType.containsText);
        cf.textComparison.rule = { operator: Excel.ConditionalTextOperator.contains, text: rule.slice(9) };
        cf.textComparison.format.fill.color = fill;
      } else {
        const mm = rule.match(/^(>=|<=|>|<)(-?\d+)$/);
        if (!mm) return setOut('<span class="err">Unknown format rule: ' + escapeHtml(rule) + "</span>");
        const ops = { ">": "greaterThan", "<": "lessThan", ">=": "greaterThanOrEqual", "<=": "lessThanOrEqual" };
        const cf = range.conditionalFormats.add(Excel.ConditionalFormatType.cellValue);
        cf.cellValue.rule = { formula1: mm[2], operator: ops[mm[1]] };
        cf.cellValue.format.fill.color = fill;
      }
      await ctx.sync();
      setOut(`<div class="formula">${escapeHtml(spec)}</div><div class="muted">applied to ${escapeHtml(col)}</div>`);
    });
  } catch (e) {
    setOut('<span class="err">Format failed: ' + escapeHtml(e.message) + "</span>");
  }
}

// "CLEAN op=trim col=sales" -> run the cleaning op via Office.js
async function applyClean(spec) {
  const m = parseSpec(spec);
  const op = m.op;
  try {
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const used = sheet.getUsedRangeOrNullObject();
      used.load("columnIndex,columnCount,rowIndex,rowCount,values,isNullObject");
      await ctx.sync();
      if (used.isNullObject) return setOut('<span class="err">No data on the sheet.</span>');

      if (op === "dedupe") {
        used.removeDuplicates([], true);
        await ctx.sync();
        return setOut('<div class="muted">removed duplicate rows</div>');
      }
      if (op === "split") {
        return setOut(`<div class="formula">${escapeHtml(spec)}</div><div class="muted">split is best-effort; coming next</div>`);
      }

      const hm = buildHeaderMap(used);
      const letter = hm[(m.col || "").toLowerCase()] || (m.col || "").toUpperCase();
      const ci = letterToIdx(letter) - used.columnIndex;
      if (ci < 0 || ci >= used.columnCount) return setOut('<span class="err">Column not found.</span>');

      const body = sheet.getRangeByIndexes(used.rowIndex + 1, used.columnIndex + ci, used.rowCount - 1, 1);
      body.load("values");
      await ctx.sync();

      const tx = {
        trim:       (v) => String(v).replace(/\s+/g, " ").trim(),
        upper:      (v) => String(v).toUpperCase(),
        lower:      (v) => String(v).toLowerCase(),
        proper:     (v) => String(v).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
        tonumber:   (v) => (v === "" || isNaN(Number(v)) ? v : Number(v)),
        fillblanks: (v) => (v === "" || v == null ? coerce(m.value) : v),
        replace:    (v) => (String(v) === m.find ? coerce(m.with) : v),
      };
      const f = tx[op];
      if (!f) return setOut('<span class="err">Unknown clean op: ' + escapeHtml(op) + "</span>");
      body.values = body.values.map((row) => [f(row[0])]);
      await ctx.sync();
      setOut(`<div class="formula">${escapeHtml(spec)}</div><div class="muted">cleaned ${escapeHtml(letter)} (${escapeHtml(op)})</div>`);
    });
  } catch (e) {
    setOut('<span class="err">Clean failed: ' + escapeHtml(e.message) + "</span>");
  }
}
function coerce(v) { return v == null ? "" : (/^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : v); }

// "MODEL type=ratios" / "MODEL type=variance actual=revenue budget=budget" -> stamp a block
async function applyModel(spec) {
  const m = parseSpec(spec);
  try {
    if (m.type === "ratios")        return await buildRatios();
    if (m.type === "variance")      return await buildVariance(m);
    if (m.type === "aging")         return await buildAging(m);
    if (m.type === "amortization")  return await buildAmortization();
    if (m.type === "breakeven")     return await buildBreakeven();
    if (m.type === "cashflow")      return await buildCashflow();
    // model types without a dedicated builder yet — show the spec rather than erroring
    setOut(`<div class="formula">${escapeHtml(spec)}</div><div class="muted">${escapeHtml(m.type || "")} model — builder coming soon</div>`);
  } catch (e) {
    setOut('<span class="err">Model build failed: ' + escapeHtml(e.message) + "</span>");
  }
}

// self-contained ratio model: labeled input cells + ratio formulas that reference them
async function buildRatios() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex");
    await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex;
    const valCol = colLetter(c0 + 1);
    const grid = [["Financial Ratios", ""], ["Inputs", ""]];
    const rowOf = {};
    ["Current Assets","Current Liabilities","Inventory","Revenue","Gross Profit",
     "Net Income","Equity","Total Assets","Total Debt"].forEach((name) => {
      rowOf[name] = r0 + grid.length + 1; grid.push([name, ""]);   // 1-based row of its value cell
    });
    const v = (n) => valCol + rowOf[n];
    grid.push(["Ratios", ""]);
    [["Current Ratio", `=${v("Current Assets")}/${v("Current Liabilities")}`],
     ["Quick Ratio", `=(${v("Current Assets")}-${v("Inventory")})/${v("Current Liabilities")}`],
     ["Gross Margin", `=${v("Gross Profit")}/${v("Revenue")}`],
     ["Net Margin", `=${v("Net Income")}/${v("Revenue")}`],
     ["Return on Equity", `=${v("Net Income")}/${v("Equity")}`],
     ["Return on Assets", `=${v("Net Income")}/${v("Total Assets")}`],
     ["Debt to Equity", `=${v("Total Debt")}/${v("Equity")}`]].forEach((row) => grid.push(row));
    start.getResizedRange(grid.length - 1, 1).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a ratio model — fill the input cells, ratios compute</div>');
  });
}

async function buildVariance(m) {
  await Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const used = sheet.getUsedRangeOrNullObject();
    used.load("values,columnIndex,isNullObject");
    await ctx.sync();
    const hm = used.isNullObject ? {} : buildHeaderMap(used);
    const a = hm[(m.actual || "").toLowerCase()] || (m.actual || "").toUpperCase();
    const b = hm[(m.budget || "").toLowerCase()] || (m.budget || "").toUpperCase();
    const grid = [
      ["Metric", "Value"],
      ["Actual", `=SUM(${a}:${a})`],
      ["Budget", `=SUM(${b}:${b})`],
      ["Variance", `=SUM(${a}:${a})-SUM(${b}:${b})`],
      ["Variance %", `=(SUM(${a}:${a})-SUM(${b}:${b}))/SUM(${b}:${b})`],
    ];
    ctx.workbook.getActiveCell().getResizedRange(grid.length - 1, 1).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a variance summary</div>');
  });
}

async function buildAging(m) {
  await Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const used = sheet.getUsedRangeOrNullObject();
    used.load("values,columnIndex,isNullObject");
    await ctx.sync();
    const hm = used.isNullObject ? {} : buildHeaderMap(used);
    const amt = hm[(m.amount || "").toLowerCase()] || (m.amount || "").toUpperCase();
    const dt = hm[(m.date || "").toLowerCase()] || (m.date || "").toUpperCase();
    const grid = [
      ["Aging Bucket", "Amount"],
      ["0-30",  `=SUMIFS(${amt}:${amt},${dt}:${dt},">="&(TODAY()-30))`],
      ["31-60", `=SUMIFS(${amt}:${amt},${dt}:${dt},"<"&(TODAY()-30),${dt}:${dt},">="&(TODAY()-60))`],
      ["61-90", `=SUMIFS(${amt}:${amt},${dt}:${dt},"<"&(TODAY()-60),${dt}:${dt},">="&(TODAY()-90))`],
      ["90+",   `=SUMIFS(${amt}:${amt},${dt}:${dt},"<"&(TODAY()-90))`],
    ];
    ctx.workbook.getActiveCell().getResizedRange(grid.length - 1, 1).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built an aging report</div>');
  });
}

// loan amortization: input cells + a 12-period schedule whose rows chain off each other
async function buildAmortization() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex");
    await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex, Lc = colLetter(c0 + 1);
    const grid = [["Loan Amortization", "", "", "", ""]];
    const rowOf = {};
    ["Loan Amount", "Annual Rate", "Years"].forEach((n) => { rowOf[n] = r0 + grid.length + 1; grid.push([n, "", "", "", ""]); });
    const amt = Lc + rowOf["Loan Amount"], rate = Lc + rowOf["Annual Rate"], yrs = Lc + rowOf["Years"];
    rowOf.pmt = r0 + grid.length + 1;
    grid.push(["Monthly Payment", `=PMT(${rate}/12,${yrs}*12,-${amt})`, "", "", ""]);
    const pmt = Lc + rowOf.pmt;
    grid.push(["", "", "", "", ""]);
    grid.push(["Period", "Payment", "Interest", "Principal", "Balance"]);
    const PM = colLetter(c0 + 1), I = colLetter(c0 + 2), PR = colLetter(c0 + 3), B = colLetter(c0 + 4);
    for (let p = 1; p <= 12; p++) {
      const sr = r0 + grid.length + 1;
      const prevBal = p === 1 ? amt : `${B}${sr - 1}`;
      grid.push([p, `=${pmt}`, `=${prevBal}*${rate}/12`, `=${PM}${sr}-${I}${sr}`, `=${prevBal}-${PR}${sr}`]);
    }
    start.getResizedRange(grid.length - 1, 4).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built an amortization model — fill Loan Amount, Annual Rate, Years</div>');
  });
}

// break-even: input cells + contribution margin / units / revenue
async function buildBreakeven() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex");
    await ctx.sync();
    const r0 = start.rowIndex, v = colLetter(start.columnIndex + 1);
    const grid = [["Break-Even Analysis", ""], ["Inputs", ""]];
    const rowOf = {};
    ["Fixed Costs", "Price per Unit", "Variable Cost per Unit"].forEach((n) => { rowOf[n] = r0 + grid.length + 1; grid.push([n, ""]); });
    const cm = `(${v}${rowOf["Price per Unit"]}-${v}${rowOf["Variable Cost per Unit"]})`;
    grid.push(["Results", ""]);
    grid.push(["Contribution Margin", `=${cm}`]);
    grid.push(["Break-Even Units", `=${v}${rowOf["Fixed Costs"]}/${cm}`]);
    grid.push(["Break-Even Revenue", `=${v}${rowOf["Fixed Costs"]}/${cm}*${v}${rowOf["Price per Unit"]}`]);
    start.getResizedRange(grid.length - 1, 1).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a break-even model — fill the inputs</div>');
  });
}

// 3-month cash flow: revenue/COGS/opex inputs + a Net row formula per month
async function buildCashflow() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex");
    await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex;
    const m1 = colLetter(c0 + 1), m2 = colLetter(c0 + 2), m3 = colLetter(c0 + 3);
    const grid = [
      ["Cash Flow", "Month 1", "Month 2", "Month 3"],
      ["Revenue", "", "", ""],
      ["COGS", "", "", ""],
      ["Operating Expenses", "", "", ""],
    ];
    const rev = r0 + 2, cogs = r0 + 3, opex = r0 + 4;
    grid.push(["Net Cash Flow",
      `=${m1}${rev}-${m1}${cogs}-${m1}${opex}`,
      `=${m2}${rev}-${m2}${cogs}-${m2}${opex}`,
      `=${m3}${rev}-${m3}${cogs}-${m3}${opex}`]);
    start.getResizedRange(grid.length - 1, 3).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a 3-month cash flow — fill revenue / COGS / expenses</div>');
  });
}

// "VALIDATE col=E type=list items=north|south|east" -> data-validation dropdown / number rule
async function applyValidate(m) {
  try {
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const used = sheet.getUsedRangeOrNullObject();
      used.load("values,columnIndex,isNullObject");
      await ctx.sync();
      const hm = used.isNullObject ? {} : buildHeaderMap(used);
      const col = hm[(m.col || "").toLowerCase()] || (m.col || "").toUpperCase();
      const range = sheet.getRange(`${col}:${col}`);
      if (m.type === "list") {
        range.dataValidation.rule = { list: { inCellDropDown: true, source: (m.items || "").replace(/\|/g, ",") } };
      } else {
        range.dataValidation.rule = { wholeNumber: { formula1: m.min, formula2: m.max, operator: Excel.DataValidationOperator.between } };
      }
      await ctx.sync();
      setOut('<div class="muted">added validation to ' + escapeHtml(col) + "</div>");
    });
  } catch (e) { setOut('<span class="err">Validation failed: ' + escapeHtml(e.message) + "</span>"); }
}

// "SORT by=sales order=desc" -> sort the used range by that column
async function applySort(m) {
  try {
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const used = sheet.getUsedRangeOrNullObject();
      used.load("values,columnIndex,isNullObject");
      await ctx.sync();
      if (used.isNullObject) return setOut('<span class="err">No data to sort.</span>');
      const hm = buildHeaderMap(used);
      const col = hm[(m.by || "").toLowerCase()] || (m.by || "").toUpperCase();
      const keyIndex = letterToIdx(col) - used.columnIndex;
      used.sort.apply([{ key: keyIndex, ascending: m.order !== "desc" }], false, true);
      await ctx.sync();
      setOut('<div class="muted">sorted by ' + escapeHtml(m.by) + " " + escapeHtml(m.order || "asc") + "</div>");
    });
  } catch (e) { setOut('<span class="err">Sort failed: ' + escapeHtml(e.message) + "</span>"); }
}

// "FILTERVIEW col=status value=paid" -> autofilter to show only matching rows
async function applyFilter(m) {
  try {
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const used = sheet.getUsedRangeOrNullObject();
      used.load("values,columnIndex,isNullObject");
      await ctx.sync();
      if (used.isNullObject) return setOut('<span class="err">No data to filter.</span>');
      const hm = buildHeaderMap(used);
      const col = hm[(m.col || "").toLowerCase()] || (m.col || "").toUpperCase();
      const keyIndex = letterToIdx(col) - used.columnIndex;
      sheet.autoFilter.apply(used, keyIndex, { filterOn: Excel.FilterOn.values, values: [m.value] });
      await ctx.sync();
      setOut('<div class="muted">filtered ' + escapeHtml(m.col) + " to " + escapeHtml(m.value) + "</div>");
    });
  } catch (e) { setOut('<span class="err">Filter failed: ' + escapeHtml(e.message) + "</span>"); }
}

// "STEPS CLEAN op=trim col=A ; FORMAT range=A rule=>100 color=red ; SORT by=A order=desc"
// -> run each action in sequence (the automate tier; reuses the existing handlers)
async function applySteps(spec) {
  const parts = spec.replace(/^STEPS\s*/, "").split(" ; ").map((s) => s.trim()).filter(Boolean);
  try {
    for (const s of parts) {
      if (s.startsWith("CLEAN")) await applyClean(s);
      else if (s.startsWith("FORMAT")) await applyFormat(s);
      else if (s.startsWith("SORT")) await applySort(parseSpec(s));
      else if (s.startsWith("FILTERVIEW")) await applyFilter(parseSpec(s));
    }
    setOut(`<div class="formula">${escapeHtml(spec)}</div><div class="muted">ran ${parts.length} steps</div>`);
  } catch (e) {
    setOut('<span class="err">Steps failed: ' + escapeHtml(e.message) + "</span>");
  }
}

function parseSpec(spec) {
  const out = {};
  spec.replace(/^(CHART|PIVOT|FORMAT|CLEAN|MODEL|VALIDATE|SORT|FILTERVIEW)\s*/, "").split(/\s+/).forEach((tok) => {
    const i = tok.indexOf("=");
    if (i > 0) out[tok.slice(0, i)] = tok.slice(i + 1);
  });
  return out;
}

// Build { headerLower: "C", ... } from the first row of the used range.
function buildHeaderMap(used) {
  const map = {};
  const row0 = (used.values && used.values[0]) || [];
  for (let j = 0; j < row0.length; j++) {
    const h = String(row0[j]).trim().toLowerCase();
    if (h) map[h] = colLetter(used.columnIndex + j);
  }
  return map;
}

// Replace bare header names with their column range (revenue -> C:C).
// Skips anything followed by "(" so function names (SUM, IF, ...) are never touched.
function applyBridge(formula, headerMap) {
  const names = Object.keys(headerMap).sort((a, b) => b.length - a.length); // longest first
  let out = formula;
  for (const name of names) {
    const re = new RegExp("\\b" + escapeRegex(name) + "\\b(?!\\s*\\()", "gi");
    const col = headerMap[name];
    out = out.replace(re, col + ":" + col);
  }
  return out;
}

function colLetter(idx) {            // 0 -> A, 25 -> Z, 26 -> AA
  let s = ""; idx += 1;
  while (idx > 0) { const m = (idx - 1) % 26; s = String.fromCharCode(65 + m) + s; idx = Math.floor((idx - 1) / 26); }
  return s;
}
function letterToIdx(s) {            // A -> 0, Z -> 25, AA -> 26
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeHtml(s)  { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
