"""Phase 3 — distill the main CHAT assistant into the local model.

The hardest target. The builder (phase 1) emits one JSON; the runner (phase 2)
executes a FIXED instruction; chat handles ARBITRARY user messages — general
questions, app actions, quick facts, casual talk — deciding when to use a tool
and when to just answer. A 7B will trail Claude most here, so treat this as a
HYBRID enabler (local for simple/common asks, Claude for the hard ones), not a
full replacement. See CHAT.md.

Approach mirrors runner_gen.py: a teacher brainstorms diverse user messages, then
role-plays each response — 0-5 tool calls (with plausible results) ending in a
natural answer — serialized as an OpenAI tool-calling chat. Reuses the runner's
tool helpers + trace format; the only real difference is open-ended scenarios and
that many turns use NO tools (just an answer).

  python chat_gen.py --selftest
  TEACHER=anthropic ANTHROPIC_API_KEY=... python chat_gen.py --n 400
  GEMINI_API_KEY=... python chat_gen.py --n 400 --gemini
"""
from __future__ import annotations

import argparse
import json
import os
import random
from pathlib import Path
from typing import Any

from catalog import ALLOWED, frontend_id
from gen_data import make_teacher, Teacher
from runner_gen import available_tools, tool_menu, tool_specs, _write

HERE = Path(__file__).parent
OUT_DIR = HERE / "chat_data"

# Action-capable apps to seed believable connected sets (reuse the builder's list
# implicitly via ALLOWED; here we just sample any connectors).
CHAT_SYS = (
    "You are Go Farther, a helpful personal assistant with access to the user's "
    "connected apps and built-in tools. Answer naturally and concisely. Use a "
    "tool only when it genuinely helps; otherwise just reply.\n\nAvailable tools:\n{tools}"
)

BRAINSTORM = (
    "A user has these apps connected: {apps} (plus reminders, weather, maps, image "
    "generation, and bank tools). Write {k} DIFFERENT one-line things they might "
    "say to this assistant. Mix: general questions needing NO tool, app actions "
    "(email/calendar/tasks/etc.), quick facts (weather/maps), money questions "
    "(bank), and casual chat. One per line, no numbering."
)

TRACE = (
    "User says: {msg}\n\n"
    "Respond as the assistant. Write the response as a JSON array of steps. Each "
    'tool step: {{"tool":"TOOL_NAME","args":{{...}},"result":"<plausible value>"}}. '
    'Final step: {{"final":"<natural reply to the user>"}}. Use 0-5 tool steps '
    "(ONLY from the available tools) — many messages need none — then exactly one "
    "final step. Output ONLY the JSON array."
)


def brainstorm(teacher: Teacher, connected: list[str], k: int) -> list[str]:
    out = teacher.text("You write short, varied things people say to a personal assistant.",
                       BRAINSTORM.format(apps=", ".join(connected), k=k), max_tokens=800)
    return [ln.strip(" -*\t") for ln in out.splitlines() if len(ln.strip()) > 6][:k]


def gen_trace(teacher: Teacher, msg: str, connected: list[str]) -> list[dict[str, Any]] | None:
    sysp = CHAT_SYS.format(tools=tool_menu(connected))
    out = teacher.text(sysp, TRACE.format(msg=msg), max_tokens=1400)
    s, e = out.find("["), out.rfind("]")
    if s == -1 or e <= s:
        return None
    try:
        steps = json.loads(out[s : e + 1])
    except json.JSONDecodeError:
        return None
    return steps if isinstance(steps, list) else None


def valid_trace(steps: list[dict[str, Any]], connected: list[str]) -> bool:
    """0-5 tool steps then a final; any tool steps must be real/available."""
    if not steps or "final" not in steps[-1]:
        return False
    tools = set(available_tools(connected))
    calls = steps[:-1]
    if len(calls) > 5:
        return False
    return all(isinstance(c, dict) and c.get("tool") in tools for c in calls)


def to_chat(connected: list[str], msg: str, steps: list[dict[str, Any]]) -> dict[str, Any]:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": CHAT_SYS.format(tools=tool_menu(connected))},
        {"role": "user", "content": msg},
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
    return {"messages": messages, "tools": tool_specs(connected)}


def sample_connected(rng: random.Random) -> list[str]:
    pool = [frontend_id(s) for s in ALLOWED]
    return sorted(set(rng.sample(pool, rng.randint(2, 4))))


def generate(n: int, seed: int = 0) -> None:
    rng = random.Random(seed)
    teacher = make_teacher()
    OUT_DIR.mkdir(exist_ok=True)
    all_path = OUT_DIR / "all.jsonl"
    kept: list[dict[str, Any]] = []
    seen: set[str] = set()
    attempts = 0
    while len(kept) < n and attempts < n * 4:
        attempts += 1
        connected = sample_connected(rng)
        try:
            msgs = brainstorm(teacher, connected, k=min(8, n - len(kept) + 2))
        except Exception as e:  # noqa: BLE001
            print(f"  brainstorm failed: {e}")
            continue
        for msg in msgs:
            if msg.lower() in seen:
                continue
            seen.add(msg.lower())
            try:
                steps = gen_trace(teacher, msg, connected)
            except Exception as e:  # noqa: BLE001
                print(f"  trace failed: {e}")
                continue
            if not steps or not valid_trace(steps, connected):
                print("  rejected: bad trace")
                continue
            kept.append(to_chat(connected, msg, steps))
            with all_path.open("w" if len(kept) == 1 else "a", encoding="utf-8") as f:
                f.write(json.dumps(kept[-1], ensure_ascii=False) + "\n")
            print(f"[{len(kept)}/{n}] {msg[:64]}")
            if len(kept) >= n:
                break
    if not kept:
        print("no traces kept — left existing data untouched")
        return
    rng.shuffle(kept)
    n_val = max(1, len(kept) // 10)
    _write(OUT_DIR / "val.jsonl", kept[:n_val])
    _write(OUT_DIR / "train.jsonl", kept[n_val:])
    print(f"\nwrote {len(kept) - n_val} train + {n_val} val chats to {OUT_DIR}/")


def selftest() -> None:
    connected = ["gmail", "gcal"]
    # no-tool answer
    assert valid_trace([{"final": "I can manage your email, calendar, reminders and more."}], connected)
    # tool answer
    steps = [{"tool": "GOOGLECALENDAR_FIND_EVENT", "args": {"day": "today"}, "result": "2 meetings"},
             {"final": "You've got 2 meetings today."}]
    assert valid_trace(steps, connected)
    chat = to_chat(connected, "what's on my calendar today?", steps)
    assert [m["role"] for m in chat["messages"]] == ["system", "user", "assistant", "tool", "assistant"]
    assert not valid_trace([{"tool": "FAKE", "args": {}, "result": "x"}, {"final": "ok"}], connected)
    print("chat selftest passed")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
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
