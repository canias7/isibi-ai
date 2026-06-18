# GO-LIVE — running the Excel bot for real

The whole pipeline (`model → serve.py → add-in → sheet bridge → cell`) has never run
in a real spreadsheet. This is the runbook. **Bring it up in LAYERS** — test each
before the next, so a failure points at one piece, not the whole stack.

> Honest expectation: the model side is proven (~99% eval). The **add-in Office.js
> handlers are written but untested** — expect Layer 3–4 to need a fix or two on the
> first run. That's normal; the layered approach isolates them fast.

---

## Prereqs
- Training finished → `excel.ckpt` + `tokenizer.json` exist in `ai trial/excel/`.
- Python with torch (the PC already has it).
- **Excel on the web** is the easiest to sideload (recommended for the first run).
- A **test sheet** (see below) so the header-bridge and ask-your-data have data.

### Test sheet (make this first)
Row 1 headers, ~10 rows of data:

| Region | Status | Revenue | Cost | Quantity |
|--------|--------|---------|------|----------|
| west   | paid   | 1200    | 800  | 10 |
| east   | open   | 900     | 600  | 7  |
| west   | paid   | 1500    | 950  | 12 |
| …      | …      | …       | …    | …  |

---

## Layer 0 — checkpoint exists
```powershell
cd "ai trial\excel"
dir excel.ckpt, tokenizer.json     # both should be there
```

## Layer 1 — the model serves (no Excel yet)
Terminal 1:
```powershell
python serve.py        # -> "Excel model API → http://127.0.0.1:8000"
```
Test it standalone:
```powershell
curl -X POST http://127.0.0.1:8000/formula -d "{\"text\": \"sum column A\"}"
```
**Expect:** `{"result": "=SUM(A:A)"}`
**If broken:** `import ask` fails → run from the `excel` folder; or `excel.ckpt`/`tokenizer.json` missing → Layer 0.

## Layer 2 — the task-pane files serve
Terminal 2:
```powershell
cd addin
python -m http.server 3001
```
Open `http://localhost:3001/taskpane.html` in a browser → the **UI should render**
(input box + "Insert formula"). Proves the static files + Office.js CDN load.

## Layer 3 — sideload + reach the API
- **Excel web:** Insert → Add-ins → **Upload My Add-in** → pick `addin/manifest.xml`.
- **Excel desktop (Win):** share a folder holding `manifest.xml`; File → Options →
  Trust Center → Trusted Add-in Catalogs → add the share → restart → Insert →
  My Add-ins → Shared Folder → **Formula Bot**.

Then: click an empty cell, type **`sum column A`**, hit Insert.
**Expect:** `=SUM(A:A)` written to the cell, and "= <value>" shown in the pane.
**If "can't reach the model API":** serve.py not running, or CORS — check Terminal 1.
**If an Office error:** note the exact message (that's an Office.js call to fix).

## Layer 4 — the real test (bridge + every handler)
On the **test sheet**, run these in order. Each exercises one capability — note which
land and which error, so we fix the specific handler.

| Type | Prompt | Expect |
|------|--------|--------|
| write + bridge | `sum the revenue column` | `=SUM(C:C)` + value |
| conditional | `count rows where status is paid` | `=COUNTIF(B:B,"paid")` |
| multi-criteria | `total revenue where region is west` | `=SUMIF(A:A,"west",C:C)` |
| multi-word hdr | `average unit cost` *(rename a header "unit cost")* | maps to that column |
| Spanish | `suma la columna de revenue` | `=SUM(C:C)` |
| explain | `explain =SUM(C:C)` | plain-English text |
| fix | `fix =SUM(C:C` | `=SUM(C:C)` |
| edit | *(click a formula cell)* `only where region is west` | rewrites it |
| format | `highlight revenue over 1000 in red` | red rule on the column |
| clean | `make region uppercase` | column upper-cased |
| sort | `sort by revenue descending` | rows reordered |
| filter | `filter to show only paid in status` | autofilter applied |
| chart | `bar chart of revenue by region` | a chart appears |
| model | `build a ratio analysis` | input+ratio block stamped |

---

## Report-back checklist (so fixes are fast)
For each layer that breaks, capture:
1. **Which layer / which prompt**
2. **The exact error** (pane message, or browser console: F12 → Console)
3. What the cell/sheet actually did (nothing / wrong formula / Office error)

Layers 1–2 are plumbing (quick fixes). Layer 3–4 errors are Office.js calls in
`taskpane.js` — paste the message and we patch the specific handler.

## After it works
- Keep `serve.py` + the file server running while you use it.
- Add a desktop shortcut / one-click launcher (backlog) so it's not two terminals.
- Then cherry-pick from `ROADMAP.md` based on what you actually reach for.
