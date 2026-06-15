# Backend wiring — putting the trained models to work

Three local models are trained and served (Ollama → `model.gofarther.dev`):
`gf-workflows` (builder, 7B q8), `gf-runner` (14B), `gf-chat` (14B). This is the
plan to wire them into the edge functions. `build-workflow` already calls
`gf-workflows`; the rest is below.

**Do these in order — cheapest/highest-value first:**
1. `build-workflow` finalize → **provably 100% valid workflows** (quality, no retrain)
2. `run-workflows → gf-runner` → cost/latency (medium effort)
3. `chat → gf-chat` router → cost (biggest lift, do last)

> A tested Python reference for #1 lives in `finetune/finalize.py` — port it to TS.

---

## 1. `build-workflow` finalize → 100% schema-valid by construction

The grammar guarantees structure/enums (100% valid JSON). The model gets the rest
~97% right. A deterministic **finalize pass** repairs the residual so every saved
workflow passes `validate_workflow`. Runs after the model (+ any self-correct
retry), before save. Order: **clamp → strip → repair → assert.**

| `validate_workflow` rule | Guaranteed by |
|---|---|
| structure / `kind`,`freq`,`branch`,`app` enums / types | grammar (upstream) |
| `hour`/`minute`/`weekday` ranges | **clamp** (deployed) |
| no phantom tool tokens in prose | **strip** |
| node ids present + unique | repair |
| first node = trigger | repair |
| non-empty labels / title / instruction | repair |
| edges reference real nodes (no orphans/self-loops) | repair |
| decision has yes+no to different nodes | repair (else demote to action) |

**Phantom-strip.** Tool tokens in prose (`GMAIL_SEND_EMAIL`, invented `GF_DOCS`)
are what fail the validator. They're cosmetic — `run-workflows` discovers tools at
runtime, nothing parses them from the prose. So strip any tool-shaped token that
isn't a **real built-in** (`GF_*` the `'ai'` nodes legitimately name).

- Python reference (`finalize.py`) strips exactly the tokens `phantom_tools()`
  flags (minimal, matches the validator).
- **TS note:** build-workflow doesn't ship the full tool catalog, so approximate
  by keeping a small **`KEEP` set = the real built-in tokens** (`catalog.BUILTINS`)
  and stripping every other tool-shaped token. That also drops *real* connector
  tokens — harmless (cosmetic) and still passes validation.

```ts
const KEEP = new Set<string>([ /* real GF_ built-ins from catalog.BUILTINS */ ]);
const TOK = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/;
function stripPhantomTokens(text: string): string {
  return text
    .replace(/(?:\s*\b(?:via|using|with|through|by|calling)\b)?\s*\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g,
      m => (KEEP.has(m.match(TOK)![0]) ? m : ""))
    .replace(/\s+([.,;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}
```

**Repair** (ids / first-trigger / labels / edges / decisions / title): see the full,
tested logic in `finetune/finalize.py::repair_workflow`. Port it verbatim.

**Assert the invariant:** after finalize, run `validate_workflow(wf)` and log if it
ever fails — that's a new rule needing a repair. With clamp + strip + repair it
can't fail today.

---

## 2. `run-workflows → gf-runner`

**Core shift:** Claude runs the loop server-side (deferred MCP + `tool_search_tool_regex`).
A local model can't. So **you run the loop**, and hand it a **small pre-scoped tool list**.

1. **Scope tools.** The workflow names its apps (each `node.app`). Pull tool schemas
   for *only those apps*; if still big, keyword-rank vs the instruction, keep top ~25–30.
   (This is the local replacement for tool-search, and matches how gf-runner was trained.)
2. **Run the loop** (OpenAI-compatible against Ollama, `temperature: 0.2`):
   ```
   messages = [system, {role:user, content: instruction}]
   for step in 1..8:
     resp = gf-runner.chat(messages, tools=scoped)
     if resp.tool_calls: execute each via composioExec → append tool_call + result
     else: return resp.content   // done
   ```
   Tool execution is unchanged — reuse `composioExec`; only the decision moves local.
3. **Fall back to Claude** (today's tool-search path, untouched) on error / `MAX_STEPS` /
   phantom-or-malformed tool. Mirror build-workflow's ML-primary + Opus-fallback shape
   (`RUNNER_MODEL_BASE_URL`, `RUNNER_MODEL_NAME=gf-runner`, `RUNNER_TIMEOUT_MS`).

**Rollout (runner is v1 / 179 samples):** start fallback-heavy; consider gating gf-runner
to simple workflows (≤2 apps, ≤4 steps) until the v2 retrain (trimmed tool lists, more
samples). Log which path served each run to measure real success before leaning on it.

**Safe to build now:** decision moves local, but execution (Composio), the fallback
(Claude), and the catalog are unchanged — gf-runner is inserted *in front of* today's
path. Worst case = today's behavior.

---

## 3. `chat → gf-chat` (router, not a swap)

Chat is the **trickiest**: besides deferred MCP + tool-search, it uses Anthropic
**server tools — web search, web fetch, code execution** (`chat/index.ts` ~L1034–1039)
that a local model **fundamentally cannot do**. So don't replace Claude — **route**.

1. **Classify the turn** (cheap heuristic, or the util Haiku already used for titles):
   - needs current-info / web / code / file analysis / deep multi-app discovery → **Claude**
   - plain conversation, or a simple built-in (memory, weather, maps, reminder), or one
     known connector action → **gf-chat**
   - **unsure → Claude** (mis-routing a web turn to gf-chat = confident wrong answer)
2. **gf-chat path:** like the runner — eager built-ins + scoped connector tools as
   OpenAI-format `tools` (reuse the existing built-in handlers behind the MCP server),
   run the loop yourself, **stream** the reply (Ollama streams). No web/code here.
3. **Claude path:** existing function, untouched — handles web/code/complex + is the fallback.

**Why this *is* the "universal chat" goal:** a 14B can't match Claude's knowledge — so
gf-chat serves the bulk of everyday turns (chit-chat, "remind me", "what's the weather",
"save this") locally and free; **Claude + web search fill every knowledge gap.** Cost
savings with no capability loss — the user never hits a dumb wall.

**Caveats:** router accuracy is everything (bias to Claude when unsure; tune from logs).
Built-in execution needs re-wiring to the OpenAI tool-call shape (handlers reusable).
gf-chat is v1 (~400 examples) — start narrow (no-tool chat + memory/weather), widen with trust.

---

## Testing #1 (the invariant)

`finetune/finalize.py` has the self-test: adversarial fixtures (phantom token,
out-of-range hour, orphan edge, dup ids, non-trigger first node, broken decision,
empty title/label) each end **valid**, and a valid workflow passes **unchanged**.
Before shipping the TS port, also run finalize over the eval's real outputs and
assert **N/N validate** — that proves 97% → 100% on the real distribution with no
collateral damage to the workflows that already passed.
