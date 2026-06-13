# Phase 3 — distilling the main CHAT assistant

The fourth and **hardest** Claude-powered surface. `build-workflow` (phase 1) and
`run-workflows`/`test-workflow` (phase 2) are narrow; `chat` is the open-ended
assistant — any topic, any tool, multi-turn. A 7B trails Claude here the most.

> Status: **scaffold only.** Do the builder (and ideally the runner) first.

## Read this before training it

Chat is the one where "all local" costs the most quality. A fine-tuned 7B will be
fine on common, simple asks ("what's on my calendar?", "remind me at 3pm",
"what can you do?") but noticeably weaker than Claude on open-ended reasoning,
nuance, and long multi-tool sessions.

**So the recommended end-state is HYBRID, not replacement:**
- Local model handles the **easy/common** turns (cheap, instant, offline-ish).
- Claude handles anything the local model is unsure about or that needs real
  reasoning.

Route by a cheap signal (does the local answer pass a sanity check? is it a known
simple intent?) → else fall back to Claude. Same primary+fallback spirit as the
builder, just with a lower bar for handing off.

## Pipeline

`chat_gen.py` mirrors `runner_gen.py` (reuses its tool helpers + trace format):
1. Teacher brainstorms **diverse user messages** — general Qs (no tool), app
   actions, quick facts, money, casual chat.
2. Teacher role-plays each response — **0–5** tool calls (many need none) ending
   in a natural reply — serialized as an OpenAI tool-calling chat.
3. Structural guard: real tools only, ≤5 steps, ends with a final.

```bash
python chat_gen.py --selftest
TEACHER=anthropic ANTHROPIC_API_KEY=... python chat_gen.py --n 400
GEMINI_API_KEY=... python chat_gen.py --n 400 --gemini      # free
```

**Training:** reuse `runner_train.py`'s recipe (multi-turn, seq 4096, train on
assistant turns) pointed at `chat_data/` instead of `runner_data/` — copy it to
`chat_train.py` and swap the two paths, or parameterize. Load the result into
Ollama as a third model (`gf-chat`).

## Data coverage matters most here

Because chat is open-ended, the dataset must be **broad**: lots of no-tool general
Q&A, every app's common actions, follow-ups, and "what can you do" style meta.
This wants **more volume than the builder** (1–2k+), and the free Gemini teacher
is the practical way to get there. Even then, expect to lean on the Claude
fallback for the long tail.

## Eval

Hardest of the three. Useful signals:
- **Tool-decision accuracy** — when a tool was warranted, did it call the right one (vs. hallucinate an answer)? And did it correctly NOT call tools for general Qs?
- **Answer quality** — judge a sample with a stronger model (LLM-as-judge) against the teacher's answer.
- **Structural** — valid tool names, ends cleanly.

## Honest bottom line

Builder → very localizable. Runner → localizable with effort. **Chat → localize
the easy slice, keep Claude for the rest.** Trying to fully replace Claude chat
with a 7B is the one place "free + local" meaningfully hurts the product. Scaffold
is here when you want to try the hybrid.
