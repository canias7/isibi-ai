"""Workflow JSON schema + validator — mirrors ``emit_workflow`` in
``supabase/functions/build-workflow/index.ts``.

The validator is used twice:
  1. data gen — drop any teacher example that isn't structurally valid, so the
     student only ever sees clean targets;
  2. eval — score the fine-tuned model's outputs (% valid JSON, % schema-valid).

``validate_workflow`` is intentionally strict about *structure* (the parts the
runner relies on) and lenient about prose, matching the production builder.
"""
from __future__ import annotations

import json
import re
from typing import Any

from catalog import known_tools, tool_prefixes, valid_app_ids

# Tool-name guard: a TOOLKIT_ACTION-shaped token (all-caps with an underscore)
# that sits under a known toolkit prefix but isn't a real tool is a phantom the
# teacher invented — reject it so the student never learns to cite fake tools.
_TOKEN_RE = re.compile(r"\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b")
_KNOWN_TOOLS = known_tools()
_TOOL_PREFIXES = tuple(tool_prefixes())


def phantom_tools(text: str) -> list[str]:
    """TOOLKIT_-prefixed tokens in ``text`` that aren't real tools."""
    bad: list[str] = []
    for tok in _TOKEN_RE.findall(text or ""):
        if tok in _KNOWN_TOOLS:
            continue
        if any(tok.startswith(pre + "_") for pre in _TOOL_PREFIXES):
            bad.append(tok)
    return bad

# Compact, human-readable schema we put in the system prompt so both the teacher
# and the student see the exact target shape.
SCHEMA_DOC = """\
A workflow is a JSON object:
{
  "title": string,            // 2-5 words
  "instruction": string,      // ONE clear paragraph; what runs each time, naming the apps
  "trigger": {
    "type": "schedule" | "event",
    "schedule": {             // when type == "schedule"
      "freq": "daily" | "weekly" | "hourly",
      "hour": 0-23, "minute": 0-59,
      "weekday": 0-6          // 0=Sun..6=Sat, weekly only
    },
    "event": {                // when type == "event"
      "app": connector_id,    // app to watch
      "filter": string,       // short natural-language condition
      "window": {             // OPTIONAL active hours; omit to watch all day
        "start": 0-1439, "end": 0-1439,   // minutes from local midnight
        "days": [0-6]
      }
    }
  },
  "nodes": [                  // ordered; FIRST node is the trigger
    { "id": "n1", "kind": "trigger"|"action"|"decision",
      "app": connector_id | "schedule" | "event" | "ai" | "decision",
      "label": string,        // 2-4 words
      "detail": string }      // one short sentence
  ],
  "edges": [                  // node-id flow; a decision has two: branch "yes" and "no"
    { "from": "n1", "to": "n2", "branch": "yes"|"no"|null }
  ]
}
Rules:
- Output ONLY the JSON object — no prose, no code fences.
- The FIRST node must be the trigger.
- Only use apps the user has connected. event.app must be a connected connector
  id (never 'ai', 'decision', or 'schedule').
- Times are 24-hour: hour is an integer 0-23 (4pm = 16, 9am = 9), minute 0-59.
  weekday (weekly only) is exactly: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5,
  Sat=6 — it MUST match the day you name in the title/instruction.
- Every edge's "from" and "to" must reference a node id you defined above.
- A decision node has exactly two outgoing edges — one branch "yes" and one
  branch "no" — going to DIFFERENT nodes. If you don't need a branch, don't use
  a decision node at all.
- Built-in abilities (reminders, weather, maps, image, memory, bank) are 'ai'
  nodes whose detail names the action (e.g. GF_MAPS, GF_SET_REMINDER)."""

_FREQ = {"daily", "weekly", "hourly"}
_KIND = {"trigger", "action", "decision"}


def _err(errors: list[str], msg: str) -> None:
    errors.append(msg)


def validate_workflow(wf: Any, connected: set[str] | None = None) -> tuple[bool, list[str]]:
    """Return (ok, errors). ``connected`` (frontend ids) optionally enforces
    that every app used was actually connected — set it in eval to catch the
    builder inventing apps."""
    errors: list[str] = []
    valid_apps = valid_app_ids()

    if not isinstance(wf, dict):
        return False, ["not a JSON object"]

    for key in ("title", "instruction", "trigger", "nodes", "edges"):
        if key not in wf:
            _err(errors, f"missing '{key}'")
    if errors:
        return False, errors

    if not isinstance(wf["title"], str) or not wf["title"].strip():
        _err(errors, "title must be a non-empty string")
    if not isinstance(wf["instruction"], str) or not wf["instruction"].strip():
        _err(errors, "instruction must be a non-empty string")

    # --- trigger ---
    trig = wf["trigger"]
    if not isinstance(trig, dict) or trig.get("type") not in {"schedule", "event"}:
        _err(errors, "trigger.type must be 'schedule' or 'event'")
    else:
        if trig["type"] == "schedule":
            sch = trig.get("schedule")
            if not isinstance(sch, dict):
                _err(errors, "schedule trigger needs a 'schedule' object")
            else:
                if sch.get("freq") not in _FREQ:
                    _err(errors, "schedule.freq must be daily|weekly|hourly")
                if not isinstance(sch.get("hour"), int) or not 0 <= sch.get("hour", -1) <= 23:
                    _err(errors, "schedule.hour must be 0-23")
                if not isinstance(sch.get("minute"), int) or not 0 <= sch.get("minute", -1) <= 59:
                    _err(errors, "schedule.minute must be 0-59")
                if sch.get("freq") == "weekly" and not (isinstance(sch.get("weekday"), int) and 0 <= sch["weekday"] <= 6):
                    _err(errors, "weekly schedule needs weekday 0-6")
        else:  # event
            ev = trig.get("event")
            if not isinstance(ev, dict):
                _err(errors, "event trigger needs an 'event' object")
            else:
                app = ev.get("app")
                if app not in valid_apps or app in {"schedule", "event", "ai", "decision"}:
                    _err(errors, f"event.app '{app}' is not a connectable app")
                if connected is not None and app not in connected:
                    _err(errors, f"event.app '{app}' is not connected")
                if not isinstance(ev.get("filter"), str) or not ev.get("filter", "").strip():
                    _err(errors, "event.filter must be a non-empty string")

    # --- nodes ---
    nodes = wf["nodes"]
    ids: set[str] = set()
    if not isinstance(nodes, list) or not nodes:
        _err(errors, "nodes must be a non-empty array")
    else:
        if nodes[0].get("kind") != "trigger":
            _err(errors, "the first node must be the trigger")
        for i, n in enumerate(nodes):
            if not isinstance(n, dict):
                _err(errors, f"node[{i}] not an object"); continue
            nid = n.get("id")
            if not isinstance(nid, str) or not nid:
                _err(errors, f"node[{i}] needs a string id")
            elif nid in ids:
                _err(errors, f"duplicate node id '{nid}'")
            else:
                ids.add(nid)
            if n.get("kind") not in _KIND:
                _err(errors, f"node '{nid}' kind invalid")
            app = n.get("app")
            if app not in valid_apps:
                _err(errors, f"node '{nid}' app '{app}' invalid")
            elif connected is not None and app not in (connected | {"schedule", "event", "ai", "decision"}):
                _err(errors, f"node '{nid}' app '{app}' not connected")
            if not isinstance(n.get("label"), str) or not n.get("label", "").strip():
                _err(errors, f"node '{nid}' needs a label")

    # --- edges ---
    edges = wf["edges"]
    if not isinstance(edges, list):
        _err(errors, "edges must be an array")
    else:
        for i, e in enumerate(edges):
            if not isinstance(e, dict):
                _err(errors, f"edge[{i}] not an object"); continue
            if e.get("from") not in ids:
                _err(errors, f"edge[{i}] 'from' references unknown node")
            if e.get("to") not in ids:
                _err(errors, f"edge[{i}] 'to' references unknown node")
        # every decision node should branch yes + no
        for n in nodes if isinstance(nodes, list) else []:
            if isinstance(n, dict) and n.get("kind") == "decision":
                outs = [e for e in edges if isinstance(e, dict) and e.get("from") == n.get("id")]
                branches = {e.get("branch") for e in outs}
                if "yes" not in branches or "no" not in branches:
                    _err(errors, f"decision node '{n.get('id')}' needs yes and no branches")
                else:
                    yes_to = next((e.get("to") for e in outs if e.get("branch") == "yes"), None)
                    no_to = next((e.get("to") for e in outs if e.get("branch") == "no"), None)
                    if yes_to is not None and yes_to == no_to:
                        _err(errors, f"decision node '{n.get('id')}' yes/no must go to different nodes")

    # --- tool-name guard: instruction + node details must not cite fake tools ---
    texts = [wf.get("instruction", "")]
    for n in nodes if isinstance(nodes, list) else []:
        if isinstance(n, dict):
            texts.append(str(n.get("detail", "")))
            texts.append(str(n.get("label", "")))
    flagged: list[str] = []
    for t in texts:
        for tok in phantom_tools(t):
            if tok not in flagged:
                flagged.append(tok)
    for tok in flagged:
        _err(errors, f"cites unknown tool '{tok}'")

    return (not errors), errors


def parse_and_validate(text: str, connected: set[str] | None = None) -> tuple[bool, list[str], Any]:
    """Extract the first JSON object from model output and validate it."""
    text = text.strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return False, ["no JSON object found"], None
    try:
        wf = json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        return False, [f"invalid JSON: {e}"], None
    ok, errs = validate_workflow(wf, connected)
    return ok, errs, wf


# Canonical example (from build-workflow) — used as a self-test + a few-shot seed.
EXAMPLE = {
    "title": "Morning Inbox Digest",
    "instruction": "Each morning, fetch the user's unread Gmail from the last 24 hours. If there are none, email a short note saying 'No new unread email today' and stop. Otherwise write a concise digest grouped by sender, flag anything urgent, and send it to the user's own Gmail with the subject 'Your morning inbox digest'.",
    "trigger": {"type": "schedule", "schedule": {"freq": "daily", "hour": 8, "minute": 0}},
    "nodes": [
        {"id": "n1", "kind": "trigger", "app": "schedule", "label": "Daily 8 AM", "detail": "Runs every morning"},
        {"id": "n2", "kind": "action", "app": "gmail", "label": "Get unread", "detail": "Unread Gmail from the last 24h"},
        {"id": "n3", "kind": "decision", "app": "decision", "label": "Any unread?", "detail": "Branch on whether there is new mail"},
        {"id": "n4", "kind": "action", "app": "ai", "label": "Summarize", "detail": "Group by sender, flag urgent"},
        {"id": "n5", "kind": "action", "app": "gmail", "label": "Email digest", "detail": "Send the summary to the user"},
        {"id": "n6", "kind": "action", "app": "gmail", "label": "Email none", "detail": "Send 'no new email' note"},
    ],
    "edges": [
        {"from": "n1", "to": "n2"},
        {"from": "n2", "to": "n3"},
        {"from": "n3", "to": "n4", "branch": "yes"},
        {"from": "n3", "to": "n6", "branch": "no"},
        {"from": "n4", "to": "n5"},
    ],
}


if __name__ == "__main__":
    ok, errs = validate_workflow(EXAMPLE)
    print("example valid:", ok, errs)
    assert ok, errs
    bad = {"title": "x", "instruction": "y", "trigger": {"type": "nope"}, "nodes": [], "edges": []}
    ok2, errs2 = validate_workflow(bad)
    print("bad rejected:", not ok2, "->", errs2[:3])
    assert not ok2
    # tool-name guard
    assert phantom_tools("uses GOOGLECALENDAR_UPDATE_RECORD then GMAIL_SEND_EMAIL") == ["GOOGLECALENDAR_UPDATE_RECORD"]
    assert phantom_tools("GF_WEATHER and SALESFORCE_EXECUTE_SOQL_QUERY are fine") == []
    assert phantom_tools("an ACH transfer or API_KEY is not a tool") == []
    print("schema self-test passed")
