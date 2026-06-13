# Phase 2 — distilling the workflow RUNNER (multi-tool execution)

Phase 1 (`README.md`) taught the model to **author** a workflow: a request becomes
`emit_workflow` JSON in one shot. Phase 2 teaches it to **run** one — take a saved
`instruction` and actually carry it out by calling tools (Gmail → summarize →
send), reading each result before the next. This is the *"use multiple tools"*
half of the original goal.

> Status: **scaffold / not trained yet.** Build the builder up first; come back
> to this when you want to take the runner off Claude too.

## Why it's harder than phase 1

| | Builder (phase 1) | Runner (phase 2) |
|---|---|---|
| Shape | single-shot JSON | multi-turn tool-use loop |
| Output | one object | a *sequence* of tool calls + a final answer |
| Depends on | nothing | each tool's *result* (read → decide next) |
| Eval | does the JSON validate? (easy) | did it call the right tools, in order, and finish? (hard) |

A 7B is much weaker at long agentic tool loops than at structured emit, so expect
this to need more data + more iteration than the builder did.

## The pipeline (files)

| File | Role |
|------|------|
| `runner_gen.py` | Distill **simulated tool-use traces** from a teacher, seeded by the builder dataset's `instruction`s. |
| `runner_train.py` | QLoRA on the traces — trains only on assistant turns (tool calls + final), masks tool results. |
| (eval) | The open problem — see below. |

## Approach: simulated traces

`runner_gen.py` takes each `instruction` from your phase-1 data (exactly what the
prod runner executes) and asks a teacher to **role-play the execution** — decide
each tool call *and* invent a plausible result — then serializes it to an
OpenAI-style tool-calling conversation:

```
system (runner prompt + available tools)
user   (the instruction)
assistant → tool_calls: [GMAIL_FETCH_EMAILS{...}]
tool     → "3 unread emails ..."
assistant → tool_calls: [GF_SAVE_TABLE{...}]
tool     → "saved"
assistant → "Emailed you a digest of 3 unread messages."
```

Every trace is structurally checked (`valid_trace`): 1–5 tool steps, a final step,
and **only real tools** from the connected apps' catalog (no phantom tools).

**Run it** (same teacher flags as `gen_data.py`):
```bash
python runner_gen.py --selftest                              # offline wiring
TEACHER=anthropic ANTHROPIC_API_KEY=... python runner_gen.py --n 300
GEMINI_API_KEY=... python runner_gen.py --n 300 --gemini     # free
```
Needs phase-1 `data/train.jsonl` present (it supplies the scenarios).

### Why simulated, not real
Real traces — running the actual MCP tools against live accounts — are more
grounded but need connected accounts + many real runs to pile up. Simulated
traces bootstrap a dataset immediately. **Best long-term:** have `run-workflows`
log its real tool-call traces (not just the final result) to `workflow_runs`,
then mix those *real* traces in — that's the highest-quality data and it
accumulates for free as the app is used.

## Training

`runner_train.py` mirrors `train.py` but: renders `messages` + `tools` via the
chat template, uses `MAX_SEQ=4096` (traces are long), batch 1 / grad-accum 8, and
`train_on_responses_only` so it learns the *assistant* decisions, not the
(simulated) tool outputs. Produces `runner_gguf/` — load it into Ollama as a
**second** model (e.g. `gf-runner`) alongside `gf-workflows`.

## Serving / integration

`run-workflows`' `runInstruction()` currently calls Claude + the `gofarther-mcp`
tools. To use the local runner, point it at your model's OpenAI-compatible
endpoint with the **same tools**, run the tool loop server-side (call → execute
the real MCP tool → feed the result back → repeat), and keep Claude as the
fallback on a stuck/invalid loop — same primary+fallback shape as the builder.
The real MCP tools execute for real here (only the *training* results were
simulated).

## The hard part: evaluation

Unlike the builder ("does it validate?"), runner quality is "did it do the right
thing?" Options, roughly in order of effort:
1. **Structural** — valid tool names, sane call count, ends with a final. (cheap; `valid_trace` already does this for data.)
2. **Trajectory match** — compare the tool *sequence* against a held-out teacher trace (did it pick the right tools in a reasonable order?).
3. **Outcome check** — run against a sandbox/mock MCP and assert the end state. (most real, most work.)

Start with (1)+(2); graduate to (3) once it's promising.

## Honest expectations

This is the genuinely hard half. Plan on: simulated traces get you a *first*
runner that handles simple 2–3 tool chains; long/branching executions will lean
on the Claude fallback until you add real logged traces + more volume. Ship it
as primary-with-Claude-fallback (like the builder), measure, iterate.
