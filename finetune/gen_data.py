"""Generate workflow-authoring training data by DISTILLING a strong teacher
(Sonnet by default) into JSONL the student (Qwen-7B) learns from.

Pipeline per round:
  1. sample a realistic subset of "connected" apps,
  2. ask the teacher to brainstorm varied user requests for that toolkit,
  3. ask the teacher to BUILD each request into an emit_workflow JSON,
  4. validate against the real schema; keep only clean examples,
  5. write {system, user, assistant} rows to data/train.jsonl + data/val.jsonl.

Teacher selection (env):
  TEACHER=anthropic           -> uses ANTHROPIC_API_KEY, model claude-sonnet-4-6
  TEACHER=openai              -> any OpenAI-compatible endpoint (Groq, OpenRouter,
                                 local vLLM/Ollama). Set TEACHER_BASE_URL,
                                 TEACHER_API_KEY, TEACHER_MODEL.

Examples:
  TEACHER=anthropic ANTHROPIC_API_KEY=sk-... python gen_data.py --n 400
  TEACHER=openai TEACHER_BASE_URL=https://api.groq.com/openai/v1 \
    TEACHER_API_KEY=gsk_... TEACHER_MODEL=llama-3.3-70b-versatile python gen_data.py --n 400
  python gen_data.py --selftest      # offline; no teacher, proves wiring
"""
from __future__ import annotations

import argparse
import json
import os
import random
from pathlib import Path
from typing import Any

from catalog import BUILTINS, frontend_id, tools_for, ALLOWED
from schema import SCHEMA_DOC, EXAMPLE, validate_workflow

HERE = Path(__file__).parent
DATA = HERE / "data"

# Apps that can SEND/CREATE (so a workflow can have an outcome), used to bias
# samples toward toolkits that make useful automations.
ACTIONY = ["gmail", "outlook", "slack", "notion", "googlecalendar", "todoist",
           "googlesheets", "googledocs", "jira", "asana", "trello", "hubspot",
           "telegram", "discord", "airtable", "linkedin", "googletasks"]

SYSTEM = (
    "You are the Go Farther workflow builder. The user describes an automation; "
    "you output a single workflow as JSON.\n\n" + SCHEMA_DOC
)


def builder_system(connected: list[str]) -> str:
    """System prompt shown to BOTH teacher and student: schema + this user's apps."""
    lines = [SYSTEM, "", "The user has these apps connected:"]
    for fid in connected:
        slug = next((s for s in ALLOWED if frontend_id(s) == fid), fid)
        lines.append(f"- {fid}: {', '.join(tools_for(slug)[:6])}")
    lines.append("- built-ins (always, via 'ai' nodes): " + ", ".join(BUILTINS))
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Teacher backends
# --------------------------------------------------------------------------- #
class Teacher:
    def text(self, system: str, user: str, max_tokens: int = 1024) -> str: ...
    def workflow(self, system: str, user: str) -> dict[str, Any] | None: ...


def _emit_tool_schema() -> dict[str, Any]:
    """Faithful copy of build-workflow's emit_workflow input_schema."""
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "instruction": {"type": "string"},
            "trigger": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["schedule", "event"]},
                    "schedule": {
                        "type": "object",
                        "properties": {
                            "freq": {"type": "string", "enum": ["daily", "weekly", "hourly"]},
                            "hour": {"type": "integer"}, "minute": {"type": "integer"},
                            "weekday": {"type": "integer"},
                        },
                    },
                    "event": {
                        "type": "object",
                        "properties": {
                            "app": {"type": "string"}, "filter": {"type": "string"},
                            "window": {
                                "type": "object",
                                "properties": {
                                    "start": {"type": "integer"}, "end": {"type": "integer"},
                                    "days": {"type": "array", "items": {"type": "integer"}},
                                },
                                "required": ["start", "end"],
                            },
                        },
                    },
                },
                "required": ["type"],
            },
            "nodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "kind": {"type": "string", "enum": ["trigger", "action", "decision"]},
                        "app": {"type": "string"}, "label": {"type": "string"}, "detail": {"type": "string"},
                    },
                    "required": ["id", "kind", "app", "label"],
                },
            },
            "edges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"from": {"type": "string"}, "to": {"type": "string"},
                                   "branch": {"type": "string", "enum": ["yes", "no"]}},
                    "required": ["from", "to"],
                },
            },
        },
        "required": ["title", "instruction", "trigger", "nodes", "edges"],
    }


class AnthropicTeacher(Teacher):
    def __init__(self) -> None:
        from anthropic import Anthropic  # lazy: only needed for this backend
        self.client = Anthropic()
        self.model = os.environ.get("TEACHER_MODEL", "claude-sonnet-4-6")

    def text(self, system: str, user: str, max_tokens: int = 1024) -> str:
        r = self.client.messages.create(
            model=self.model, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(b.text for b in r.content if b.type == "text")

    def workflow(self, system: str, user: str) -> dict[str, Any] | None:
        r = self.client.messages.create(
            model=self.model, max_tokens=2048, system=system,
            messages=[{"role": "user", "content": user}],
            tools=[{"name": "emit_workflow", "description": "Return the workflow.",
                    "input_schema": _emit_tool_schema()}],
            tool_choice={"type": "tool", "name": "emit_workflow"},
        )
        for b in r.content:
            if b.type == "tool_use" and b.name == "emit_workflow":
                return dict(b.input)
        return None


class OpenAITeacher(Teacher):
    """Any OpenAI-compatible endpoint: Groq, OpenRouter, vLLM, Ollama."""

    def __init__(self) -> None:
        from openai import OpenAI  # lazy
        self.client = OpenAI(
            base_url=os.environ.get("TEACHER_BASE_URL", "https://api.groq.com/openai/v1"),
            api_key=os.environ.get("TEACHER_API_KEY", os.environ.get("OPENAI_API_KEY", "")),
        )
        self.model = os.environ.get("TEACHER_MODEL", "llama-3.3-70b-versatile")

    def text(self, system: str, user: str, max_tokens: int = 1024) -> str:
        r = self.client.chat.completions.create(
            model=self.model, max_tokens=max_tokens,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        return r.choices[0].message.content or ""

    def workflow(self, system: str, user: str) -> dict[str, Any] | None:
        r = self.client.chat.completions.create(
            model=self.model, max_tokens=2048,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            tools=[{"type": "function", "function": {"name": "emit_workflow",
                    "description": "Return the workflow.", "parameters": _emit_tool_schema()}}],
            tool_choice={"type": "function", "function": {"name": "emit_workflow"}},
        )
        calls = r.choices[0].message.tool_calls or []
        if not calls:
            return None
        try:
            return json.loads(calls[0].function.arguments)
        except json.JSONDecodeError:
            return None


def make_teacher() -> Teacher:
    kind = os.environ.get("TEACHER", "anthropic").lower()
    return AnthropicTeacher() if kind == "anthropic" else OpenAITeacher()


# --------------------------------------------------------------------------- #
# Generation
# --------------------------------------------------------------------------- #
def sample_connected(rng: random.Random) -> list[str]:
    """A believable set of connected apps: 1-2 action apps + 0-2 extras."""
    pool = [frontend_id(s) for s in ALLOWED]
    actiony = [frontend_id(a) for a in ACTIONY]
    chosen = set(rng.sample(actiony, rng.randint(1, 2)))
    chosen.update(rng.sample(pool, rng.randint(0, 2)))
    return sorted(chosen)


def brainstorm(teacher: Teacher, connected: list[str], k: int) -> list[str]:
    sys = "You write short, varied automation requests a real person would ask for."
    user = (
        f"A user has these apps connected: {', '.join(connected)} (plus reminders, "
        f"weather, maps, image generation, and bank tools).\n"
        f"Write {k} DIFFERENT one-line automation requests they might want — mix "
        f"scheduled ones (daily/weekly/hourly) and event-triggered ones (\"when X "
        f"happens\"), some simple, some multi-step with a condition. One per line, "
        f"no numbering, no extra text."
    )
    out = teacher.text(sys, user, max_tokens=800)
    reqs = [ln.strip(" -*\t") for ln in out.splitlines() if len(ln.strip()) > 12]
    return reqs[:k]


def row(connected: list[str], request: str, wf: dict[str, Any]) -> dict[str, Any]:
    """One training example: system+user prompt -> the JSON workflow as the target."""
    return {
        "system": builder_system(connected),
        "user": request,
        "assistant": json.dumps(wf, ensure_ascii=False),
    }


def generate(n: int, seed: int = 0) -> None:
    rng = random.Random(seed)
    teacher = make_teacher()
    DATA.mkdir(exist_ok=True)
    kept: list[dict[str, Any]] = []
    seen: set[str] = set()
    attempts = 0
    while len(kept) < n and attempts < n * 4:
        attempts += 1
        connected = sample_connected(rng)
        try:
            requests = brainstorm(teacher, connected, k=min(8, n - len(kept) + 2))
        except Exception as e:  # noqa: BLE001 - keep the run going on a flaky call
            print(f"  brainstorm failed: {e}")
            continue
        for req in requests:
            if req.lower() in seen:
                continue
            seen.add(req.lower())
            try:
                wf = teacher.workflow(builder_system(connected), req)
            except Exception as e:  # noqa: BLE001
                print(f"  build failed: {e}")
                continue
            if not wf:
                continue
            ok, errs = validate_workflow(wf, connected=set(connected))
            if not ok:
                print(f"  rejected: {errs[0]}")
                continue
            kept.append(row(connected, req, wf))
            print(f"[{len(kept)}/{n}] {req[:70]}")
            if len(kept) >= n:
                break

    rng.shuffle(kept)
    n_val = max(1, len(kept) // 10)
    _write(DATA / "val.jsonl", kept[:n_val])
    _write(DATA / "train.jsonl", kept[n_val:])
    print(f"\nwrote {len(kept) - n_val} train + {n_val} val rows to {DATA}/")


def _write(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def selftest() -> None:
    """Offline: prove prompt-building + row format without any teacher/network."""
    connected = ["gmail", "slack"]
    sys = builder_system(connected)
    assert "gmail:" in sys and "GMAIL_SEND_EMAIL" in sys
    r = row(connected, "Every morning email me a digest of unread mail", EXAMPLE)
    assert set(r) == {"system", "user", "assistant"}
    assert json.loads(r["assistant"])["title"] == EXAMPLE["title"]
    print("system prompt preview:\n" + sys[:400] + "\n...")
    print("\nrow keys:", list(r))
    print("selftest passed")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200, help="target clean examples")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--selftest", action="store_true", help="offline wiring check")
    args = ap.parse_args()
    if args.selftest:
        selftest()
    else:
        generate(args.n, args.seed)
