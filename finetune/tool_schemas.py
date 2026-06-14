"""Real tool argument schemas — grounding for the phase-2 runner.

The runner's quality lever is ARGUMENTS, not tool names (the builder taught us
structure is easy once constrained). A trace that calls GMAIL_SEND_EMAIL with the
wrong arg names teaches the student to fail against the real tool. So we load the
real schemas (`tool_schemas.json`) and:
  - feed real `parameters` into the tool specs the student trains on,
  - show the teacher each tool's arg signature, and
  - reject any generated call whose args don't fit the schema (`validate_args`).

Coverage is graceful: builtins (GF_*) ship now from gofarther-mcp; connectors are
populated by `fetch_connector_schemas.py` once a COMPOSIO_API_KEY is available.
A tool with no schema validates as OK (we can't check what we don't have) and
shows just its name — so the pipeline runs today and tightens as schemas land.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
SCHEMA_FILE = HERE / "tool_schemas.json"

_GENERIC = {"type": "object", "additionalProperties": True}


@lru_cache(maxsize=1)
def load_schemas() -> dict[str, dict[str, Any]]:
    """name -> JSON schema, from tool_schemas.json (empty if the file is absent)."""
    if not SCHEMA_FILE.exists():
        return {}
    data = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    return data.get("tools", {})


def schema_for(name: str) -> dict[str, Any] | None:
    """The real arg schema for a tool, or None if we don't have one."""
    return load_schemas().get(name)


def parameters_for(name: str) -> dict[str, Any]:
    """Tool-spec `parameters`: the real schema if known, else a generic object."""
    return schema_for(name) or _GENERIC


def arg_signature(name: str) -> str:
    """Compact signature for the teacher's tool menu, e.g. GF_WEATHER(location, units?).

    Required args bare, optional args suffixed '?'. Just the name when unknown.
    """
    sch = schema_for(name)
    if not sch:
        return name
    props = list(sch.get("properties", {}).keys())
    if not props:
        return f"{name}()"
    req = set(sch.get("required", []))
    parts = [p if p in req else f"{p}?" for p in props]
    return f"{name}({', '.join(parts)})"


def validate_args(name: str, args: Any) -> list[str]:
    """Errors if ``args`` don't fit the tool's real schema. [] = ok (or unknown tool).

    High-signal, low-false-positive checks only — unknown keys, missing required,
    and enum membership. We deliberately skip deep/loose type checks so a teacher
    passing "50" for an int isn't dropped; the goal is correct arg *shapes*.
    """
    sch = schema_for(name)
    if sch is None:
        return []  # no schema -> can't validate, stay lenient
    if not isinstance(args, dict):
        return [f"{name}: args must be an object"]
    errs: list[str] = []
    props: dict[str, Any] = sch.get("properties", {})
    allow_extra = bool(sch.get("additionalProperties", False))
    for k in args:
        if k not in props and not allow_extra:
            errs.append(f"{name}: unknown arg '{k}'")
    for req in sch.get("required", []):
        v = args.get(req)
        if req not in args or v is None or v == "":
            errs.append(f"{name}: missing required arg '{req}'")
    for k, v in args.items():
        spec = props.get(k)
        if isinstance(spec, dict) and spec.get("enum") and v not in spec["enum"]:
            errs.append(f"{name}: arg '{k}'={v!r} not in {spec['enum']}")
    return errs


def coverage() -> tuple[int, int]:
    """(tools with a real schema, of which are connectors) — for status printouts."""
    tools = load_schemas()
    connectors = sum(1 for n in tools if not n.startswith("GF_"))
    return len(tools), connectors


if __name__ == "__main__":
    total, conn = coverage()
    print(f"tool_schemas.json: {total} schemas ({total - conn} builtins, {conn} connectors)")
    # spot-check the validator on a builtin
    assert validate_args("GF_WEATHER", {"location": "NYC"}) == []
    assert validate_args("GF_WEATHER", {}) != []                       # missing required
    assert validate_args("GF_WEATHER", {"location": "x", "units": "kelvin"}) != []  # bad enum
    assert validate_args("GF_WEATHER", {"location": "x", "foo": 1}) != []           # unknown arg
    assert validate_args("NOT_A_REAL_TOOL_XYZ", {"anything": 1}) == []  # no schema -> lenient
    print("signature:", arg_signature("GF_WEATHER"), "|", arg_signature("GF_MAPS"))
    print("tool_schemas self-check passed")
