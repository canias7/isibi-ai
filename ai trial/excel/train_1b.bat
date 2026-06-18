@echo off
REM ============================================================
REM  Train the ~1B Excel coworker on the full 54-skill dataset.
REM  Just double-click this file (or run it) from ai trial\excel.
REM  Needs: Python + torch + an NVIDIA GPU. ~1B fits 16GB via
REM  8-bit Adam + gradient checkpointing. It will run a LONG time
REM  and saves a checkpoint every 2000 steps (servable mid-run).
REM ============================================================
cd /d "%~dp0"

echo.
echo === 0/3  installing 8-bit Adam (one-time; lets 1B fit 16GB) ===
pip install bitsandbytes

echo.
echo === 1/3  generating 3,000,000 examples (chain-of-thought ON) ===
set N=3000000
set COT=1
python make_data.py
if errorlevel 1 goto :err

echo.
echo === 2/3  freezing the tokenizer (new vocab) ===
python freeze_tokenizer.py
if errorlevel 1 goto :err

echo.
echo === 3/3  training ~1B  (NEMBD=2048 NLAYER=20, 8-bit Adam) ===
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
if errorlevel 1 goto :err

echo.
echo === DONE training. To eval: ===
echo     set CKPT=excel1b.ckpt
echo     set EVAL_N=3000
echo     python eval.py
goto :eof

:err
echo.
echo !! a step failed. If it was out-of-memory during training, lower BATCH
echo !! (set BATCH=4) and re-run; train_resumable.py resumes from the checkpoint.
echo !! If bitsandbytes failed to install, 1B won't fit on 16GB with plain
echo !! AdamW -- fall back to ~400M: set NEMBD=1280 ^& set NLAYER=20 ^& set OPT8BIT=0
