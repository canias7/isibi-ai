"""Canonical tool contract — the model's vocabulary is OURS; backends plug in behind it.

The fine-tuned model emits CANONICAL tool names + args. Today those mirror
Composio (e.g. GMAIL_SEND_EMAIL{recipient_email, …}) and the GF_* builtins are
already our own code. This module is the ONE seam between that canonical
vocabulary and whatever actually executes a call — so switching off Composio
later is a change *here*, never a retrain.

Resolution is rule-based (no enumerating ~10k identity mappings):
  - GF_*                      -> backend "gf"        (our own code; already not Composio)
  - anything else in catalog  -> backend "composio"  (toolkit from catalog.py)
Per-tool OVERRIDES (a rename, an arg remap, a different backend) live in
`toolmap.json` — empty today; populate it as you migrate tools onto your own
connections. The execution layer (gofarther-mcp / run-workflows, in TS) should
mirror `resolve()` — one function, one place to change.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from catalog import ALL_BUILTIN_TOOLS, ALLOWED, known_tools

HERE = Path(__file__).parent
MAP_FILE = HERE / "toolmap.json"


@lru_cache(maxsize=1)
def _overrides() -> dict[str, Any]:
    if not MAP_FILE.exists():
        return {}
    try:
        return json.loads(MAP_FILE.read_text(encoding="utf-8")).get("overrides", {}) or {}
    except (OSError, ValueError):
        return {}


@lru_cache(maxsize=1)
def _tool_to_toolkit() -> dict[str, str]:
    rev: dict[str, str] = {}
    for slug, tools in ALLOWED.items():
        for t in tools:
            rev.setdefault(t, slug)
    return rev


def _resolve_with(tool: str, args: dict | None, ov: dict[str, Any]) -> dict[str, Any]:
    """Pure resolver (override passed in) so the mapping logic is testable."""
    args = dict(args or {})
    if ov.get("backend"):
        backend = ov["backend"]
    elif tool in ALL_BUILTIN_TOOLS or tool.startswith("GF_"):
        backend = "gf"
    else:
        backend = "composio"
    backend_tool = ov.get("backend_tool", tool)
    arg_map = ov.get("arg_map") or {}
    out_args = {arg_map.get(k, k): v for k, v in args.items()}
    toolkit = ov.get("toolkit") or _tool_to_toolkit().get(tool)
    return {"backend": backend, "tool": backend_tool, "toolkit": toolkit, "args": out_args}


def resolve(tool: str, args: dict | None = None) -> dict[str, Any]:
    """Canonical (tool, args) -> backend call: {backend, tool, toolkit, args}.

    The ONE place to change when you move a tool off Composio. Default is
    identity (Composio for connector tools, our own code for GF_*); an entry in
    toolmap.json's `overrides` can rename the tool and/or remap arg names and/or
    point it at a different backend — all without retraining the model."""
    return _resolve_with(tool, args, _overrides().get(tool, {}))


def backend_of(tool: str) -> str:
    return resolve(tool)["backend"]


def canonical_tools() -> set[str]:
    """The model's vocabulary — exactly the tool names it's allowed to emit."""
    return known_tools()


def selftest() -> None:
    # connector tool -> composio backend, identity name/args, toolkit resolved
    r = resolve("GMAIL_SEND_EMAIL", {"recipient_email": "a@b.com", "subject": "hi"})
    assert r == {"backend": "composio", "tool": "GMAIL_SEND_EMAIL", "toolkit": "gmail",
                 "args": {"recipient_email": "a@b.com", "subject": "hi"}}, r
    # builtin -> our own backend
    assert backend_of("GF_WEATHER") == "gf"
    assert resolve("GF_WEATHER", {"location": "NYC"})["backend"] == "gf"
    # migrating Gmail onto our OWN connection = one override; the model never changes
    ov = {"backend": "gf", "backend_tool": "gmail_send",
          "arg_map": {"recipient_email": "to", "body": "html"}}
    r2 = _resolve_with("GMAIL_SEND_EMAIL", {"recipient_email": "a@b.com", "body": "<p>hi</p>"}, ov)
    assert r2["backend"] == "gf" and r2["tool"] == "gmail_send", r2
    assert r2["args"] == {"to": "a@b.com", "html": "<p>hi</p>"}, r2
    # canonical vocabulary == the model's known tools
    ct = canonical_tools()
    assert "GMAIL_SEND_EMAIL" in ct and "GF_WEATHER" in ct
    print("toolmap selftest passed")


if __name__ == "__main__":
    selftest()
    ct = canonical_tools()
    gf = sum(1 for t in ct if t.startswith("GF_"))
    print(f"canonical tools: {len(ct)}  ({gf} gf / {len(ct) - gf} composio by default)  overrides: {len(_overrides())}")
