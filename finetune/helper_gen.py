"""Phase 2b — distill the workflow DETECTOR and TESTER skills into the runner model.

Two more agentic skills that live in run-workflows (detectItems) and
test-workflow, both currently on Claude/Haiku. Each is the RUNNER's skill with a
different OUTPUT shape, so we fold their traces into runner_data/ — the one
gf-runner model then learns execute + detect + test.

  DETECTOR: given an app + condition, look up matching items via tools, output a
            JSON array [{"id","line"}] with stable ids. (run-workflows events.)
  TESTER:   run a workflow's steps "right now", output a JSON object
            {"summary","steps":[{"id","ok","output"}]}. (test-workflow.)

Scenarios come from the phase-1 builder dataset (its workflows have an
instruction, nodes=steps, and event app/filter), so it seeds for free.

  python helper_gen.py --selftest                       # offline wiring check
  TEACHER_MODEL=claude-haiku-4-5 ANTHROPIC_API_KEY=... python helper_gen.py --n 150
"""
from __future__ import annotations

import argparse
import json
import os
import random
from pathlib import Path
from typing import Any

from gen_data import Teacher, make_teacher
from runner_gen import (
    available_tools, connected_from_system, tool_menu, tool_specs, _write,
)

HERE = Path(__file__).parent
BUILDER_DATA = HERE / "data" / "train.jsonl"
OUT_DIR = HERE / "runner_data"   # fold into the runner dataset

DETECTOR_SYS = (
    "You check whether a trigger condition is currently met in a connected app. "
    "Use ONLY the available tools to look up the most recent items matching the "
    "user's condition, then report them.\n\nAvailable tools:\n{tools}"
)
DETECTOR_PROMPT = (
    "App: {app}\nCondition to watch for: {filter}\n\nFind the most recent matching "
    "items right now. Write the realistic execution as a JSON array of steps. Each "
    'tool step: {{"tool":"TOOL_NAME","args":{{...}},"result":"<short realistic value>"}}. '
    'The final step is {{"final":[{{"id":"<stable id from the tool result>",'
    '"line":"<short one-line description>"}}, ...]}} — the detected items (newest '
    "first, real ids only; [] if none). Use 1-2 tool steps, ONLY tools from the "
    "list above, then exactly one final step. Output ONLY the JSON array."
)

TESTER_SYS = (
    "You are Go Farther, running this saved automation for the user RIGHT NOW (they "
    "tapped Test to watch it run). Carry out the steps in order using the connected "
    "tools, and be strictly honest about each step's outcome.\n\nAvailable tools:\n{tools}"
)
TESTER_PROMPT = (
    "Run this automation now:\n{instruction}\n\nSTEPS (id — what it does):\n{steps}\n\n"
    "Write the realistic execution as a JSON array of steps. Each tool step: "
    '{{"tool":"TOOL_NAME","args":{{...}},"result":"<short realistic value>"}}. The '
    'final step is {{"final":{{"summary":"2-3 plain sentences on the overall '
    'outcome","steps":[{{"id":"<step id>","ok":true,"output":"one short line"}}]}}}} '
    "with exactly one entry per step id above, same order. Use 1-5 tool steps, ONLY "
    "tools from the list above, then exactly one final step. Output ONLY the JSON array."
)


def gen_steps(teacher: Teacher, sysp: str, prompt: str) -> list[dict[str, Any]] | None:
    out = teacher.text(sysp, prompt, max_tokens=1600)
    s, e = out.find("["), out.rfind("]")
    if s == -1 or e <= s:
        return None
    try:
        steps = json.loads(out[s : e + 1])
    except json.JSONDecodeError:
        return None
    return steps if isinstance(steps, list) and steps else None


def valid(steps: list[dict[str, Any]], connected: list[str], final_type: type) -> bool:
    """1-5 tool steps then a final of the right JSON type; every tool real/available."""
    if not steps or "final" not in steps[-1] or not isinstance(steps[-1]["final"], final_type):
        return False
    tools = set(available_tools(connected))
    calls = steps[:-1]
    if not (1 <= len(calls) <= 5):
        return False
    return all(isinstance(c, dict) and c.get("tool") in tools for c in calls)


def to_chat(sysp: str, user: str, connected: list[str], steps: list[dict[str, Any]]) -> dict[str, Any]:
    """Serialize to OpenAI tool-calling messages; the final assistant content is the
    detector array / tester object as compact JSON (what prod parses)."""
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": sysp},
        {"role": "user", "content": user},
    ]
    for i, st in enumerate(steps):
        if "final" in st:
            messages.append({"role": "assistant", "content": json.dumps(st["final"], ensure_ascii=False)})
            break
        tcid = f"call_{i + 1}"
        messages.append({"role": "assistant", "content": "", "tool_calls": [
            {"id": tcid, "type": "function", "function": {
                "name": st.get("tool", ""), "arguments": json.dumps(st.get("args", {}), ensure_ascii=False)}}]})
        messages.append({"role": "tool", "tool_call_id": tcid, "content": str(st.get("result", ""))})
    return {"messages": messages, "tools": tool_specs(connected)}


def load_scenarios() -> tuple[list[dict], list[dict]]:
    """(detector, tester) scenarios from the builder dataset.
    detector: event-trigger workflows -> {app, filter, connected}
    tester:   any workflow with action steps -> {instruction, steps, connected}"""
    det: list[dict] = []
    tst: list[dict] = []
    if not BUILDER_DATA.exists():
        return det, tst
    for line in BUILDER_DATA.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        connected = connected_from_system(row.get("system", ""))
        if not connected:
            continue
        try:
            wf = json.loads(row["assistant"])
        except (json.JSONDecodeError, KeyError):
            continue
        nodes = [n for n in (wf.get("nodes") or []) if n.get("kind") != "trigger" and n.get("id")]
        instr = (wf.get("instruction") or "").strip()
        if instr and nodes:
            tst.append({"instruction": instr, "connected": connected,
                        "steps": [{"id": n["id"], "label": n.get("label", "")} for n in nodes]})
        ev = (wf.get("trigger") or {}).get("event") or {}
        if ev.get("app") and ev.get("filter"):
            det.append({"app": ev["app"], "filter": ev["filter"], "connected": connected})
    return det, tst


def generate(n: int, seed: int = 0) -> None:
    rng = random.Random(seed)
    teacher = make_teacher()
    det, tst = load_scenarios()
    if not det and not tst:
        print(f"no builder scenarios at {BUILDER_DATA} — generate phase-1 data first")
        return
    rng.shuffle(det); rng.shuffle(tst)
    OUT_DIR.mkdir(exist_ok=True)
    kept: list[dict[str, Any]] = []
    half = n // 2

    # DETECTOR
    for sc in det:
        if sum(1 for k in kept if k.get("_kind") == "det") >= half:
            break
        sysp = DETECTOR_SYS.format(tools=tool_menu(sc["connected"]))
        try:
            steps = gen_steps(teacher, sysp, DETECTOR_PROMPT.format(app=sc["app"], filter=sc["filter"]))
        except Exception as ex:  # noqa: BLE001
            print(f"  det failed: {ex}"); continue
        if not steps or not valid(steps, sc["connected"], list):
            print("  rejected: bad detector trace"); continue
        row = to_chat(sysp, f"App: {sc['app']}\nCondition to watch for: {sc['filter']}", sc["connected"], steps)
        row["_kind"] = "det"; kept.append(row)
        print(f"[det {sum(1 for k in kept if k.get('_kind')=='det')}] {sc['app']}: {sc['filter'][:48]}")

    # TESTER
    for sc in tst:
        if sum(1 for k in kept if k.get("_kind") == "tst") >= n - half:
            break
        sysp = TESTER_SYS.format(tools=tool_menu(sc["connected"]))
        steplist = "\n".join(f"{s['id']} — {s['label']}" for s in sc["steps"])
        try:
            steps = gen_steps(teacher, sysp, TESTER_PROMPT.format(instruction=sc["instruction"], steps=steplist))
        except Exception as ex:  # noqa: BLE001
            print(f"  tst failed: {ex}"); continue
        if not steps or not valid(steps, sc["connected"], dict):
            print("  rejected: bad tester trace"); continue
        row = to_chat(sysp, sc["instruction"], sc["connected"], steps)
        row["_kind"] = "tst"; kept.append(row)
        print(f"[tst {sum(1 for k in kept if k.get('_kind')=='tst')}] {sc['instruction'][:52]}")

    if not kept:
        print("no traces kept — left existing data untouched"); return
    for r in kept:
        r.pop("_kind", None)
    rng.shuffle(kept)
    # APPEND to the runner dataset (don't clobber the execute traces already there)
    n_val = max(1, len(kept) // 10)
    _append(OUT_DIR / "val.jsonl", kept[:n_val])
    _append(OUT_DIR / "train.jsonl", kept[n_val:])
    print(f"\nappended {len(kept) - n_val} train + {n_val} val helper traces to {OUT_DIR}/")


def _append(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def selftest() -> None:
    connected = ["gmail", "slack"]
    # detector trace -> final is an items array
    det = [
        {"tool": "GMAIL_FETCH_EMAILS", "args": {"query": "is:unread newer_than:1d"}, "result": "2 new"},
        {"final": [{"id": "199c1f2a", "line": "Invoice from Acme"}]},
    ]
    assert valid(det, connected, list)
    chat = to_chat(DETECTOR_SYS.format(tools=tool_menu(connected)), "App: gmail\nCondition to watch for: invoices", connected, det)
    assert [m["role"] for m in chat["messages"]] == ["system", "user", "assistant", "tool", "assistant"]
    assert json.loads(chat["messages"][-1]["content"])[0]["id"] == "199c1f2a"
    # tester trace -> final is a {summary, steps} object
    tst = [
        {"tool": "SLACK_SEND_MESSAGE", "args": {"channel": "#me", "markdown_text": "hi"}, "result": "sent"},
        {"final": {"summary": "Posted the note.", "steps": [{"id": "n1", "ok": True, "output": "sent"}]}},
    ]
    assert valid(tst, connected, dict)
    chat = to_chat(TESTER_SYS.format(tools=tool_menu(connected)), "post a note to slack", connected, tst)
    assert json.loads(chat["messages"][-1]["content"])["steps"][0]["ok"] is True
    # phantom tool + wrong final type rejected
    assert not valid([{"tool": "FAKE", "args": {}, "result": "x"}, {"final": []}], connected, list)
    assert not valid([{"tool": "SLACK_SEND_MESSAGE", "args": {}, "result": "x"}, {"final": "a string"}], connected, dict)
    print("helper selftest passed")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=150, help="total helper traces (~half detector, half tester)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--groq", action="store_true")
    ap.add_argument("--gemini", action="store_true")
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
