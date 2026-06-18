# Excel Formula Bot — Roadmap / Backlog

A from-scratch (no pretrained, no LoRA) model that turns plain English into Excel
work, served locally and driven from an Office.js task pane.

**Legend:** ✅ trained (in a run) · 🟡 built, awaiting next retrain · 🔭 backlog (not built)

**Core principle:** the model only ever emits a short *formula or spec*; the add-in
*executes* specs via Office.js. New capability = (cheap) data generator + (real work)
an Office.js handler. Keep the model small; scale only when eval says so.

---

## Status now

**Model tasks**
- ✅ Write formulas — 259 types (current training run)
- 🟡 Messy-input robustness (typos + shorthand)
- 🟡 Explain a formula → plain English
- 🟡 Fix a broken formula
- 🟡 Edit an existing formula (interactive refine)
- 🟡 Chart / pivot specs
- 🟡 Conditional formatting specs
- 🟡 Data cleaning specs

**Product**
- ✅ `serve.py` — local model API (zero-dependency)
- ✅ Add-in task pane (`addin/`) + sheet bridge (header → column)
- ✅ Add-in handlers: formula write, edit, chart build, format, clean

> Reality check: only **Write** is in the current run. Tasks 2–8 are queued for the
> **next** retrain — we haven't yet proven a ~26M model can juggle all of them.

---

## Priority order — what to do next (validation first)
We've built a lot on spec; the value now is **proving it**, not adding more.

1. **Train all 8 tasks + read eval** — the real unknown: can ~26M juggle them?
   - First fix the **weakest formula types** eval flags (more phrasings / simpler forms).
   - Read **per-task eval** (formula %, fix %, edit %). If core formula % drops vs the
     clean run → scale to **640/10/10 (~50M)**.
2. **Live end-to-end in real Excel** — one formula into a real cell with header
   mapping working. The whole pipeline (model → `serve.py` → task pane → bridge →
   cell) has never run once. This is the moment it stops being an experiment.
3. **Then add more — locked-in priority picks (in order):**
   1. 🎯 **Multi-word headers** ("Net Sales") — prerequisite for real sheets (bridge + data)
   2. 🎯 **Ask-your-data** — compute the formula and show the *answer* (add-in; near-free)
   3. 🎯 **Bilingual ES/EN input** — Spanish descriptions → same formula (data pass)
   4. 🎯 **Finance pack** — ratio block / variance report (Phase C template)
   - then: rest of the action class (validation, sort/filter), Phase B automation

---

## Backlog — more "action" capabilities (cheap model, add-in handler each)
- 🔭 **Data validation** — dropdown lists, number/date/range restrictions
- 🔭 **Sort / filter the data** — operate on the range (not a spill formula)
- 🔭 **Number formatting** as an action — currency / percent / date on a range
- 🔭 **Insert / delete** rows & columns; **freeze panes**; **autofit**; **hide** columns
- 🔭 **Find & replace** across the whole sheet
- 🔭 **Named ranges** — "name A1:A10 prices"
- 🔭 **Summary row** — total/avg/count/max under each column (mini build-model)
- 🔭 **Ask-your-data** — write the formula, compute it, and show the *answer* (read-back)
- 🔭 **Sparklines** (in-cell mini charts) + more chart types: waterfall, combo
  (bar+line), histogram, dual-axis
- 🔭 **Table ops** — merge/join two tables on a key; unpivot (wide→long);
  subtotals & grouping; consolidate multiple sheets
- 🔭 **Proactive suggestions** — read the sheet's shape and offer next steps
  ("price × qty → add a total column?", "looks monthly → add a trend?")
- 🔭 **Range → Table** + structured references (`Table[Column]`)
- 🔭 **Paste messy data → auto-structure** into a clean table (types, headers)
- 🔭 **Parse a bank statement / PDF table** into columns
- 🔭 **Cell comments** — document what a formula does, in the cell note

## Backlog — Phase B: automation (multi-step)
- 🔭 Output an **ordered list of steps** ("dedupe, format as currency, then total it")
- 🔭 Needs: bigger model + **block_size 256** + add-in **step executor**
- 🔭 New training data: chained tasks

## Backlog — Phase C: build models (templates)
- 🔭 Hybrid: model → **template + params**, add-in **stamps the grid**
- 🔭 Templates: loan amortization, cash flow / budget, 3-statement skeleton, simple DCF
- 🔭 Generic templates: invoice, budget tracker, expense report, inventory, Gantt

## Backlog — finance intelligence (finance-first, high value)
- 🔭 **Ratio pack** — one block: current/quick ratio, ROE, ROA, debt-to-equity,
  gross/net margin, EBITDA
- 🔭 **AR/AP aging report** — buckets 0–30 / 31–60 / 61–90 / 90+
- 🔭 **Variance report** — actual vs budget with % and over/under flags
- 🔭 **Scenario block** — best / base / worst columns
- 🔭 **Sensitivity / two-variable data tables** (what-if grid)
- 🔭 **Break-even analysis**; **run-rate / annualization**
- 🔭 **Reconciliation** — match two columns on a key, flag mismatches

## Backlog — model & training quality
- 🔭 **Multi-word headers** ("net sales", "unit price") — data + bridge support
- 🔭 More **phrasing variety** (ongoing, eval-driven)
- 🔭 **Per-task eval** for format/clean (structured match)
- 🔭 **Output validation** — check balanced parens / known function before returning
- 🔭 **Quantize** (q8) for faster, smaller serving
- 🔭 Decoding: keep greedy (exact formulas); revisit only if needed
- 🔭 ⭐ **Bilingual input** — Spanish + English descriptions → same formula
- 🔭 **Locale formats** — semicolon args (`=SUM(A1;A2)`), € / £ / ¥ currency
- 🔭 **Audit: flag hardcoded numbers** baked into formulas (modeling best practice)
- 🔭 **Error sweep** — find all #REF! / #DIV0! / #N/A on the sheet and explain each
- 🔭 **Refactor / convert** — VLOOKUP ↔ XLOOKUP ↔ INDEX-MATCH; simplify a formula
- 🔭 **Golden test set** of real hand-written phrasings + **regression suite**
- 🔭 **Telemetry** — log failed / low-confidence requests to guide the next data round
- 🔭 ⭐ **Sheet-context awareness** — feed the real headers / selected range / nearby
  cells to the model so formulas fit the actual sheet (training-format change)
- 🔭 ⭐ **Learn from corrections** — when the user fixes an output, capture (input →
  corrected formula) and fold it into the next training round (improvement flywheel)
- 🔭 **Alternatives** — offer 2–3 candidate formulas (top-k) and let the user pick
- 🔭 **Confidence calibration** — use the logit margin to flag shaky answers

## Backlog — add-in / product polish
- 🔭 **Pivot auto-build** (Office.js `pivotTables`) — currently spec is shown only
- 🔭 **Split column** execution (`CLEAN op=split`) — currently best-effort note
- 🔭 **Delete blank rows**
- 🔭 **Preview before apply** + **undo** affordance
- 🔭 Handle **multi-cell selection**
- 🔭 **Confidence**: warn when the model output looks malformed
- 🔭 **Ribbon button** (today it's task-pane only) + manifest **icons**
- 🔭 **One-click launcher** that starts both servers
- 🔭 Recent-request **history** in the pane
- 🔭 **Batch fill-down** — apply the formula down a whole column at once
- 🔭 **Suggest-as-you-type** autocomplete of common requests
- 🔭 **Voice input** — describe it out loud

## Backlog — stretch / maybe-not (be honest)
- 🔭 Multi-turn conversational ("make it only the paid ones" referencing last result)
- 🔭 True **data reasoning** (read 1000 rows, find anomalies) — likely needs a much
  bigger model than from-scratch 26M; revisit honestly
- 🔭 Goal seek / what-if; regex extraction
- 🔭 **On-device** model (ONNX/WASM in the browser) — no `serve.py`, fully offline

## Backlog — reach / platform
- 🔭 **Google Sheets** version (Apps Script add-on) — same model, wider audience
- 🔭 **Standalone web app** — paste data, get formulas, no Excel needed
- 🔭 **Example gallery / onboarding** — "try these" prompts in the pane
- 🔭 **Explain what changed** after an edit (diff old vs new formula)

---

## Decisions / constraints (so we don't relitigate)
- From scratch only — **no pretrained, no LoRA, no external model APIs**.
- Model stays small; add capability via **data + add-in handlers**, scale size only on eval evidence.
- The bot **never computes** — Excel does. The model translates intent → formula/spec.
- Named columns: model emits the header name; the **bridge** maps it to the real column.
