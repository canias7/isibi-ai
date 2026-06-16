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

### Field finding (2026-06): the residual ~3% is THREE causes, not one — and most is free

A temp-0.2 re-eval of the retrained builder (1,207 ex, r=32, q8_0) hit **97%**
schema-valid; the residual **4/134** were all flagged as "phantom" tool tokens.
Checked against the live catalog (`finetune/{schema,catalog}.py`, 5,847 tools) they
split three ways:

| Token (from the eval) | Truth | Real fix |
|---|---|---|
| `OUTLOOK_LIST_CALENDARS` | **a REAL tool** (Outlook is a known prefix) | **catalog drift** — the eval/builder catalog is stale |
| `AIRTABLE_LIST_BASE_SCHEMA` | near-miss of real `AIRTABLE_GET_BASE_SCHEMA` / `AIRTABLE_LIST_BASES` | finalize strip (or data) |
| `GF_DOWNLOAD_IMAGE` | near-miss of the real built-in `GF_IMAGE` | finalize strip (or data) |
| `GF_DOCS` | genuine invention (no GF docs tool) | finalize strip |

**Implication:** at least one "failure" is a *real tool wrongly flagged by a stale
catalog* — so the true rate is **≥ 97%** and the eval understates it. The path to
~100% is **free** (no retrain, no Sonnet credits), in this order:

1. **Sync the catalog first.** Point the deployed `build-workflow` *and* the eval at
   the current tool list (repo `main` has `OUTLOOK_LIST_CALENDARS` et al.). Real
   tools stop being flagged. **Do this before spending any data credits — otherwise
   you're chasing false failures.** (The PC's `build-workflow-engines` branch is
   based on old main, hence the drift.)
2. **Then finalize** (below). Strips the genuinely-invented / near-miss tokens from
   prose → valid by construction. It is **lossless**: nothing parses tool names from
   prose, and `run-workflows` discovers the real tool at runtime — so a near-miss
   like `GF_DOWNLOAD_IMAGE` left in the text is harmless (the runner finds `GF_IMAGE`
   itself).
3. *(optional, lowest priority)* targeted Sonnet data on the Airtable/GF tools so the
   model names them exactly. Finalize + runtime discovery already neutralize these,
   so **defer until credits are back** — it's polish, not the blocker.

> Proven locally: a workflow citing all four tokens goes **invalid → valid** after
> `finalize()` (`finetune/finalize.py`). `strip_phantoms` removes exactly what
> `phantom_tools()` flags — which is the same function `validate_workflow` uses — so
> by construction every phantom the validator catches, finalize strips.

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

The trickiest: `chat` uses Anthropic **server tools** (web search/fetch, code exec —
`chat/index.ts` ~L1034–1039) a local model can't do, AND it delegates connector-tool
execution to the **MCP server** (Anthropic runs the tools). So don't replace Claude —
**route**, and lean on two verified facts that make the *first cut* easy.

### Two contracts to honor (both verified in the code)
- **Stream = plain UTF-8 text, not SSE.** `src/api.ts::streamChat` just does
  `onToken(decode(bytes))` and reads the `x-gf-model` response header — no JSON event
  framing. So the gf-chat path only has to **relay Ollama's streamed tokens as text**
  and set `x-gf-model: gf-chat`.
- **Tools today run server-side** via Anthropic's `mcp_toolset` — *Anthropic* executes
  connector + built-in tools. A local model can't use that, so a gf-chat *tool* turn
  must **execute tools in-function** (gf-chat returns tool_calls → you call the tool →
  feed the result back → loop). That's the hard part — so defer it to Phase B.

### Phase A — gf-chat for no-tool conversation only (ship this first; ~30 lines, low risk)
1. **Classify upfront** (before any model call): → **Claude** if the turn needs current
   info / web / code / files, references the user's connected apps, or asks to *do*
   something (send/create/check/schedule/pay…). → **gf-chat** only for pure conversation
   (chit-chat, explanations, rewrites, opinions). **Unsure → Claude.** A keyword/verb
   heuristic is fine to start; the existing `util` Haiku is a sharper fallback classifier.
2. **gf-chat path:** no tools at all — system prompt (+ memory) + messages → Ollama
   `stream:true` → **relay tokens as plain text**, set `x-gf-model: gf-chat`. No tool
   loop, so it's tiny.
3. **Fallback = upfront only:** if gf-chat errors/unreachable *before* it emits a token,
   restart the turn on the existing Claude path. **Never fall back mid-stream** (you'd
   double-speak). Once it's streamed a token, let it finish.

This alone moves the bulk of everyday voice/text turns onto your model for free, with
**zero risk to tool turns** (they all still go to Claude).

### Phase B — gf-chat for simple tool turns (later)
Add the self-run loop: `scope_tools()` (already built) → gf-chat with those tools → on a
tool_call, **execute it yourself** (call the same `gofarther-mcp` handler / Composio the
MCP server uses) → feed the result back → loop, streaming the final text. Keep
web/code/complex on Claude. Gate to ≤2 apps / ≤3 steps until trusted.

### Guardrails
- **Log the route per turn** (gf-chat vs Claude + why) → tune the classifier from real misroutes.
- **Never lose a capability** — anything uncertain → Claude.
- gf-chat won't emit the `[[gf…]]` card markers (not trained to) — fine for Phase A (cards
  come from tool results = Claude / Phase B).

**Why this *is* the "universal chat" goal:** a 14B can't match Claude's knowledge, so
gf-chat takes the easy everyday turns (free, local) and Claude + web search fill every
gap — cost savings, no capability loss, the user never hits a dumb wall.

---

## Testing #1 (the invariant)

`finetune/finalize.py` has the self-test: adversarial fixtures (phantom token,
out-of-range hour, orphan edge, dup ids, non-trigger first node, broken decision,
empty title/label) each end **valid**, and a valid workflow passes **unchanged**.
Before shipping the TS port, also run finalize over the eval's real outputs and
assert **N/N validate** — that proves 97% → 100% on the real distribution with no
collateral damage to the workflows that already passed.
