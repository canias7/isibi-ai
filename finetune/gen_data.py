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
# Apps with a real create/send/update tool in ALLOWED (so a workflow can produce
# an outcome), spread across categories so the dataset isn't all email + chat.
# Verbs that mean a tool can produce an outcome (send/create/update/…), so a
# connector with one can anchor a useful automation.
_WRITE_VERBS = {
    "CREATE", "SEND", "UPDATE", "ADD", "POST", "REPLY", "UPLOAD", "EDIT", "SET",
    "MODIFY", "DELETE", "REMOVE", "MOVE", "CLOSE", "MERGE", "ARCHIVE", "CANCEL",
    "ASSIGN", "INSERT", "WRITE", "APPEND", "PUBLISH",
}


def _is_actiony(slug: str) -> bool:
    return any(p in _WRITE_VERBS for t in tools_for(slug) for p in t.split("_")[1:])


# Hand-picked core (kept readable, spread across categories) + EVERY other
# connector in ALLOWED that can take an action. Primaries are sampled from this,
# so the builder learns to author across the whole 826-connector universe — not
# just the original core. (The existing core-heavy data keeps the common apps
# dense; this just adds the long tail.)
_CORE_ACTIONY = [
    # messaging
    "gmail", "outlook", "slack", "telegram",
    # project / tasks
    "notion", "todoist", "googletasks", "asana", "trello", "clickup", "monday", "jira", "airtable",
    # calendar / docs / files
    "googlecalendar", "googlesheets", "googledocs", "googledrive", "excel", "canva",
    # crm / sales / marketing
    "hubspot", "salesforce", "sendgrid", "klaviyo",
    # social
    "linkedin", "twitter", "youtube", "spotify", "instagram",
]
ACTIONY = list(dict.fromkeys(_CORE_ACTIONY + [s for s in ALLOWED if _is_actiony(s)]))

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
            api_key=(os.environ.get("TEACHER_API_KEY") or os.environ.get("GROQ_API_KEY")
                     or os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY", "")),
            max_retries=4,  # ride out Groq free-tier 429s with exponential backoff
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
        msg = r.choices[0].message
        for call in (msg.tool_calls or []):
            try:
                return json.loads(call.function.arguments)
            except json.JSONDecodeError:
                pass
        # Fallback for providers that return the JSON as plain content instead of a
        # tool call (tool_choice support varies across Gemini/OpenRouter/etc.).
        if msg.content:
            t = msg.content.strip()
            s, e = t.find("{"), t.rfind("}")
            if s != -1 and e > s:
                try:
                    return json.loads(t[s:e + 1])
                except json.JSONDecodeError:
                    pass
        return None


def make_teacher() -> Teacher:
    kind = os.environ.get("TEACHER", "anthropic").lower()
    return AnthropicTeacher() if kind == "anthropic" else OpenAITeacher()


# --------------------------------------------------------------------------- #
# Generation
# --------------------------------------------------------------------------- #
def sample_connected(rng: random.Random) -> list[str]:
    """A believable connected set CENTERED on a uniformly-chosen primary app, so
    coverage spreads across the long tail of connectors instead of clustering on
    email/chat. The primary is returned first (brainstorm focuses requests on it)."""
    primary = frontend_id(rng.choice(ACTIONY))
    pool = [frontend_id(s) for s in ALLOWED if frontend_id(s) != primary]
    extras = sorted(set(rng.sample(pool, rng.randint(1, 3))))
    return [primary] + extras


def brainstorm(teacher: Teacher, connected: list[str], k: int) -> list[str]:
    primary = connected[0]
    sys = "You write short, varied automation requests a real person would ask for."
    user = (
        f"A user has these apps connected: {', '.join(connected)} (plus reminders, "
        f"weather, maps, image generation, and bank tools).\n"
        f"Write {k} DIFFERENT one-line automation requests they might want. MOST "
        f"should center on {primary} (use the other apps as supporting steps). Mix "
        f"scheduled ones (daily/weekly/hourly) and event-triggered ones (\"when X "
        f"happens\"); include some multi-step ones with a condition, and a few that "
        f"do TWO independent things at once (e.g. notify someone AND log it). One "
        f"per line, no numbering, no extra text."
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
    all_path = DATA / "all.jsonl"      # incremental safety copy (survives interrupts)
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
            # Only truncate all.jsonl once we actually have an example — a run that
            # keeps 0 (quota exhausted / teacher down) must NOT clobber existing data.
            with all_path.open("w" if len(kept) == 1 else "a", encoding="utf-8") as f:
                f.write(json.dumps(kept[-1], ensure_ascii=False) + "\n")
            print(f"[{len(kept)}/{n}] {req[:70]}")
            if len(kept) >= n:
                break

    if not kept:
        print("no examples kept (teacher unreachable / quota?) — left existing data untouched")
        return
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
    ap.add_argument("--groq", action="store_true",
                    help="free Groq Llama-3.3-70B teacher (just set GROQ_API_KEY)")
    ap.add_argument("--gemini", action="store_true",
                    help="free Google Gemini 2.0 Flash teacher (just set GEMINI_API_KEY)")
    args = ap.parse_args()
    if args.groq:
        os.environ["TEACHER"] = "openai"  # OpenAITeacher already defaults base_url+model to Groq
    if args.gemini:
        os.environ["TEACHER"] = "openai"
        os.environ.setdefault("TEACHER_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")
        os.environ.setdefault("TEACHER_MODEL", "gemini-2.0-flash")
    if args.selftest:
        selftest()
    else:
        generate(args.n, args.seed)
