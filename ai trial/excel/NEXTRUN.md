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
| ~1B  | 2048 | 20 | 16 | yes, w/ OPT8BIT=1 + GRADCKPT=1 + BATCH=8 | fits 16GB (slow); only worth it with a MUCH bigger, more diverse dataset or it overfits |

### 1B on 16 GB — it fits (inference of a 7B model is not the same as training)
Training holds weights + grads + optimizer + activations (~10-18x the
weights), so naive AdamW won't fit 1B on 16GB. But **8-bit Adam shrinks
the optimizer ~4x** and gradient checkpointing trims activations:
```powershell
pip install bitsandbytes
set CKPT=excel1b.ckpt
set NEMBD=2048
set NHEAD=16
set NLAYER=20
set BLOCK=256
set BATCH=8
set OPT8BIT=1
set GRADCKPT=1
set ITERS=40000
python train_resumable.py
```
Honest caveat: a 1B model only earns its size on a much larger, more
diverse dataset. On today's synthetic data it memorizes rather than
generalizes (the 50M already hits 99.8%). If you go 1B, also push `N`
high AND keep adding new generator types — big model and big diverse
data go together, or neither.

## Why these choices
- **COT=1**: the moving_avg / window-arithmetic misses come from the model
  doing `start = R-N+1` in its head. With COT the data shows the arithmetic
  step (`= 17-3+1 = 15 => ...`), which closes the gap.
- **BLOCK=256**: coworker answers (~210 chars) and data tables (~130 chars)
  don't fit in 128.
- **~400M is the sweet spot for *today's* data** (50M already saturates the
  old data at 99.8%, so the bottleneck is data diversity, not parameters).
  1B trains fine on your 16GB with 8-bit Adam — it's just overkill until the
  dataset is far bigger and more diverse, or it'll overfit. Scale the model
  and the data together.
- **Fresh CKPT name**: a run with a new vocab/block can't resume the old
  checkpoint — train to `excel400.ckpt` so the old one stays servable.
