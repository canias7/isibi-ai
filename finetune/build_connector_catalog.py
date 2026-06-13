"""Build a COMPLETE connector + tool catalog from Composio.

The curated `catalog.py` / `tool_schemas.json` keep ~6 tools per connector (enough
to ground the builder + a first runner). This builds the FULL surface so the
runner can later be trained connector-by-connector:

  connectors/index.json      every Composio toolkit (slug, name, tool_count,
                             category, supported=is it in the app's 54)
  connectors/<slug>.json     one file per app connector: ALL its tools with
                             name + short description + compact arg schema

Breadth (index = every connector available) + depth (full tools for the
connectors the app actually supports, which are the trainable ones).

    COMPOSIO_API_KEY=...  python build_connector_catalog.py            # app's 54 connectors, full tools
    COMPOSIO_API_KEY=...  python build_connector_catalog.py --only gmail
    COMPOSIO_API_KEY=...  python build_connector_catalog.py --all      # full tools for EVERY toolkit (huge)

Re-runnable. Index is always refreshed; per-connector files are (re)written for
whatever set you target.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from catalog import ALLOWED
from fetch_connector_schemas import compact   # reuse the schema-compacting logic

HERE = Path(__file__).parent
OUT = HERE / "connectors"
API = "https://backend.composio.dev/api"


def get_json(path: str, params: dict[str, str], key: str) -> dict[str, Any]:
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{API}/{path}?{q}", headers={
        "x-api-key": key, "User-Agent": "gofarther-finetune/1.0", "accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_all(path: str, base: dict[str, str], key: str) -> list[dict[str, Any]]:
    """Follow next_cursor pagination, with a hard page cap as a safety net."""
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(60):
        p = dict(base)
        if cursor:
            p["cursor"] = cursor
        body = get_json(path, p, key)
        items += body.get("items") or body.get("data") or []
        cursor = body.get("next_cursor")
        if not cursor:
            break
    return items


def short(text: Any, n: int = 140) -> str:
    s = " ".join(str(text or "").split())
    return s[: n - 1] + "…" if len(s) > n else s


def tool_entry(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "slug": t.get("slug"),
        "name": t.get("name"),
        "description": short(t.get("description")),
        "schema": compact(t.get("input_parameters") or {}),
    }


def build_index(key: str) -> dict[str, dict[str, Any]]:
    """Every Composio toolkit -> {slug, name, tool_count, category, supported}."""
    toolkits = fetch_all("v3/toolkits", {"limit": "1000"}, key)
    app = set(ALLOWED)
    rows = []
    for tk in toolkits:
        meta = tk.get("meta") or {}
        cats = tk.get("categories") or meta.get("categories") or []
        cat = cats[0].get("name") if cats and isinstance(cats[0], dict) else (cats[0] if cats else "")
        rows.append({
            "slug": tk.get("slug"),
            "name": tk.get("name"),
            "tool_count": meta.get("tools_count", 0),
            "category": cat,
            "supported": tk.get("slug") in app,
        })
    rows.sort(key=lambda r: (not r["supported"], -r["tool_count"]))
    OUT.mkdir(exist_ok=True)
    (OUT / "index.json").write_text(json.dumps({
        "_meta": {
            "source": "Composio v3 /toolkits",
            "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "total_toolkits": len(rows),
            "supported_in_app": sum(r["supported"] for r in rows),
            "total_tools_all": sum(r["tool_count"] for r in rows),
        },
        "toolkits": rows,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"index: {len(rows)} toolkits ({sum(r['supported'] for r in rows)} supported), "
          f"{sum(r['tool_count'] for r in rows)} tools total -> connectors/index.json")
    return {r["slug"]: r for r in rows}


def build_connector(slug: str, name: str, key: str) -> int:
    tools = fetch_all("v3.1/tools", {"toolkit_slug": slug, "limit": "500"}, key)
    entries = [tool_entry(t) for t in tools if t.get("slug")]
    (OUT / f"{slug}.json").write_text(json.dumps({
        "slug": slug, "name": name, "tool_count": len(entries), "tools": entries,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return len(entries)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="build just this toolkit slug")
    ap.add_argument("--all", action="store_true", help="full tools for EVERY toolkit (huge)")
    args = ap.parse_args()

    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        print("set COMPOSIO_API_KEY and re-run")
        sys.exit(1)

    index = build_index(key)
    if args.only:
        targets = [args.only]
    elif args.all:
        targets = list(index.keys())
    else:
        targets = list(ALLOWED.keys())   # the app's supported connectors

    print(f"\nfetching full tools for {len(targets)} connector(s)…")
    grand = 0
    for i, slug in enumerate(targets, 1):
        name = (index.get(slug) or {}).get("name") or slug
        try:
            n = build_connector(slug, name, key)
        except Exception as e:  # noqa: BLE001 — keep going; missing ones are reported by the gap in totals
            print(f"  [{i}/{len(targets)}] {slug}: ERROR {str(e)[:90]}")
            continue
        grand += n
        print(f"  [{i}/{len(targets)}] {slug:20} {n} tools")
        time.sleep(0.05)   # be gentle on the API
    print(f"\ndone: {grand} tools across {len(targets)} connectors -> connectors/")


if __name__ == "__main__":
    main()
