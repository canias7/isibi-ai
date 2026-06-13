"""JSON-Schema "grammar" for constrained decoding of workflows.

Passed to the local model as response_format (OpenAI-compatible) / format (Ollama
native), this forces the output to the exact workflow shape and locks the enum
fields — `kind`, `freq`, `branch`, and `app` (to the user's CONNECTED apps +
specials). That makes invalid-structure / invalid-enum / unconnected-app emits
structurally impossible. Cross-refs (edge -> node id) and phantom tool names in
prose still need the validator + self-correct retry — a grammar can't express
those.

Build it per-request with the user's connected frontend ids so `app` can only be
something they actually have.
"""
from __future__ import annotations

from typing import Any

from catalog import connector_ids

SPECIALS = ["schedule", "event", "ai", "decision"]


def workflow_json_schema(connected: list[str] | None = None) -> dict[str, Any]:
    """Build the constrained-decoding schema.

    By default `app` is locked to ALL real connector ids (+ specials) — this kills
    *phantom* apps while still letting the model emit the correct app even if it's
    not connected yet, so build-workflow's "Not connected → connect X" prompt can
    fire (better UX than forcing a wrong app). Pass `connected` to hard-restrict
    `app` to only those ids (strongest, but a request needing an unconnected app
    would be forced onto a connected one)."""
    apps = sorted(set(connected)) if connected else connector_ids()
    node_apps = apps + SPECIALS  # action/trigger nodes may also be ai/decision/schedule/event
    return {
        "type": "object",
        "additionalProperties": False,
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
                            "hour": {"type": "integer", "minimum": 0, "maximum": 23},
                            "minute": {"type": "integer", "minimum": 0, "maximum": 59},
                            "weekday": {"type": "integer", "minimum": 0, "maximum": 6},
                        },
                    },
                    "event": {
                        "type": "object",
                        "properties": {
                            "app": {"type": "string", "enum": apps or SPECIALS},
                            "filter": {"type": "string"},
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
                        "app": {"type": "string", "enum": node_apps},
                        "label": {"type": "string"},
                        "detail": {"type": "string"},
                    },
                    "required": ["id", "kind", "app", "label"],
                },
            },
            "edges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "from": {"type": "string"},
                        "to": {"type": "string"},
                        "branch": {"type": "string", "enum": ["yes", "no"]},
                    },
                    "required": ["from", "to"],
                },
            },
        },
        "required": ["title", "instruction", "trigger", "nodes", "edges"],
    }


if __name__ == "__main__":
    import json
    print(json.dumps(workflow_json_schema(["gmail", "slack"]), indent=2)[:600])
