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
  if (result.startsWith("CHART")) return buildChart(result);
  if (result.startsWith("PIVOT")) {
    setOut(`<div class="formula">${escapeHtml(result)}</div><div class="muted">pivot spec (auto-build coming next)</div>`);
    return;
  }
  if (!result.startsWith("=")) { setOut(escapeHtml(result)); return; }  // explain / fix text

  // 5. a formula: bridge header names -> ranges, write into the active cell
  try {
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const used = sheet.getUsedRangeOrNullObject();
      used.load("values,columnIndex,isNullObject");
      await ctx.sync();

      const headerMap = used.isNullObject ? {} : buildHeaderMap(used);
      const finalFormula = applyBridge(result, headerMap);

      ctx.workbook.getActiveCell().formulas = [[finalFormula]];
      await ctx.sync();

      const note = finalFormula !== result
        ? `<div class="muted" style="margin-top:6px">from ${escapeHtml(result)}</div>` : "";
      setOut(`<div class="formula">${escapeHtml(finalFormula)}</div>${note}`);
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

function parseSpec(spec) {
  const out = {};
  spec.replace(/^(CHART|PIVOT)\s*/, "").split(/\s+/).forEach((tok) => {
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
