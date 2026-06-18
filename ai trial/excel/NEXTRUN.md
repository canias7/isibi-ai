# NEXT RUN — train the coworker on everything we built

The 50M/202M checkpoints were trained on the **old** data. None of this
session's work (data-grounded reasoning, hard formulas, domain depth,
accounting-coworker advice/concepts/consulting, 87 industry KPIs, 5
languages) is in them. To light it all up you must **regenerate → re-freeze
→ train fresh**. Resuming the old checkpoint will NOT work — the vocab and
block size changed.

## 3 steps

```powershell
cd "ai trial\excel"

# 1) regenerate the dataset — bigger N + chain-of-thought ON (COT fixes the moving_avg gap)
set N=2000000
set COT=1
python make_data.py            # writes excel.txt (~2M examples, 46 task modes)

# 2) RE-FREEZE the tokenizer (new chars: accents, |, curly quotes -> ~612 vocab)
python freeze_tokenizer.py     # overwrites tokenizer.json — required for a fresh run

# 3) train fresh at ~400M (new CKPT name so it doesn't resume the old one)
set CKPT=excel400.ckpt
set NEMBD=1280
set NHEAD=16
set NLAYER=20
set BLOCK=256
set BATCH=24
set GRADCKPT=1
set ITERS=20000
python train_resumable.py
```

Then eval it: `set CKPT=excel400.ckpt` && `EVAL_N=3000 python eval.py`
(eval.py now scores every new capability: DATA-Q, HARD, DOMAIN, KPI, and
shows ADVISE/CONCEPT/CONSULT samples).

## Config ladder (pick by your GPU)

| Size | NEMBD | NLAYER | NHEAD | Fits 16 GB? | Notes |
|------|-------|--------|-------|-------------|-------|
| ~50M  | 640  | 10 | 10 | easily | proven: 99.8% core (old data) |
| ~202M | 1024 | 16 | 16 | yes | your current run |
| **~400M** | **1280** | **20** | **16** | **yes, w/ BATCH=24 + GRADCKPT=1** | **recommended for the richer data** |
| ~1B  | 2048 | 20 | 16 | NO (needs A100 40/80GB) | only worth it with a much larger, more diverse dataset |

## Why these choices
- **COT=1**: the moving_avg / window-arithmetic misses come from the model
  doing `start = R-N+1` in its head. With COT the data shows the arithmetic
  step (`= 17-3+1 = 15 => ...`), which closes the gap.
- **BLOCK=256**: coworker answers (~210 chars) and data tables (~130 chars)
  don't fit in 128.
- **~400M not 1B**: the 50M already saturates the *old* data at 99.8% — the
  bottleneck is data diversity, not parameters. 400M gives headroom for the
  new breadth without overfitting or blowing past 16 GB. Revisit 1B only
  when the dataset is far larger/more diverse **and** you've got an A100.
- **Fresh CKPT name**: a run with a new vocab/block can't resume the old
  checkpoint — train to `excel400.ckpt` so the old one stays servable.
