"""Snapshot REAL connector tool arg schemas from Composio into tool_schemas.json.

Builtins (GF_*) ship in tool_schemas.json already (they're defined locally in
gofarther-mcp). Connector tools (GMAIL_*, SLACK_*, …) get their schemas from
Composio at runtime, so we snapshot them ONCE here — decoupling data-gen from a
live Composio call and giving runner_gen.py real args to ground against.

    COMPOSIO_API_KEY=...  python fetch_connector_schemas.py

The key is the same Supabase secret gofarther-mcp uses (Dashboard → Edge
Functions → Secrets → COMPOSIO_API_KEY). Re-runnable; builtins are preserved.
Schemas are compacted (top-level property types + enums + required) to keep the
student's training prompt lean.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from catalog import ALLOWED

HERE = Path(__file__).parent
SCHEMA_FILE = HERE / "tool_schemas.json"
BASE = "https://backend.composio.dev/api/v3.1/tools"   # same endpoint gofarther-mcp uses
BATCH = 20   # tool_slugs is a query param — batch to avoid URL-length / giant requests


def fetch_batch(slugs: list[str], key: str) -> list[dict[str, Any]]:
    q = urllib.parse.urlencode({"tool_slugs": ",".join(slugs), "limit": str(len(slugs))})
    # Custom UA: the default python-urllib UA gets blocked by some CDNs.
    req = urllib.request.Request(f"{BASE}?{q}", headers={
        "x-api-key": key, "User-Agent": "gofarther-finetune/1.0", "accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.loads(r.read().decode("utf-8"))
    return body.get("items") or body.get("data") or (body if isinstance(body, list) else [])


def compact(schema: Any) -> dict[str, Any]:
    """Strip a Composio input_parameters schema to what grounding needs: top-level
    property types + enums + required (nested internals collapse to their type)."""
    if not isinstance(schema, dict):
        return {"type": "object"}
    out_props: dict[str, Any] = {}
    for k, v in (schema.get("properties") or {}).items():
        if not isinstance(v, dict):
            out_props[k] = {}
            continue
        spec: dict[str, Any] = {}
        if "type" in v:
            spec["type"] = v["type"]
        if "enum" in v:
            spec["enum"] = v["enum"]
        out_props[k] = spec
    out: dict[str, Any] = {"type": schema.get("type", "object"), "properties": out_props}
    req = schema.get("required")
    if isinstance(req, list) and req:
        out["required"] = req
    return out


def main() -> None:
    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        print("set COMPOSIO_API_KEY and re-run (Supabase: Edge Functions → Secrets)")
        sys.exit(1)

    data = json.loads(SCHEMA_FILE.read_text(encoding="utf-8")) if SCHEMA_FILE.exists() else {}
    tools: dict[str, Any] = data.setdefault("tools", {})
    slugs = sorted({t for lst in ALLOWED.values() for t in lst})
    print(f"fetching {len(slugs)} connector tool schemas from Composio…")

    got = miss = 0
    for i in range(0, len(slugs), BATCH):
        batch = slugs[i:i + BATCH]
        try:
            items = fetch_batch(batch, key)
        except Exception as e:  # noqa: BLE001 — keep going; report at the end
            print(f"  batch @{i}: {str(e)[:120]}")
            continue
        by_slug = {it.get("slug"): it for it in items}
        for s in batch:
            it = by_slug.get(s)
            ip = it.get("input_parameters") if isinstance(it, dict) else None
            if ip:
                tools[s] = compact(ip)
                got += 1
            else:
                miss += 1
                print(f"    no schema for {s}")
        print(f"  {min(i + BATCH, len(slugs))}/{len(slugs)}")

    data["tools"] = tools
    data.setdefault("_meta", {})["connectors_fetched"] = got
    SCHEMA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\ndone: +{got} connector schemas ({miss} missing) -> tool_schemas.json")


if __name__ == "__main__":
    main()
