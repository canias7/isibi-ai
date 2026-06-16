"""Expand the model's connector catalog to the WHOLE Composio universe.

The app supports 54 connectors (curated verbatim in catalog.py). This pulls every
other Composio toolkit's IMPORTANT tools (Composio's own curation) + their arg
schemas, so the fine-tuned model can support the entire universe — then training
can add connectors one batch at a time.

Efficient: the global `?important=true` tools endpoint spans all toolkits
(~14.2k tools, ~29 pages at limit 500), so this is ~29 calls, not 1043.

Writes:
  catalog_connectors.json   every toolkit -> {name, category, frontend_id, tools}
                            (important tools, verb-ranked, capped) — catalog.py
                            merges this on top of the verbatim 54.
  tool_schemas.json         merged with the arg schema for every tool added here
                            (so runner_gen grounds args for the universe too).

    COMPOSIO_API_KEY=...  python build_universe_catalog.py [--cap 20]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from build_connector_catalog import fetch_all          # paginated Composio GET
from fetch_connector_schemas import compact            # schema -> compact form
from catalog import ALIASES, ALLOWED                   # the verbatim 54 (kept as-is)

HERE = Path(__file__).parent
CATALOG_OUT = HERE / "catalog_connectors.json"
SCHEMA_FILE = HERE / "tool_schemas.json"
INDEX_FILE = HERE / "connectors" / "index.json"

# Verb priority for picking the most useful tools when a toolkit has many
# important ones — core actions first, then shorter (less specialized) names.
_VERBS = ["SEND", "CREATE", "FETCH", "GET", "LIST", "SEARCH", "UPDATE", "ADD",
          "REPLY", "POST", "FIND", "READ", "DOWNLOAD", "UPLOAD", "DELETE", "REMOVE"]


def rank_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def score(t: dict[str, Any]) -> tuple[int, int]:
        name = t.get("slug", "")
        best = 0
        for i, v in enumerate(_VERBS):
            if v in name:
                best = max(best, len(_VERBS) - i)
        return (-best, len(name))
    return sorted(tools, key=score)


def load_index() -> dict[str, dict[str, Any]]:
    if not INDEX_FILE.exists():
        return {}
    data = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    return {t["slug"]: t for t in data.get("toolkits", [])}


def check_coverage() -> None:
    """Report how much of the toolkit universe the built catalog covers. No API key."""
    if not CATALOG_OUT.exists():
        print(f"no {CATALOG_OUT.name} yet — run the build first")
        sys.exit(1)
    have = set((json.loads(CATALOG_OUT.read_text(encoding="utf-8")).get("connectors") or {}).keys())
    idx = load_index()
    if not idx:
        print(f"no {INDEX_FILE} — can't compute coverage (run build_connector_catalog.py to write the index)")
        sys.exit(1)
    with_tools = {s for s, m in idx.items() if int(m.get("tool_count") or 0) > 0}
    covered = have & with_tools
    missing = sorted(with_tools - have)
    pct = 100 * len(covered) // max(len(with_tools), 1)
    print(f"catalog connectors:           {len(have)}")
    print(f"toolkit universe (index):     {len(idx)}")
    print(f"  └ addressable (has tools):  {len(with_tools)}")
    print(f"coverage:                     {len(covered)}/{len(with_tools)} addressable ({pct}%)")
    if missing:
        print(f"\n⚠ missing {len(missing)} toolkits that have tools — re-run the build (without --important-only):")
        for s in missing[:20]:
            print(f"   - {s}  ({idx[s].get('name', '?')})")
        if len(missing) > 20:
            print(f"   … +{len(missing) - 20} more")
        sys.exit(1)
    print(f"\n✓ full coverage — every toolkit with tools is in the catalog ({len(covered)}/{len(with_tools)})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=int, default=20, help="max tools kept per connector")
    ap.add_argument("--important-only", action="store_true",
                    help="skip the second pass; keep only toolkits that have a Composio "
                         "'important' tool (~823). Default does BOTH passes = the full ~1043.")
    ap.add_argument("--check", action="store_true",
                    help="don't fetch — just report catalog coverage vs the toolkit index "
                         "(addressable = toolkits that have tools). Exits 1 if any are missing.")
    args = ap.parse_args()

    if args.check:
        check_coverage()
        return

    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        print("set COMPOSIO_API_KEY and re-run")
        sys.exit(1)

    print("fetching all IMPORTANT tools across every toolkit…")
    tools = fetch_all("v3.1/tools", {"important": "true", "limit": "500"}, key)
    print(f"  got {len(tools)} important tools")

    # group by toolkit slug
    by_kit: dict[str, list[dict[str, Any]]] = {}
    for t in tools:
        tk = t.get("toolkit")
        slug = tk.get("slug") if isinstance(tk, dict) else tk
        if slug and t.get("slug"):
            by_kit.setdefault(slug, []).append(t)

    index = load_index()
    existing_ids = {ALIASES.get(s, s) for s in ALLOWED}   # frontend ids already taken

    # Second pass: the global important=true fetch SKIPS any toolkit whose tools
    # Composio never flagged "important" (~221 of 1043 — incl. SharePoint, NetSuite,
    # Dropbox Sign…). Pull those directly (per-toolkit, unfiltered) so the catalog
    # spans the FULL universe, not just the important-flagged toolkits. One call per
    # missing toolkit that the index says actually has tools.
    if not args.important_only and index:
        missing = [s for s, m in index.items()
                   if s not in by_kit and int(m.get("tool_count") or 0) > 0]
        print(f"second pass: fetching tools for {len(missing)} toolkits with no 'important' tool…")
        added_kits = 0
        for j, slug in enumerate(missing, 1):
            try:
                kit_tools = fetch_all("v3.1/tools", {"toolkit_slug": slug, "limit": "500"}, key)
            except Exception as e:                      # one dud toolkit must not kill the run
                print(f"  [{j}/{len(missing)}] {slug}: fetch failed ({e}); skipping")
                continue
            kit_tools = [t for t in kit_tools if t.get("slug")]
            if kit_tools:
                by_kit[slug] = kit_tools
                added_kits += 1
            if j % 25 == 0:
                print(f"  …{j}/{len(missing)}")
        print(f"  second pass captured {added_kits} more toolkits")

    connectors: dict[str, Any] = {}
    schemas: dict[str, Any] = {}
    for slug, kit_tools in by_kit.items():
        chosen = rank_tools(kit_tools)[: args.cap]
        if not chosen:
            continue
        meta = index.get(slug, {})
        fid = ALIASES.get(slug, slug)
        # don't let a new connector's id collide with an existing one
        if slug not in ALLOWED and fid in existing_ids:
            fid = f"{slug}"  # keep the raw slug; collision on a non-aliased id is unlikely
        connectors[slug] = {
            "name": meta.get("name") or slug,
            "category": meta.get("category") or "",
            "frontend_id": fid,
            "supported": slug in ALLOWED,
            "tools": [t["slug"] for t in chosen],
        }
        for t in chosen:
            schemas[t["slug"]] = compact(t.get("input_parameters") or {})

    CATALOG_OUT.write_text(json.dumps({
        "_meta": {
            "source": ("Composio v3.1/tools?important=true" if args.important_only
                       else "Composio v3.1/tools (important=true + per-toolkit second pass = full universe)"),
            "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "connectors": len(connectors),
            "tools": sum(len(c["tools"]) for c in connectors.values()),
            "cap_per_connector": args.cap,
            "note": "catalog.py keeps the 54 supported connectors verbatim and merges the rest from here.",
        },
        "connectors": connectors,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # merge schemas into tool_schemas.json (existing builtins + curated 54 preserved)
    sdata = json.loads(SCHEMA_FILE.read_text(encoding="utf-8")) if SCHEMA_FILE.exists() else {"tools": {}}
    sdata.setdefault("tools", {})
    added = 0
    for name, sch in schemas.items():
        if name not in sdata["tools"]:
            added += 1
        sdata["tools"][name] = sch
    sdata.setdefault("_meta", {})["universe_tools"] = len(schemas)
    SCHEMA_FILE.write_text(json.dumps(sdata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"\ncatalog_connectors.json: {len(connectors)} connectors, "
          f"{sum(len(c['tools']) for c in connectors.values())} tools (cap {args.cap})")
    print(f"tool_schemas.json: +{added} new schemas -> {len(sdata['tools'])} total")


if __name__ == "__main__":
    main()
