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
3. **Then add more — finance first:**
   - ⭐ **Phase C templates** (amortization, cash flow, DCF) — most leverage for finance.
   - ⭐ **Multi-word headers** ("Net Sales") — small change, big real-world impact.
   - Then the rest of the action class (validation, sort/filter).

---

## Backlog — more "action" capabilities (cheap model, add-in handler each)
- 🔭 **Data validation** — dropdown lists, number/date/range restrictions
- 🔭 **Sort / filter the data** — operate on the range (not a spill formula)
- 🔭 **Number formatting** as an action — currency / percent / date on a range
- 🔭 **Insert / delete** rows & columns; **freeze panes**; **autofit**; **hide** columns
- 🔭 **Find & replace** across the whole sheet
- 🔭 **Named ranges** — "name A1:A10 prices"
- 🔭 **Summary row** — total/avg/count/max under each column (mini build-model)

## Backlog — Phase B: automation (multi-step)
- 🔭 Output an **ordered list of steps** ("dedupe, format as currency, then total it")
- 🔭 Needs: bigger model + **block_size 256** + add-in **step executor**
- 🔭 New training data: chained tasks

## Backlog — Phase C: build models (templates)
- 🔭 Hybrid: model → **template + params**, add-in **stamps the grid**
- 🔭 Templates: loan amortization, cash flow / budget, 3-statement skeleton, simple DCF

## Backlog — model & training quality
- 🔭 **Multi-word headers** ("net sales", "unit price") — data + bridge support
- 🔭 More **phrasing variety** (ongoing, eval-driven)
- 🔭 **Per-task eval** for format/clean (structured match)
- 🔭 **Output validation** — check balanced parens / known function before returning
- 🔭 **Quantize** (q8) for faster, smaller serving
- 🔭 Decoding: keep greedy (exact formulas); revisit only if needed

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

## Backlog — stretch / maybe-not (be honest)
- 🔭 Multi-turn conversational ("make it only the paid ones" referencing last result)
- 🔭 True **data reasoning** (read 1000 rows, find anomalies) — likely needs a much
  bigger model than from-scratch 26M; revisit honestly
- 🔭 Goal seek / what-if; regex extraction

---

## Decisions / constraints (so we don't relitigate)
- From scratch only — **no pretrained, no LoRA, no external model APIs**.
- Model stays small; add capability via **data + add-in handlers**, scale size only on eval evidence.
- The bot **never computes** — Excel does. The model translates intent → formula/spec.
- Named columns: model emits the header name; the **bridge** maps it to the real column.
