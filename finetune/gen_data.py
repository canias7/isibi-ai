"""Generate workflow-authoring training data by DISTILLING a strong teacher
(Sonnet by default; set TEACHER_MODEL=claude-opus-4-8 for a stronger teacher)
into JSONL the student (Qwen-7B) learns from.

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
  # GROW the set (keeps the existing rows, dedups) with the stronger teacher:
  TEACHER=anthropic ANTHROPIC_API_KEY=sk-... TEACHER_MODEL=claude-opus-4-8 \
    python gen_data.py --n 400 --append
  TEACHER=openai TEACHER_BASE_URL=https://api.groq.com/openai/v1 \
    TEACHER_API_KEY=gsk_... TEACHER_MODEL=llama-3.3-70b-versatile python gen_data.py --n 400
  python gen_data.py --selftest      # offline; no teacher, proves wiring
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from catalog import BUILTINS, frontend_id, tools_for, tool_prefixes, ALLOWED
from schema import SCHEMA_DOC, EXAMPLE, validate_workflow

# Windows consoles default to cp1252, which can't encode the arrows/box chars in
# the coverage report (UnicodeEncodeError). Force UTF-8; no-op on Linux/macOS.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

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
def sample_connected(rng: random.Random, primaries: list[str] | None = None) -> list[str]:
    """A believable connected set CENTERED on a chosen primary app, so coverage
    spreads across the long tail of connectors instead of clustering on email/chat.
    The primary is returned first (brainstorm focuses requests on it). `primaries`
    (a possibly-weighted slug list) lets coverage mode bias toward under-covered apps."""
    primary = frontend_id(rng.choice(primaries or ACTIONY))
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


# Connector tool-id tokens (GMAIL_SEND_EMAIL, …) cited in the prose are exactly
# what the student later hallucinates ("phantom tools"). Keep GF_ built-in tokens
# (the 'ai' nodes name them on purpose); reject any other tool-shaped token so the
# student never learns to write — and therefore invent — connector tool ids. The
# runner discovers connector tools at run time, so plain prose loses nothing.
_TOOL_TOKEN_RE = re.compile(r"\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b")
_CONNECTOR_PREFIXES = tuple(p for p in tool_prefixes() if p != "GF")


def _cites_connector_tool(wf: dict[str, Any]) -> str | None:
    """First connector tool-id token found in instruction / node detail+label, else None."""
    texts = [str(wf.get("instruction", ""))]
    for n in (wf.get("nodes") or []):
        if isinstance(n, dict):
            texts.append(str(n.get("detail", "")))
            texts.append(str(n.get("label", "")))
    for t in texts:
        for tok in _TOOL_TOKEN_RE.findall(t):
            if tok.startswith("GF_"):
                continue
            if any(tok.startswith(pre + "_") for pre in _CONNECTOR_PREFIXES):
                return tok
    return None


# --------------------------------------------------------------------------- #
# Coverage-aware sampling: spend teacher calls (= credits) on connectors the data
# barely covers — especially newly-added apps with ZERO examples — instead of
# re-teaching apps the model already knows. Makes a retrain after a catalog
# expansion pay almost only for the new apps.
# --------------------------------------------------------------------------- #
_SPECIAL_APPS = {"schedule", "event", "ai", "decision"}


def _used_apps(wf: dict[str, Any]) -> set[str]:
    """Connector ids a workflow actually uses (node.app + event.app, no specials)."""
    used: set[str] = set()
    trig = wf.get("trigger")
    if isinstance(trig, dict) and isinstance(trig.get("event"), dict):
        app = trig["event"].get("app")
        if isinstance(app, str):
            used.add(app)
    for nd in (wf.get("nodes") or []):
        if isinstance(nd, dict) and isinstance(nd.get("app"), str):
            used.add(nd["app"])
    return used - _SPECIAL_APPS


def app_coverage(rows: list[dict[str, Any]]) -> Counter:
    """How many existing examples actually USE each connector id."""
    c: Counter = Counter()
    for r in rows:
        a = r.get("assistant")
        try:
            wf = json.loads(a) if isinstance(a, str) else a
        except json.JSONDecodeError:
            continue
        if isinstance(wf, dict):
            c.update(_used_apps(wf))
    return c


def _focus_pool(target: int) -> list[str]:
    """ACTIONY slugs weighted by how far below `target` examples each app is, so the
    primary is drawn mostly from under-covered apps (zero-example apps weigh most)."""
    cov = app_coverage(_read(DATA / "train.jsonl") + _read(DATA / "val.jsonl"))
    pool: list[str] = []
    for slug in ACTIONY:
        deficit = target - cov.get(frontend_id(slug), 0)
        if deficit > 0:
            pool += [slug] * deficit
    return pool


def coverage_report(target: int = 3) -> None:
    """Offline: per-connector example coverage + the gap to `target` (no teacher)."""
    cov = app_coverage(_read(DATA / "train.jsonl") + _read(DATA / "val.jsonl"))
    ids = [frontend_id(s) for s in ALLOWED]
    zero = [f for f in ids if cov.get(f, 0) == 0]
    under = [f for f in ids if 0 < cov.get(f, 0) < target]
    covered = [f for f in ids if cov.get(f, 0) >= target]
    builds = sum(max(0, target - cov.get(f, 0)) for f in ids)
    print(f"connectors in catalog: {len(ids)}   total app-uses in data: {sum(cov.values())}")
    print(f"target {target}/app  →  zero: {len(zero)}   under: {len(under)}   covered: {len(covered)}")
    print(f"teacher builds to bring every app to {target}: ~{builds}  "
          f"(vs ~{target * len(ids)} for a blind full regen)")
    print("\nleast-covered connectors:")
    for f in sorted(ids, key=lambda x: cov.get(x, 0))[:25]:
        print(f"  {cov.get(f, 0):3}  {f}")


def generate(n: int, seed: int = 0, append: bool = False, cover_target: int = 0) -> None:
    rng = random.Random(seed)
    teacher = make_teacher()
    DATA.mkdir(exist_ok=True)
    primaries = ACTIONY
    if cover_target > 0:
        pool = _focus_pool(cover_target)
        if pool:
            primaries = pool
            print(f"coverage mode: focusing on {len(set(pool))} connectors under "
                  f"{cover_target} examples ({len(pool)} weighted slots); covered apps skipped")
        else:
            print(f"coverage mode: every connector already has ≥{cover_target} examples — uniform sampling")
    all_path = DATA / "all.jsonl"      # incremental safety copy (survives interrupts)
    kept: list[dict[str, Any]] = []
    seen: set[str] = set()
    attempts = 0
    while len(kept) < n and attempts < n * 4:
        attempts += 1
        connected = sample_connected(rng, primaries)
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
            cited = _cites_connector_tool(wf)
            if cited:
                print(f"  rejected: cites connector tool '{cited}' in prose")
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

    # Merge with what's on disk so a regen GROWS the set instead of clobbering it.
    # --append keeps every existing row (dedup by exact content). Without it we
    # still back up the current files to *.bak first, so a regen is never a
    # silent, unrecoverable wipe of prior data.
    existing: list[dict[str, Any]] = []
    if append:
        existing = _read(DATA / "train.jsonl") + _read(DATA / "val.jsonl")
        seen_rows = {json.dumps(r, sort_keys=True, ensure_ascii=False) for r in existing}
        fresh = [r for r in kept
                 if json.dumps(r, sort_keys=True, ensure_ascii=False) not in seen_rows]
        print(f"append: {len(existing)} existing + {len(fresh)} new "
              f"({len(kept) - len(fresh)} duplicates dropped)")
    else:
        for name in ("train.jsonl", "val.jsonl"):
            p = DATA / name
            if p.exists():
                (DATA / (name + ".bak")).write_bytes(p.read_bytes())
                print(f"backed up {name} -> {name}.bak")
        fresh = kept

    combined = existing + fresh
    rng.shuffle(combined)
    n_val = max(1, len(combined) // 10)
    _write(DATA / "val.jsonl", combined[:n_val])
    _write(DATA / "train.jsonl", combined[n_val:])
    print(f"\nwrote {len(combined) - n_val} train + {n_val} val rows to {DATA}/ "
          f"(total {len(combined)})")


def _write(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def _read(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


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
    ap.add_argument("--append", action="store_true",
                    help="ADD to existing data/train.jsonl+val.jsonl instead of overwriting (dedups)")
    ap.add_argument("--cover-target", type=int, default=0, metavar="N",
                    help="coverage mode: bias generation toward connectors with FEWER than N "
                         "existing examples (new/under-covered apps get the teacher calls; "
                         "well-covered apps are skipped). 0 = off (uniform sampling).")
    ap.add_argument("--coverage", action="store_true",
                    help="offline: report per-connector example coverage and exit (no teacher).")
    args = ap.parse_args()
    if args.groq:
        os.environ["TEACHER"] = "openai"  # OpenAITeacher already defaults base_url+model to Groq
    if args.gemini:
        os.environ["TEACHER"] = "openai"
        os.environ.setdefault("TEACHER_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")
        os.environ.setdefault("TEACHER_MODEL", "gemini-2.0-flash")
    if args.coverage:
        coverage_report(args.cover_target or 3)
    elif args.selftest:
        selftest()
    else:
        generate(args.n, args.seed, append=args.append, cover_target=args.cover_target)
