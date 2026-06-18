// taskpane.js — the bot's brain inside Excel.
//  1. send the user's text to the local model API (serve.py on :8000)
//  2. if the answer is a formula, run the SHEET BRIDGE: map header names
//     (e.g. "revenue") to the real column (e.g. "C:C") by reading row 1
//  3. write the finished formula into the active cell
// If the answer isn't a formula (explain / fix text), just show it.

const API = "http://127.0.0.1:8000/formula";

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

  let result;
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    result = (await r.json()).result;
  } catch (e) {
    setOut('<span class="err">Can\'t reach the model API. Is <code>serve.py</code> running on :8000?</span>');
    return;
  }

  // explain / fix-it answers are plain text, not formulas — just display them
  if (!result || !result.startsWith("=")) {
    setOut(result || '<span class="err">empty response</span>');
    return;
  }

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
      await ctx.sync();

      const note = finalFormula !== result
        ? `<div class="muted" style="margin-top:6px">mapped headers → ${escapeHtml(result)}</div>`
        : "";
      setOut(`<div class="formula">${escapeHtml(finalFormula)}</div>${note}`);
    });
  } catch (e) {
    setOut('<span class="err">Couldn\'t write to the cell: ' + escapeHtml(e.message) + "</span>");
  }
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

// Replace bare header names in the formula with their column range (revenue -> C:C).
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

// 0 -> A, 25 -> Z, 26 -> AA ...
function colLetter(idx) {
  let s = "";
  idx += 1;
  while (idx > 0) {
    const m = (idx - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    idx = Math.floor((idx - 1) / 26);
  }
  return s;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeHtml(s)  { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
