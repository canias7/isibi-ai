# Formula Bot — Excel add-in

The task pane that puts the from-scratch model *inside* Excel. You type plain
English, it writes the formula into the selected cell. It also explains and fixes
formulas (same model).

## How it fits together

```
  Excel task pane (this folder)  --POST-->  serve.py (model API, :8000)
        |  http://localhost:3001                     |
        |                                            +-- ask.py -> excel.ckpt
        +-- sheet bridge: reads your headers, maps "revenue" -> the real column
```

## One-time setup (on the PC, after training has produced excel.ckpt)

Open **two** terminals in `ai trial/excel`:

**1. Start the model API** (serves the trained model):
```
python3 serve.py
```
Quick check it works:
```
curl -X POST http://127.0.0.1:8000/formula -d "{\"text\": \"sum column A\"}"
```
You should get `{"result": "=SUM(A:A)"}`.

**2. Serve the task-pane files** (from the `addin` folder):
```
cd addin
python -m http.server 3001
```

## Sideload into Excel

- **Excel on the web:** Insert → Add-ins → Upload My Add-in → pick `manifest.xml`.
- **Excel desktop (Windows):** put `manifest.xml` in a folder, share that folder,
  then File → Options → Trust Center → Trusted Add-in Catalogs → add the share's
  path → restart Excel → Insert → My Add-ins → Shared Folder → **Formula Bot**.

Office allows `http://localhost` for development, so no HTTPS/cert setup needed.

## Use it

1. Click a cell.
2. Type e.g. `total sales where region is west` → **Insert formula**.
3. The bot calls the model, maps any header names to real columns, and writes the
   formula into the cell.

Header mapping example: if your sheet has `revenue` in column C, then
`sum the revenue column` → model says `=SUM(revenue)` → bridge writes `=SUM(C:C)`.

Also works:
- **Edit** — click a cell that already has a formula, type an instruction
  ("only where region is west", "round to 2 decimals", "lock the references") →
  it sends `edit <current formula> to <your text>` and rewrites the cell.
- **Explain** — `explain =SUMIF(A:A,"paid",B:B)` → plain-English description.
- **Fix** — `fix =CODE(M32` → `=CODE(M32)`.
- **Charts** — `bar chart of sales by region` → the model emits
  `CHART type=bar values=sales category=region`; the add-in maps the headers to
  columns and builds the chart. (Pivot specs are shown for now; auto-build is next.)

## Notes / limits (v1)

- The bridge maps **single-word** headers (the model is trained on single-word
  names). Multi-word headers ("net sales") are a future data+bridge addition.
- Both servers run locally; nothing leaves the machine.
- If the pane says "can't reach the model API", make sure `serve.py` is running.
