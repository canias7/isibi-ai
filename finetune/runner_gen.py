"""Phase 2 — distill the workflow RUNNER (multi-tool execution) into the local model.

Phase 1 (`gen_data.py`) taught the model to AUTHOR a workflow: one-shot request ->
`emit_workflow` JSON. Phase 2 teaches it to RUN one: given a compiled
`instruction` + the available tools, call the right tools in sequence (reading
each result) and finish. That's multi-turn, agentic tool use — meaningfully
harder than single-shot emit, which is why it's a separate project.

APPROACH (v1): SIMULATED tool-use traces.
  A strong teacher role-plays the execution — it decides each tool call AND
  invents a plausible result — and we serialize that into an OpenAI-style
  tool-calling conversation the student trains on:
      system (runner prompt + tools) -> user (instruction)
      -> assistant(tool_calls) -> tool(result) -> assistant(tool_calls) -> ...
      -> assistant(final summary)
  The SCENARIOS are the `instruction` fields from the builder dataset (exactly
  what the runner executes in prod), so phase-1 data seeds phase-2 for free.

Why simulated (not real execution)? Real traces — running the actual MCP tools
against live accounts — are more grounded but need connected accounts + many
real runs to accumulate. Simulated traces bootstrap a dataset now; fold in real
logged traces (from `workflow_runs` once it captures tool steps) later.

Teacher selection mirrors gen_data.py: --anthropic (default) / --groq / --gemini.

  python runner_gen.py --selftest                 # offline wiring check
  TEACHER=anthropic ANTHROPIC_API_KEY=... python runner_gen.py --n 300
  GEMINI_API_KEY=... python runner_gen.py --n 300 --gemini
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

from catalog import ALLOWED, BUILTINS, frontend_id, tools_for
from gen_data import Teacher, make_teacher
from tool_schemas import arg_signature, parameters_for, validate_args

HERE = Path(__file__).parent
BUILDER_DATA = HERE / "data" / "train.jsonl"   # phase-1 instructions seed phase-2
OUT_DIR = HERE / "runner_data"

# Cap the tool menu per training trace so the rendered example fits the training
# seq window. The v1 runner dropped 361/540 traces whose full per-app tool lists
# blew past it. We always keep the tools the trace actually uses + the built-ins,
# then top up with random distractors to this many (so the model still learns to
# PICK from a realistic menu, not just the answer). Keep the prod runner's
# tool-scoping cap (BACKEND_WIRING.md) in line with this number.
TOOL_CAP = int(os.environ.get("GF_TOOL_CAP", "16"))


def connected_from_system(system: str) -> list[str]:
    """Recover the connected frontend ids from a builder row's system prompt."""
    return [m.group(1) for m in re.finditer(r"^- ([a-z0-9_]+):", system, re.MULTILINE)]


def available_tools(connected: list[str]) -> list[str]:
    """Curated tool names for the connected apps + the always-on built-ins."""
    names: list[str] = []
    for fid in connected:
        slug = next((s for s in ALLOWED if frontend_id(s) == fid), fid)
        names.extend(tools_for(slug))
    names.extend(BUILTINS.keys())
    return names


def tool_menu(connected: list[str], keep: set[str] | None = None) -> str:
    # Show each tool's arg signature (e.g. GF_WEATHER(location, units?)) so the
    # teacher uses real arg names — just the bare name where we lack a schema.
    # `keep` (a tool-name set, see select_tools) trims the menu to a bounded slice.
    lines = []
    for fid in connected:
        slug = next((s for s in ALLOWED if frontend_id(s) == fid), fid)
        ts = [t for t in tools_for(slug) if keep is None or t in keep]
        if ts:
            lines.append(f"- {fid}: {', '.join(arg_signature(t) for t in ts)}")
    bi = [t for t in BUILTINS if keep is None or t in keep]
    if bi:
        lines.append("- built-ins: " + ", ".join(arg_signature(t) for t in bi))
    return "\n".join(lines)


def tool_specs(connected: list[str], keep: set[str] | None = None) -> list[dict[str, Any]]:
    """OpenAI tool defs for the chat template, with REAL arg schemas where we have
    them (builtins now, connectors once fetch_connector_schemas.py runs); a generic
    object otherwise. Grounds the args the student trains on. `keep` trims to a
    bounded slice (see select_tools)."""
    return [
        {"type": "function", "function": {
            "name": name, "description": BUILTINS.get(name, ""),
            "parameters": parameters_for(name)}}
        for name in available_tools(connected) if keep is None or name in keep
    ]


def _used_tools(steps: list[dict[str, Any]]) -> list[str]:
    return [s["tool"] for s in steps if isinstance(s, dict) and "tool" in s]


def select_tools(connected: list[str], used: list[str], rng, cap: int = TOOL_CAP) -> set[str]:
    """Bounded tool slice for one training trace: the tools it uses + the built-ins,
    then random distractors up to `cap`. Never drops a used tool or a built-in (so
    the trace stays consistent), just bounds the distractors that bloat the seq."""
    keep = list(dict.fromkeys([*used, *BUILTINS.keys()]))
    pool = [t for t in available_tools(connected) if t not in keep]
    rng.shuffle(pool)
    for t in pool:
        if len(keep) >= cap:
            break
        keep.append(t)
    return set(keep)


RUNNER_SYS = (
    "You are Go Farther, executing a saved automation. Carry out the instruction "
    "using the available tools — one tool call at a time, reading each result "
    "before the next — then finish with a short result summary for the user.\n\n"
    "Available tools:\n{tools}"
)

TRACE_PROMPT = (
    "Execute this automation:\n{instruction}\n\n"
    "Write the realistic execution as a JSON array of steps. Each step is either a "
    'tool call with a plausible result:\n'
    '  {{"tool": "TOOL_NAME", "args": {{...}}, "result": "<short realistic value the tool returns>"}}\n'
    "or the final step:\n"
    '  {{"final": "<one-sentence result summary for the user>"}}\n'
    "Rules: use 1-5 tool steps, ONLY tools from the list above, in a sensible order, "
    "then exactly one final step. For each call, use the tool's EXACT argument names "
    "from its (signature) and include every required arg (the ones without a '?'). "
    "Output ONLY the JSON array."
)


def gen_trace(teacher: Teacher, instruction: str, connected: list[str]) -> list[dict[str, Any]] | None:
    sysp = RUNNER_SYS.format(tools=tool_menu(connected))
    out = teacher.text(sysp, TRACE_PROMPT.format(instruction=instruction), max_tokens=1600)
    s, e = out.find("["), out.rfind("]")
    if s == -1 or e <= s:
        return None
    try:
        steps = json.loads(out[s : e + 1])
    except json.JSONDecodeError:
        return None
    return steps if isinstance(steps, list) else None


def valid_trace(steps: list[dict[str, Any]], connected: list[str]) -> bool:
    """Structural check: 1-5 tool steps then a final, every tool real/available,
    and every call's args fit the tool's real schema (where we have one)."""
    if not steps or "final" not in steps[-1]:
        return False
    tools = set(available_tools(connected))
    calls = steps[:-1]
    if not (1 <= len(calls) <= 5):
        return False
    for c in calls:
        if not (isinstance(c, dict) and c.get("tool") in tools):
            return False
        if validate_args(c.get("tool", ""), c.get("args", {})):
            return False  # args don't fit the real schema -> drop the trace
    return True


def to_chat(connected: list[str], instruction: str, steps: list[dict[str, Any]],
            keep: set[str] | None = None) -> dict[str, Any]:
    """Serialize a trace into OpenAI-style tool-calling messages + the tool list.
    `keep` bounds the menu (system prompt + tools) so the example fits the seq."""
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": RUNNER_SYS.format(tools=tool_menu(connected, keep))},
        {"role": "user", "content": instruction},
    ]
    for i, st in enumerate(steps):
        if "final" in st:
            messages.append({"role": "assistant", "content": str(st["final"])})
            break
        tcid = f"call_{i + 1}"
        messages.append({"role": "assistant", "content": "", "tool_calls": [
            {"id": tcid, "type": "function", "function": {
                "name": st.get("tool", ""), "arguments": json.dumps(st.get("args", {}), ensure_ascii=False)}}]})
        messages.append({"role": "tool", "tool_call_id": tcid, "content": str(st.get("result", ""))})
    return {"messages": messages, "tools": tool_specs(connected, keep)}


def load_scenarios() -> list[tuple[str, list[str]]]:
    """(instruction, connected) pairs from the phase-1 builder dataset."""
    out: list[tuple[str, list[str]]] = []
    if not BUILDER_DATA.exists():
        return out
    for line in BUILDER_DATA.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        connected = connected_from_system(row.get("system", ""))
        try:
            instr = json.loads(row["assistant"]).get("instruction", "")
        except (json.JSONDecodeError, KeyError):
            continue
        if instr and connected:
            out.append((instr, connected))
    return out


def generate(n: int, seed: int = 0) -> None:
    import random
    rng = random.Random(seed)
    teacher = make_teacher()
    scenarios = load_scenarios()
    if not scenarios:
        print(f"no builder scenarios at {BUILDER_DATA} — generate phase-1 data first")
        return
    rng.shuffle(scenarios)
    OUT_DIR.mkdir(exist_ok=True)
    all_path = OUT_DIR / "all.jsonl"
    kept: list[dict[str, Any]] = []
    for instr, connected in scenarios:
        if len(kept) >= n:
            break
        try:
            steps = gen_trace(teacher, instr, connected)
        except Exception as e:  # noqa: BLE001
            print(f"  trace failed: {e}")
            continue
        if not steps or not valid_trace(steps, connected):
            print("  rejected: bad/empty trace")
            continue
        keep = select_tools(connected, _used_tools(steps), rng)
        kept.append(to_chat(connected, instr, steps, keep))
        with all_path.open("w" if len(kept) == 1 else "a", encoding="utf-8") as f:
            f.write(json.dumps(kept[-1], ensure_ascii=False) + "\n")
        print(f"[{len(kept)}/{n}] {instr[:64]}")
    if not kept:
        print("no traces kept — left existing data untouched")
        return
    rng.shuffle(kept)
    n_val = max(1, len(kept) // 10)
    _write(OUT_DIR / "val.jsonl", kept[:n_val])
    _write(OUT_DIR / "train.jsonl", kept[n_val:])
    print(f"\nwrote {len(kept) - n_val} train + {n_val} val traces to {OUT_DIR}/")


def _write(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def selftest() -> None:
    """Offline: prove trace -> chat serialization + validation without a teacher."""
    connected = ["gmail", "slack"]
    steps = [
        {"tool": "GMAIL_FETCH_EMAILS", "args": {"query": "is:unread"}, "result": "3 unread emails"},
        {"tool": "SLACK_SEND_MESSAGE", "args": {"channel": "#me", "markdown_text": "You have 3 unread"}, "result": "sent"},
        {"final": "Posted your 3 unread emails to Slack."},
    ]
    assert valid_trace(steps, connected)
    chat = to_chat(connected, "Post my unread Gmail count to Slack", steps)
    roles = [m["role"] for m in chat["messages"]]
    assert roles == ["system", "user", "assistant", "tool", "assistant", "tool", "assistant"], roles
    assert chat["messages"][2]["tool_calls"][0]["function"]["name"] == "GMAIL_FETCH_EMAILS"
    assert any(t["function"]["name"] == "SLACK_SEND_MESSAGE" for t in chat["tools"])
    # a phantom tool must be rejected
    assert not valid_trace([{"tool": "FAKE_TOOL", "args": {}, "result": "x"}, {"final": "done"}], connected)
    # builtin args are grounded against the real schema (tool_schemas.json)
    assert valid_trace([
        {"tool": "GF_WEATHER", "args": {"location": "NYC"}, "result": "Sunny, 72F"},
        {"final": "Sent the NYC forecast."}], connected)
    assert not valid_trace([
        {"tool": "GF_WEATHER", "args": {}, "result": "x"},   # missing required 'location'
        {"final": "done"}], connected)
    # real schema flows into the tool specs the student trains on
    wspec = next(t for t in tool_specs(connected) if t["function"]["name"] == "GF_WEATHER")
    assert wspec_required(wspec) == ["location"], wspec
    # tool-cap (v2): a multi-app menu is bounded, but the used tools + built-ins
    # are always kept — so big workflows fit the seq window instead of dropping.
    import random as _rng
    big = ["gmail", "slack", "notion", "googlecalendar"]
    keep = select_tools(big, ["GMAIL_FETCH_EMAILS"], _rng.Random(0), cap=12)
    assert "GMAIL_FETCH_EMAILS" in keep and set(BUILTINS) <= keep, "lost used/builtins"
    assert len(keep) <= max(12, 1 + len(BUILTINS)), f"menu not bounded: {len(keep)}"
    capped = to_chat(big, "x",
        [{"tool": "GMAIL_FETCH_EMAILS", "args": {"query": "is:unread"}, "result": "ok"}, {"final": "done"}], keep)
    assert len(capped["tools"]) <= len(keep) and all(
        t["function"]["name"] in keep for t in capped["tools"]), "capped specs leaked a tool"
    print("runner selftest passed")


def wspec_required(spec: dict[str, Any]) -> list[str]:
    return spec["function"]["parameters"].get("required", [])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200, help="target clean traces")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--selftest", action="store_true", help="offline wiring check")
    ap.add_argument("--groq", action="store_true", help="free Groq teacher (GROQ_API_KEY)")
    ap.add_argument("--gemini", action="store_true", help="free Gemini teacher (GEMINI_API_KEY)")
    args = ap.parse_args()
    if args.groq:
        os.environ["TEACHER"] = "openai"
    if args.gemini:
        os.environ["TEACHER"] = "openai"
        os.environ.setdefault("TEACHER_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")
        os.environ.setdefault("TEACHER_MODEL", "gemini-2.0-flash")
    if args.selftest:
        selftest()
    else:
        generate(args.n, args.seed)
