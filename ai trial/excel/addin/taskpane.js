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
                     line: "line", pie: "pie", scatter: "xyScatter",
                     area: "area", doughnut: "doughnut" };

Office.onReady(() => {
  document.getElementById("go").onclick = run;
  document.getElementById("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
  });
});

function setOut(html) { document.getElementById("out").innerHTML = html; }

// Split one big request into ordered steps on explicit connectors (then / ; / newline /
// numbered lists). Conservative: never splits on bare commas, so "sum A, B, C" stays one step.
function splitSteps(text) {
  const out = [];
  for (let p of text.split(/\s*\b(?:then|after that|next)\b\s*|;|\n/i)) {
    p = (p || "").replace(/^\s*(?:and|then|also)\s+/i, "").replace(/\s*(?:,|\band\b|\balso\b)\s*$/i, "").trim();
    const numbered = p.split(/\s*\d+[.)]\s+/);
    if (numbered.length > 1) numbered.forEach((s) => s.trim() && out.push(s.trim()));
    else if (p) out.push(p);
  }
  return out;
}

async function callModel(text) {
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  return (await r.json()).result;
}

async function run() {
  const raw = document.getElementById("q").value.trim();
  if (!raw) return;
  const steps = splitSteps(raw);
  if (steps.length <= 1) return runSingle(raw);          // single request keeps "edit this cell" behavior

  // workflow: run each step in order, model called once per step (the agent loop)
  const done = [];
  const render = (cur) => setOut(
    `<div class="muted">workflow ${done.length}/${steps.length} done${cur ? " — running: " + escapeHtml(cur) : ""}</div>` +
    done.map(([s, ok]) => `<div class="${ok ? "muted" : "err"}">${ok ? "✓" : "✗"} ${escapeHtml(s)}</div>`).join("")
  );
  for (const step of steps) {
    render(step);
    let result;
    try { result = await callModel(step); }
    catch (e) { done.push([step + " (can't reach API)", false]); break; }
    if (!result) { done.push([step + " (empty response)", false]); continue; }
    try { await dispatch(result); done.push([step, true]); }
    catch (e) { done.push([step + " (" + (e.message || "failed") + ")", false]); }
  }
  render();
}

async function runSingle(text) {
  setOut('<span class="muted">thinking…</span>');
  // read the active cell's current formula (enables "edit this formula")
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
  const prompt = current ? `edit ${current} to ${text}` : text;
  let result;
  try { result = await callModel(prompt); }
  catch (e) { setOut('<span class="err">Can\'t reach the model API. Is <code>serve.py</code> running on :8000?</span>'); return; }
  if (!result) { setOut('<span class="err">empty response</span>'); return; }
  try { return await dispatch(result); }
  catch (e) { setOut('<span class="err">Couldn\'t apply that: ' + escapeHtml(e.message) + "</span>"); }
}

// route ONE model result to the right handler (used by both single + workflow paths)
async function dispatch(result) {
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
  if (result.startsWith("NUMFMT")) return applyNumfmt(parseSpec(result));
  if (result.startsWith("FREEZE")) return applyFreeze(parseSpec(result));
  if (result.startsWith("AUTOFIT")) return applyAutofit();
  if (result.startsWith("HIDECOL")) return applyHide(parseSpec(result));
  if (result.startsWith("DELETECOL")) return applyDeleteCol(parseSpec(result));
  if (result.startsWith("NAMERANGE")) return applyNameRange(parseSpec(result));
  if (result.startsWith("PROTECT")) return applyProtect(parseSpec(result));
  if (result.startsWith("GENDATA")) return applyGendata(parseSpec(result));
  if (SHEET_VERBS.has(result.split(/\s/)[0])) return applySheet(result);
  if (!result.startsWith("=")) { setOut(escapeHtml(result)); return; }  // explain / fix / advice text

  // a formula: bridge header names -> ranges, write it, and READ BACK the answer
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
      } else if (rule === "databar") {
        const cf = range.conditionalFormats.add(Excel.ConditionalFormatType.dataBar);
        cf.dataBar.positiveFormat.fillColor = COLOR[(m.color || "blue").toLowerCase()] || "#0070C0";
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
      if (op === "delblankrows") {
        for (let i = used.rowCount - 1; i >= 0; i--) {
          if (used.values[i].every((c) => c === "" || c == null))
            sheet.getRangeByIndexes(used.rowIndex + i, 0, 1, used.columnIndex + used.columnCount).delete(Excel.DeleteShiftDirection.up);
        }
        await ctx.sync();
        return setOut('<div class="muted">removed blank rows</div>');
      }

      const hm = buildHeaderMap(used);
      const letter = hm[(m.col || "").toLowerCase()] || (m.col || "").toUpperCase();
      const ci = letterToIdx(letter) - used.columnIndex;
      if (ci < 0 || ci >= used.columnCount) return setOut('<span class="err">Column not found.</span>');

      const body = sheet.getRangeByIndexes(used.rowIndex + 1, used.columnIndex + ci, used.rowCount - 1, 1);
      body.load("values");
      await ctx.sync();

      if (op === "filldown") {
        let last = "";
        body.values = body.values.map((row) => { if (row[0] !== "" && row[0] != null) last = row[0]; return [last]; });
        await ctx.sync();
        return setOut(`<div class="muted">filled down ${escapeHtml(letter)}</div>`);
      }

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
      if (!f) return setOut(`<div class="formula">${escapeHtml(spec)}</div><div class="muted">${escapeHtml(op)} — handler coming soon</div>`);
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
    if (m.type === "depreciation")  return await buildDepreciation();
    if (m.type === "budget")        return await buildBudget();
    if (m.type === "invoice")       return await buildInvoice();
    if (m.type === "expense")       return await buildExpense();
    if (m.type === "dcf")           return await buildDCF();
    if (m.type === "threestatement")return await buildThreeStatement();
    if (m.type === "sensitivity")   return await buildSensitivity();
    if (m.type === "scenario")      return await buildScenario();
    if (m.type === "inventory")     return await buildInventory();
    if (m.type === "dashboard")     return await buildDashboard();
    if (m.type === "montecarlo")    return await buildMonteCarlo();
    if (m.type === "commission")    return await buildCommission();
    if (m.type === "runway")        return await buildRunway();
    if (m.type === "savings")       return await buildSavings();
    if (m.type === "loancompare")   return await buildLoanCompare();
    if (m.type === "contribution")  return await buildContribution();
    if (m.type === "roi")           return await buildROI();
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

// straight-line depreciation: input cells + a 5-year schedule
async function buildDepreciation() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex, Lc = colLetter(c0 + 1);
    const grid = [["Depreciation (straight-line)", "", "", ""]];
    const rowOf = {};
    ["Cost", "Salvage", "Life (years)"].forEach((n) => { rowOf[n] = r0 + grid.length + 1; grid.push([n, "", "", ""]); });
    const cost = Lc + rowOf["Cost"], sal = Lc + rowOf["Salvage"], life = Lc + rowOf["Life (years)"];
    grid.push(["", "", "", ""]);
    grid.push(["Year", "Depreciation", "Accumulated", "Book Value"]);
    const D = colLetter(c0 + 1), AC = colLetter(c0 + 2), BV = colLetter(c0 + 3);
    for (let y = 1; y <= 5; y++) {
      const sr = r0 + grid.length + 1;
      const acc = y === 1 ? `=${D}${sr}` : `=${AC}${sr - 1}+${D}${sr}`;
      grid.push([y, `=(${cost}-${sal})/${life}`, acc, `=${cost}-${AC}${sr}`]);
    }
    start.getResizedRange(grid.length - 1, 3).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a depreciation schedule — fill Cost, Salvage, Life</div>');
  });
}

// budget tracker: categories with planned / actual / variance + total
async function buildBudget() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex;
    const P = colLetter(c0 + 1), A = colLetter(c0 + 2), V = colLetter(c0 + 3);
    const cats = ["Revenue", "COGS", "Salaries", "Rent", "Marketing", "Other"];
    const grid = [["Budget", "Planned", "Actual", "Variance"]];
    cats.forEach(() => { const sr = r0 + grid.length + 1; grid.push(["", "", "", `=${A}${sr}-${P}${sr}`]); });
    cats.forEach((c, i) => { grid[i + 1][0] = c; });
    const first = r0 + 2, last = r0 + 1 + cats.length, totSr = r0 + grid.length + 1;
    grid.push(["Total", `=SUM(${P}${first}:${P}${last})`, `=SUM(${A}${first}:${A}${last})`, `=${A}${totSr}-${P}${totSr}`]);
    start.getResizedRange(grid.length - 1, 3).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a budget tracker</div>');
  });
}

// invoice: line items (qty*price) + subtotal / tax / total
async function buildInvoice() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex;
    const Q = colLetter(c0 + 1), P = colLetter(c0 + 2), T = colLetter(c0 + 3);
    const grid = [["Item", "Qty", "Price", "Total"]];
    for (let i = 0; i < 5; i++) { const sr = r0 + grid.length + 1; grid.push(["", "", "", `=${Q}${sr}*${P}${sr}`]); }
    const first = r0 + 2, last = r0 + 6, subSr = r0 + grid.length + 1;
    grid.push(["Subtotal", "", "", `=SUM(${T}${first}:${T}${last})`]);
    const taxSr = r0 + grid.length + 1;
    grid.push(["Tax (8%)", "", "", `=${T}${subSr}*0.08`]);
    grid.push(["Total", "", "", `=${T}${subSr}+${T}${taxSr}`]);
    start.getResizedRange(grid.length - 1, 3).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built an invoice</div>');
  });
}

// expense report: date / category / amount + total
async function buildExpense() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex, AM = colLetter(c0 + 2);
    const grid = [["Date", "Category", "Amount"]];
    for (let i = 0; i < 6; i++) grid.push(["", "", ""]);
    const first = r0 + 2, last = r0 + 7;
    grid.push(["", "Total", `=SUM(${AM}${first}:${AM}${last})`]);
    start.getResizedRange(grid.length - 1, 2).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built an expense report</div>');
  });
}

// DCF: discount rate + 5 years of free cash flow, each discounted to present value, summed to NPV
async function buildDCF() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex, V = colLetter(c0 + 1);
    const grid = [["DCF Valuation", "", ""]];
    const rate = V + (r0 + grid.length + 1); grid.push(["Discount Rate", "", ""]);
    grid.push(["", "", ""]);
    grid.push(["Year", "Free Cash Flow", "Present Value"]);
    const FCF = colLetter(c0 + 1), PV = colLetter(c0 + 2);
    const pvFirst = r0 + grid.length + 1;
    for (let y = 1; y <= 5; y++) {
      const sr = r0 + grid.length + 1;
      grid.push([y, "", `=${FCF}${sr}/(1+${rate})^${y}`]);
    }
    const pvLast = r0 + grid.length;
    grid.push(["NPV", "", `=SUM(${PV}${pvFirst}:${PV}${pvLast})`]);
    start.getResizedRange(grid.length - 1, 2).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a DCF — fill the discount rate and yearly free cash flows</div>');
  });
}

// linked 3-statement: income statement -> cash flow -> balance sheet (each links to the prior)
async function buildThreeStatement() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, V = colLetter(start.columnIndex + 1);
    const grid = []; const rowOf = {};
    const add = (label, val) => { rowOf[label] = r0 + grid.length + 1; grid.push([label, val === undefined ? "" : val]); };
    grid.push(["3-Statement Model", ""]);
    grid.push(["Income Statement", ""]);
    add("Revenue"); add("COGS");
    add("Gross Profit", `=${V}${rowOf["Revenue"]}-${V}${rowOf["COGS"]}`);
    add("Operating Expenses");
    add("Net Income", `=${V}${rowOf["Gross Profit"]}-${V}${rowOf["Operating Expenses"]}`);
    grid.push(["", ""]);
    grid.push(["Cash Flow", ""]);
    add("Net Income (link)", `=${V}${rowOf["Net Income"]}`);
    add("Depreciation"); add("Change in Working Capital");
    add("Net Cash Flow", `=${V}${rowOf["Net Income (link)"]}+${V}${rowOf["Depreciation"]}-${V}${rowOf["Change in Working Capital"]}`);
    grid.push(["", ""]);
    grid.push(["Balance Sheet", ""]);
    add("Cash (link)", `=${V}${rowOf["Net Cash Flow"]}`);
    add("Other Assets");
    add("Total Assets", `=${V}${rowOf["Cash (link)"]}+${V}${rowOf["Other Assets"]}`);
    add("Liabilities");
    add("Equity", `=${V}${rowOf["Total Assets"]}-${V}${rowOf["Liabilities"]}`);
    start.getResizedRange(grid.length - 1, 1).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a linked 3-statement model — fill Revenue, COGS, OpEx, Depreciation, Other Assets, Liabilities</div>');
  });
}

// two-variable sensitivity grid: price (down) x volume (across) -> revenue, live on the input cells
async function buildSensitivity() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex;
    const prices = [10, 20, 30, 40], vols = [100, 200, 300, 400];
    const headerRow = r0 + 1;
    const grid = [["Price \\ Volume", ...vols]];
    prices.forEach((p) => {
      const rowNum = r0 + grid.length + 1;
      const priceCell = colLetter(c0) + rowNum;
      const cells = vols.map((vv, j) => `=${priceCell}*${colLetter(c0 + 1 + j)}${headerRow}`);
      grid.push([p, ...cells]);
    });
    start.getResizedRange(grid.length - 1, vols.length).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a price × volume sensitivity grid (revenue) — edit the headers to re-flex it</div>');
  });
}

// worst / base / best scenario columns with profit + margin formulas per case
async function buildScenario() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex;
    const W = colLetter(c0 + 1), B = colLetter(c0 + 2), Be = colLetter(c0 + 3);
    const grid = [["Scenario", "Worst", "Base", "Best"], ["Revenue", "", "", ""], ["Cost", "", "", ""]];
    const rev = r0 + 2, cost = r0 + 3, profitRow = r0 + grid.length + 1;
    grid.push(["Profit", `=${W}${rev}-${W}${cost}`, `=${B}${rev}-${B}${cost}`, `=${Be}${rev}-${Be}${cost}`]);
    grid.push(["Margin", `=${W}${profitRow}/${W}${rev}`, `=${B}${profitRow}/${B}${rev}`, `=${Be}${profitRow}/${Be}${rev}`]);
    start.getResizedRange(grid.length - 1, 3).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a worst / base / best scenario — fill revenue and cost per case</div>');
  });
}

// inventory tracker: stock vs reorder point with an auto REORDER/OK status
async function buildInventory() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex;
    const ST = colLetter(c0 + 2), RP = colLetter(c0 + 3);
    const grid = [["SKU", "Item", "In Stock", "Reorder Point", "Status"]];
    for (let i = 0; i < 6; i++) {
      const sr = r0 + grid.length + 1;
      grid.push(["", "", "", "", `=IF(${ST}${sr}<=${RP}${sr},"REORDER","OK")`]);
    }
    start.getResizedRange(grid.length - 1, 4).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built an inventory tracker — fill SKU, item, stock, reorder point</div>');
  });
}

// KPI dashboard: reads the sheet's numeric columns and stamps Total/Average KPIs (template if no data)
async function buildDashboard() {
  await Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const used = sheet.getUsedRangeOrNullObject();
    used.load("values,columnIndex,isNullObject");
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex");
    await ctx.sync();
    const grid = [["KPI Dashboard", "Value"]];
    if (!used.isNullObject && used.values.length > 1) {
      const hm = buildHeaderMap(used);
      const row1 = used.values[1] || [];
      const numeric = Object.keys(hm).filter((h) => typeof row1[letterToIdx(hm[h]) - used.columnIndex] === "number").slice(0, 4);
      numeric.forEach((h) => {
        const c = hm[h];
        grid.push([`Total ${h}`, `=SUM(${c}:${c})`]);
        grid.push([`Average ${h}`, `=AVERAGE(${c}:${c})`]);
      });
      const firstCol = hm[Object.keys(hm)[0]];
      if (firstCol) grid.push(["Row Count", `=COUNTA(${firstCol}:${firstCol})-1`]);
    }
    if (grid.length === 1) ["Total Revenue", "Total Cost", "Profit", "Margin %"].forEach((k) => grid.push([k, ""]));
    start.getResizedRange(grid.length - 1, 1).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a KPI dashboard from your data</div>');
  });
}

// Monte Carlo: NORM.INV(RAND(), mean, sd) trials with a P10/P50/P90 summary
async function buildMonteCarlo() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex, V = colLetter(c0 + 1);
    const grid = [["Monte Carlo Simulation", ""]];
    const mean = V + (r0 + grid.length + 1); grid.push(["Mean", ""]);
    const sd = V + (r0 + grid.length + 1); grid.push(["Std Dev", ""]);
    grid.push(["", ""]);
    grid.push(["Trial", "Result"]);
    const RES = colLetter(c0 + 1);
    const first = r0 + grid.length + 1;
    for (let i = 1; i <= 20; i++) grid.push([i, `=NORM.INV(RAND(),${mean},${sd})`]);
    const last = r0 + grid.length;
    grid.push(["", ""]);
    grid.push(["Average", `=AVERAGE(${RES}${first}:${RES}${last})`]);
    grid.push(["P10", `=PERCENTILE(${RES}${first}:${RES}${last},0.1)`]);
    grid.push(["P50", `=PERCENTILE(${RES}${first}:${RES}${last},0.5)`]);
    grid.push(["P90", `=PERCENTILE(${RES}${first}:${RES}${last},0.9)`]);
    start.getResizedRange(grid.length - 1, 1).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a Monte Carlo sim (20 trials) — fill Mean and Std Dev</div>');
  });
}

// helper: stamp a 2-column input/output block from {label: formula-or-blank} rows
async function _stampBlock(title, rows, msg) {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, V = colLetter(start.columnIndex + 1);
    const grid = [[title, ""]]; const rowOf = {};
    rows.forEach((row) => { rowOf[row[0]] = r0 + grid.length + 1; });   // pre-reserve row numbers
    rows.forEach((row) => grid.push([row[0], typeof row[1] === "function" ? row[1](rowOf, V) : (row[1] || "")]));
    start.getResizedRange(grid.length - 1, 1).formulas = grid;
    await ctx.sync();
    setOut(`<div class="muted">${msg}</div>`);
  });
}
const _v = (rowOf, V, name) => V + rowOf[name];

// tiered sales commission
async function buildCommission() {
  await _stampBlock("Commission Calculator", [
    ["Sales", ""], ["Tier 1 Rate", ""], ["Tier 2 Rate", ""], ["Tier Threshold", ""],
    ["Commission", (R, V) => `=IF(${_v(R,V,"Sales")}<=${_v(R,V,"Tier Threshold")},${_v(R,V,"Sales")}*${_v(R,V,"Tier 1 Rate")},${_v(R,V,"Tier Threshold")}*${_v(R,V,"Tier 1 Rate")}+(${_v(R,V,"Sales")}-${_v(R,V,"Tier Threshold")})*${_v(R,V,"Tier 2 Rate")})`],
  ], "built a tiered commission calculator — fill sales, rates, threshold");
}

// cash runway / burn rate
async function buildRunway() {
  await _stampBlock("Cash Runway", [
    ["Cash on Hand", ""], ["Monthly Revenue", ""], ["Monthly Expenses", ""],
    ["Net Burn", (R, V) => `=${_v(R,V,"Monthly Expenses")}-${_v(R,V,"Monthly Revenue")}`],
    ["Runway (months)", (R, V) => `=IF(${_v(R,V,"Net Burn")}>0,${_v(R,V,"Cash on Hand")}/${_v(R,V,"Net Burn")},"profitable")`],
  ], "built a cash-runway model — fill cash, revenue, expenses");
}

// savings goal: future value of monthly contributions
async function buildSavings() {
  await _stampBlock("Savings Plan", [
    ["Monthly Contribution", ""], ["Annual Rate", ""], ["Years", ""],
    ["Future Value", (R, V) => `=FV(${_v(R,V,"Annual Rate")}/12,${_v(R,V,"Years")}*12,-${_v(R,V,"Monthly Contribution")})`],
  ], "built a savings plan — fill contribution, rate, years");
}

// ROI / payback
async function buildROI() {
  await _stampBlock("ROI Calculator", [
    ["Initial Investment", ""], ["Annual Return", ""],
    ["ROI %", (R, V) => `=${_v(R,V,"Annual Return")}/${_v(R,V,"Initial Investment")}`],
    ["Payback (years)", (R, V) => `=${_v(R,V,"Initial Investment")}/${_v(R,V,"Annual Return")}`],
  ], "built an ROI calculator — fill investment and annual return");
}

// two loans side by side: monthly payment + total paid
async function buildLoanCompare() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex, A = colLetter(c0 + 1), B = colLetter(c0 + 2);
    const grid = [["Loan Comparison", "Option A", "Option B"], ["Amount", "", ""], ["Annual Rate", "", ""], ["Years", "", ""]];
    const amt = r0 + 2, rate = r0 + 3, yrs = r0 + 4, payRow = r0 + grid.length + 1;
    grid.push(["Monthly Payment", `=PMT(${A}${rate}/12,${A}${yrs}*12,-${A}${amt})`, `=PMT(${B}${rate}/12,${B}${yrs}*12,-${B}${amt})`]);
    grid.push(["Total Paid", `=${A}${payRow}*${A}${yrs}*12`, `=${B}${payRow}*${B}${yrs}*12`]);
    start.getResizedRange(grid.length - 1, 2).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a loan comparison — fill amount, rate, years per option</div>');
  });
}

// contribution margin per product
async function buildContribution() {
  await Excel.run(async (ctx) => {
    const start = ctx.workbook.getActiveCell();
    start.load("rowIndex,columnIndex"); await ctx.sync();
    const r0 = start.rowIndex, c0 = start.columnIndex, P = colLetter(c0 + 1), VC = colLetter(c0 + 2), UM = colLetter(c0 + 3);
    const grid = [["Product", "Price", "Variable Cost", "Unit Margin", "Margin %"]];
    for (let i = 0; i < 6; i++) {
      const sr = r0 + grid.length + 1;
      grid.push(["", "", "", `=${P}${sr}-${VC}${sr}`, `=${UM}${sr}/${P}${sr}`]);
    }
    start.getResizedRange(grid.length - 1, 4).formulas = grid;
    await ctx.sync();
    setOut('<div class="muted">built a contribution-margin table — fill product, price, variable cost</div>');
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
      else if (s.startsWith("NUMFMT")) await applyNumfmt(parseSpec(s));
      else if (s.startsWith("FREEZE")) await applyFreeze(parseSpec(s));
      else if (s.startsWith("AUTOFIT")) await applyAutofit();
      else if (s.startsWith("VALIDATE")) await applyValidate(parseSpec(s));
      else if (s.startsWith("NAMERANGE")) await applyNameRange(parseSpec(s));
      else if (SHEET_VERBS.has(s.split(/\s/)[0])) await applySheet(s);
    }
    setOut(`<div class="formula">${escapeHtml(spec)}</div><div class="muted">ran ${parts.length} steps</div>`);
  } catch (e) {
    setOut('<span class="err">Steps failed: ' + escapeHtml(e.message) + "</span>");
  }
}

// resolve a header name OR column letter to a column letter
async function resolveCol(ctx, colSpec) {
  const sheet = ctx.workbook.worksheets.getActiveWorksheet();
  const used = sheet.getUsedRangeOrNullObject();
  used.load("values,columnIndex,isNullObject");
  await ctx.sync();
  const hm = used.isNullObject ? {} : buildHeaderMap(used);
  return hm[(colSpec || "").toLowerCase()] || (colSpec || "").toUpperCase();
}

const NUMFMT = { currency: "$#,##0.00", percent: "0.00%", date: "mm/dd/yyyy", comma: "#,##0" };
async function applyNumfmt(m) {
  try { await Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const used = sheet.getUsedRangeOrNullObject();
    used.load("rowCount,rowIndex,columnIndex,values,isNullObject");
    await ctx.sync();
    if (used.isNullObject) return setOut('<span class="err">No data to format.</span>');
    const hm = buildHeaderMap(used);
    const letter = hm[(m.col || "").toLowerCase()] || (m.col || "").toUpperCase();
    const ci = letterToIdx(letter) - used.columnIndex;
    if (ci < 0) return setOut('<span class="err">Column not found.</span>');
    const rows = Math.max(1, used.rowCount - 1);
    const body = sheet.getRangeByIndexes(used.rowIndex + 1, used.columnIndex + ci, rows, 1);
    body.numberFormat = Array.from({ length: rows }, () => [NUMFMT[m.as] || "General"]);
    await ctx.sync();
    setOut(`<div class="muted">formatted ${escapeHtml(letter)} as ${escapeHtml(m.as)}</div>`);
  }); } catch (e) { setOut('<span class="err">Format failed: ' + escapeHtml(e.message) + "</span>"); }
}
async function applyFreeze(m) {
  try { await Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    if (m.cols) sheet.freezePanes.freezeColumns(parseInt(m.cols) || 1);
    else sheet.freezePanes.freezeRows(parseInt(m.rows) || 1);
    await ctx.sync(); setOut('<div class="muted">panes frozen</div>');
  }); } catch (e) { setOut('<span class="err">Freeze failed: ' + escapeHtml(e.message) + "</span>"); }
}
async function applyAutofit() {
  try { await Excel.run(async (ctx) => {
    ctx.workbook.worksheets.getActiveWorksheet().getUsedRange().format.autofitColumns();
    await ctx.sync(); setOut('<div class="muted">columns autofit</div>');
  }); } catch (e) { setOut('<span class="err">Autofit failed: ' + escapeHtml(e.message) + "</span>"); }
}
async function applyHide(m) {
  try { await Excel.run(async (ctx) => {
    const col = await resolveCol(ctx, m.col);
    ctx.workbook.worksheets.getActiveWorksheet().getRange(`${col}:${col}`).columnHidden = true;
    await ctx.sync(); setOut(`<div class="muted">hid column ${escapeHtml(col)}</div>`);
  }); } catch (e) { setOut('<span class="err">Hide failed: ' + escapeHtml(e.message) + "</span>"); }
}
async function applyDeleteCol(m) {
  try { await Excel.run(async (ctx) => {
    const col = await resolveCol(ctx, m.col);
    ctx.workbook.worksheets.getActiveWorksheet().getRange(`${col}:${col}`).delete(Excel.DeleteShiftDirection.left);
    await ctx.sync(); setOut(`<div class="muted">deleted column ${escapeHtml(col)}</div>`);
  }); } catch (e) { setOut('<span class="err">Delete failed: ' + escapeHtml(e.message) + "</span>"); }
}
async function applyNameRange(m) {
  try { await Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const rng = m.range ? sheet.getRange(m.range) : ctx.workbook.getSelectedRange();
    ctx.workbook.names.add(m.name || "MyRange", rng);
    await ctx.sync(); setOut(`<div class="muted">named range ${escapeHtml(m.name || "")}</div>`);
  }); } catch (e) { setOut('<span class="err">Name failed: ' + escapeHtml(e.message) + "</span>"); }
}
async function applyProtect() {
  try { await Excel.run(async (ctx) => {
    ctx.workbook.worksheets.getActiveWorksheet().protection.protect();
    await ctx.sync(); setOut('<div class="muted">sheet protected</div>');
  }); } catch (e) { setOut('<span class="err">Protect failed: ' + escapeHtml(e.message) + "</span>"); }
}
const _GD = {
  region: ["north","south","east","west"], product: ["A","B","C","D"],
  status: ["paid","open","pending","cancelled"], customer: ["Acme","Globex","Initech","Umbra","Stark","Wayne"],
  city: ["London","Paris","Tokyo","Berlin","Madrid","Lima"], country: ["US","UK","DE","FR","ES","JP"],
  category: ["Hardware","Software","Service","Supplies"], department: ["Sales","Finance","HR","IT","Ops"],
  name: ["Alex Kim","Sam Lee","Jordan Cruz","Pat Diaz","Robin Shah"],
  salesperson: ["Alex Kim","Sam Lee","Jordan Cruz","Pat Diaz"],
};
function _gdRand(a) { return a[Math.floor(Math.random() * a.length)]; }
// realistic value for a column, inferred from its name (mirrors the data-dictionary types)
function _gdValue(c) {
  const cl = c.toLowerCase();
  if (_GD[c]) return _gdRand(_GD[c]);
  if (cl === "date" || cl.endsWith("date")) return new Date(2024, Math.floor(Math.random()*12), 1 + Math.floor(Math.random()*28)).toLocaleDateString();
  if (cl.startsWith("is_") || cl.startsWith("has_") || cl === "active" || cl === "paid") return Math.random() < 0.5;
  if (cl.includes("email")) return _gdRand(["alex","sam","jordan","pat","robin"]) + "@example.com";
  if (cl.includes("phone")) return "555-0" + (100 + Math.floor(Math.random()*900));
  if (cl.includes("sku") || cl.includes("invoice") || cl.includes("code") || cl.endsWith("id")) return _gdRand(["SKU","INV","ID"]) + "-" + (1000 + Math.floor(Math.random()*9000));
  if (cl.includes("rating")) return 1 + Math.floor(Math.random()*5);
  if (["rate","pct","percent","margin","discount","growth","ratio"].some((k) => cl.includes(k))) return Math.round(Math.random()*40)/100;
  if (["qty","quantity","units","count","age"].some((k) => cl.includes(k))) return 1 + Math.floor(Math.random()*100);
  if (["price","cost","amount","total","revenue","salary","balance","value","fee","tax"].some((k) => cl.includes(k))) return Math.round((10 + Math.random()*9990)*100)/100;
  return Math.floor(Math.random()*1000);
}
async function applyGendata(m) {
  try { await Excel.run(async (ctx) => {
    const cols = (m.cols || "").split(","), rows = parseInt(m.rows) || 10;
    const grid = [cols];
    for (let i = 0; i < rows; i++) grid.push(cols.map((c) => _gdValue(c)));
    ctx.workbook.getActiveCell().getResizedRange(grid.length - 1, cols.length - 1).values = grid;
    await ctx.sync(); setOut(`<div class="muted">generated ${rows} rows × ${cols.length} cols</div>`);
  }); } catch (e) { setOut('<span class="err">Generate failed: ' + escapeHtml(e.message) + "</span>"); }
}

// catch-all for the simpler sheet actions (one Excel.run, dispatch on the verb)
const COLOR = { red: "#FF0000", green: "#00B050", yellow: "#FFFF00", orange: "#FFA500", blue: "#0070C0" };

// Verbs applySheet routes. Membership test (not a regex on the whole string) so SQL
// like "SELECT ..." or plain explain text never accidentally lands here.
const SHEET_VERBS = new Set([
  // column formatting
  "UNHIDE","WIDTH","BORDER","FILLCOLOR","FONTCOLOR","BOLD","ITALIC","UNDERLINE","STRIKE",
  "FONTSIZE","FONTNAME","ALIGN","VALIGN","WRAP","INDENT","ROTATE","SHRINKFIT","CLEAR",
  // rows
  "INSERTROW","HIDEROW","UNHIDEROW","DELETEROW","ROWHEIGHT","GROUPROWS","GROUPCOLS",
  // columns / ranges
  "INSERTCOL","MERGE","TABLE","PRINTAREA",
  // sheet-level
  "GRIDLINES","TABCOLOR","INSERTSHEET","DELETESHEET","RENAMESHEET","COPYSHEET","HIDESHEET",
  "CLEARFILTER","ORIENTATION","CALCNOW",
  // cells
  "HYPERLINK","COMMENT",
  // recognised but no clean Office.js path (handled gracefully below)
  "REFRESH","ZOOM","SHOWFORMULAS","SPLITPANES","SPARKLINE","PRECEDENTS","TEXTTOCOLS","SUBTOTAL",
]);

async function applySheet(spec) {
  const verb = spec.split(/\s/)[0];
  const m = parseSpec(spec);
  try {
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const colRange = async () => { const c = await resolveCol(ctx, m.col); return sheet.getRange(`${c}:${c}`); };
      const rowRange = () => sheet.getRange(`${m.row}:${m.row}`);
      let handled = true;
      // ── column formatting ──
      if (verb === "UNHIDE") (await colRange()).columnHidden = false;
      else if (verb === "WIDTH") (await colRange()).format.columnWidth = parseInt(m.px) || 100;
      else if (verb === "BORDER") { const r = await colRange(); ["EdgeTop","EdgeBottom","EdgeLeft","EdgeRight","InsideHorizontal","InsideVertical"].forEach((e) => { r.format.borders.getItem(e).style = Excel.BorderLineStyle.continuous; }); }
      else if (verb === "FILLCOLOR") (await colRange()).format.fill.color = COLOR[m.color] || "#FFFF00";
      else if (verb === "FONTCOLOR") (await colRange()).format.font.color = COLOR[m.color] || "#FF0000";
      else if (verb === "BOLD") (await colRange()).format.font.bold = true;
      else if (verb === "ITALIC") (await colRange()).format.font.italic = true;
      else if (verb === "UNDERLINE") (await colRange()).format.font.underline = "Single";
      else if (verb === "FONTSIZE") (await colRange()).format.font.size = parseInt(m.pt) || 11;
      else if (verb === "FONTNAME") (await colRange()).format.font.name = (m.font || "Calibri").replace(/_/g, " ");
      else if (verb === "ALIGN") (await colRange()).format.horizontalAlignment = cap(m.to || "center");
      else if (verb === "VALIGN") (await colRange()).format.verticalAlignment = ({ top: "Top", middle: "Center", bottom: "Bottom" }[m.to] || "Center");
      else if (verb === "WRAP") (await colRange()).format.wrapText = true;
      else if (verb === "INDENT") (await colRange()).format.indentLevel = 1;
      else if (verb === "ROTATE") (await colRange()).format.textOrientation = parseInt(m.deg) || 0;
      else if (verb === "SHRINKFIT") (await colRange()).format.shrinkToFit = true;
      else if (verb === "CLEAR") (await colRange()).clear(m.what === "formats" ? Excel.ClearApplyTo.formats : Excel.ClearApplyTo.contents);
      // ── rows ──
      else if (verb === "INSERTROW") sheet.getRange(`${m.at}:${m.at}`).insert(Excel.InsertShiftDirection.down);
      else if (verb === "HIDEROW") rowRange().rowHidden = true;
      else if (verb === "UNHIDEROW") rowRange().rowHidden = false;
      else if (verb === "DELETEROW") rowRange().delete(Excel.DeleteShiftDirection.up);
      else if (verb === "ROWHEIGHT") rowRange().format.rowHeight = parseInt(m.px) || 20;
      else if (verb === "GROUPROWS") sheet.getRange(`${m.from}:${m.to}`).group(Excel.GroupOption.byRows);
      else if (verb === "GROUPCOLS") sheet.getRange(`${m.from}:${m.to}`).group(Excel.GroupOption.byColumns);
      // ── columns / ranges ──
      else if (verb === "INSERTCOL") { const c = await resolveCol(ctx, m.at); sheet.getRange(`${c}:${c}`).insert(Excel.InsertShiftDirection.right); }
      else if (verb === "MERGE") sheet.getRange(m.range).merge();
      else if (verb === "TABLE") sheet.tables.add(m.range, true);
      else if (verb === "PRINTAREA") sheet.pageLayout.setPrintArea(m.range);
      // ── sheet-level ──
      else if (verb === "GRIDLINES") sheet.showGridlines = m.show === "true";
      else if (verb === "TABCOLOR") sheet.tabColor = COLOR[m.color] || "#0070C0";
      else if (verb === "INSERTSHEET") ctx.workbook.worksheets.add(m.name);
      else if (verb === "DELETESHEET") ctx.workbook.worksheets.getItem(m.name).delete();
      else if (verb === "RENAMESHEET") sheet.name = m.name;
      else if (verb === "COPYSHEET") sheet.copy();
      else if (verb === "HIDESHEET") sheet.visibility = Excel.SheetVisibility.hidden;
      else if (verb === "CLEARFILTER") sheet.autoFilter.clearCriteria();
      else if (verb === "ORIENTATION") sheet.pageLayout.orientation = m.to === "portrait" ? "Portrait" : "Landscape";
      else if (verb === "CALCNOW") ctx.workbook.application.calculate(Excel.CalculationType.full);
      // ── cells ──
      else if (verb === "HYPERLINK") { const url = /^https?:\/\//.test(m.url || "") ? m.url : "https://" + (m.url || ""); (await sheet.getRange(m.cell)).hyperlink = { address: url, textToDisplay: m.url || url }; }
      else if (verb === "COMMENT") ctx.workbook.comments.add(sheet.getRange(m.cell), m.text || "");
      // ── recognised, but no clean one-click Office.js call ──
      else handled = false;
      await ctx.sync();
      setOut(handled
        ? `<div class="muted">${escapeHtml(verb.toLowerCase())} done</div>`
        : `<div class="formula">${escapeHtml(spec)}</div><div class="muted">no one-click action for ${escapeHtml(verb.toLowerCase())} in Office.js yet — do it from the ribbon</div>`);
    });
  } catch (e) { setOut('<span class="err">' + escapeHtml(verb) + " failed: " + escapeHtml(e.message) + "</span>"); }
}

function parseSpec(spec) {
  const out = {};
  // strip the leading VERB token (all-caps), then collect key=value pairs
  spec.replace(/^[A-Z][A-Z0-9.]*\s*/, "").split(/\s+/).forEach((tok) => {
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
function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeHtml(s)  { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
