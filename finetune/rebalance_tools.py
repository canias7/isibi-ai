"""Re-curate each connector's tools to a balanced READ + WRITE mix, and fill the
tool-less ones. The first cut verb-ranked then capped, which let write-heavy
toolkits (e.g. GitHub) end up all-CREATE with no reads. This re-picks from the
full important set so every connector can both read and act.

Regenerates: catalog_connectors.json (model catalog tools), tool_schemas.json
(arg schemas for the chosen tools), backend_connector_additions.json (ALLOWED).
Run build_workflow_artifacts.py afterwards.

    COMPOSIO_API_KEY=...  python rebalance_tools.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

from build_connector_catalog import fetch_all
from fetch_connector_schemas import compact
import catalog as C

HERE = Path(__file__).parent
ROOT = HERE.parent
CATALOG = HERE / "catalog_connectors.json"
SCHEMAS = HERE / "tool_schemas.json"
ALLOW = HERE / "backend_connector_additions.json"
INDEX = HERE / "connectors" / "index.json"

READ = ["SEARCH", "LIST", "GET", "FETCH", "FIND", "RETRIEVE", "READ", "QUERY", "DOWNLOAD", "EXPORT", "COUNT"]
WRITE = ["CREATE", "SEND", "UPDATE", "ADD", "POST", "REPLY", "UPLOAD", "EDIT", "SET",
         "MODIFY", "DELETE", "REMOVE", "MOVE", "CLOSE", "MERGE", "ARCHIVE", "CANCEL", "ASSIGN"]
CAP = 20


def cat_of(slug: str) -> str:
    for p in slug.split("_")[1:]:
        if p in READ:
            return "read"
        if p in WRITE:
            return "write"
    return "other"


def _rank(names: list[str], verbs: list[str]) -> list[str]:
    def score(n: str):
        best = 0
        for p in n.split("_")[1:]:
            if p in verbs:
                best = max(best, len(verbs) - verbs.index(p))
        return (-best, len(n))
    return sorted(names, key=score)


def balance(names: list[str], cap: int = CAP) -> list[str]:
    """Interleave top reads and top writes so the set can do both, then fill."""
    reads = _rank([n for n in names if cat_of(n) == "read"], READ)
    writes = _rank([n for n in names if cat_of(n) == "write"], WRITE)
    others = [n for n in names if cat_of(n) == "other"]
    out: list[str] = []
    i = j = 0
    while len(out) < cap and (i < len(reads) or j < len(writes)):
        if i < len(reads):
            out.append(reads[i]); i += 1
        if len(out) < cap and j < len(writes):
            out.append(writes[j]); j += 1
    if len(out) < cap:
        out += others[: cap - len(out)]
    return out[:cap]


def main() -> None:
    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        print("set COMPOSIO_API_KEY and re-run"); sys.exit(1)

    print("fetching all important tools…")
    imp = fetch_all("v3.1/tools", {"important": "true", "limit": "500"}, key)
    bykit: dict[str, dict[str, dict]] = {}
    for t in imp:
        tk = t.get("toolkit")
        slug = tk.get("slug") if isinstance(tk, dict) else tk
        if slug and t.get("slug"):
            bykit.setdefault(slug, {})[t["slug"]] = t
    print(f"  {len(imp)} important tools across {len(bykit)} toolkits")

    cat = json.loads(CATALOG.read_text())
    conn = cat["connectors"]
    idx = {t["slug"]: t for t in json.loads(INDEX.read_text())["toolkits"]}
    appids = set(re.findall(r"id: '([a-z0-9_]+)'", (ROOT / "src" / "connectorData.ts").read_text()))
    fid2slug = {C.frontend_id(s): s for s in C.ALLOWED}
    app_slugs = {fid2slug.get(i, i) for i in appids}

    # tool-less app connectors (not in catalog, no important tools) -> fetch full
    toolless = [s for s in app_slugs if s not in conn and s not in bykit]
    for s in toolless:
        try:
            full = fetch_all("v3.1/tools", {"toolkit_slug": s, "limit": "200"}, key)
        except Exception:
            full = []
        if full:
            bykit[s] = {t["slug"]: t for t in full if t.get("slug")}

    schemas = json.loads(SCHEMAS.read_text())
    stools = schemas["tools"]

    def apply(slug: str, info: dict) -> None:
        td = bykit.get(slug, {})
        names = list(td) or info.get("tools", [])
        bal = balance(names) if td else info.get("tools", [])[:CAP]
        info["tools"] = bal
        for n in bal:
            if n in td:
                stools[n] = compact(td[n].get("input_parameters") or {})

    for slug, info in conn.items():
        apply(slug, info)
    # add any tool-less app connectors we just fetched
    for s in toolless:
        if s in bykit and s not in conn:
            m = idx.get(s, {})
            conn[s] = {"name": m.get("name") or s, "category": m.get("category", ""),
                       "frontend_id": C.frontend_id(s), "supported": False, "tools": []}
            apply(s, conn[s])

    cat["connectors"] = conn
    cat.setdefault("_meta", {})["rebalanced"] = "read+write mix"
    CATALOG.write_text(json.dumps(cat, ensure_ascii=False, indent=1) + "\n")
    SCHEMAS.write_text(json.dumps(schemas, ensure_ascii=False, indent=1) + "\n")

    # backend ALLOWED additions: every app connector except the hand-set gmail/outlook
    keep = {"gmail", "outlook"}
    allow = {s: conn[s]["tools"] for s in app_slugs
             if s in conn and s not in keep and conn[s]["tools"]}
    ad = json.loads(ALLOW.read_text())
    ad["ALLOWED_additions"] = allow
    ALLOW.write_text(json.dumps(ad, indent=2) + "\n")

    rw = sum(1 for c in conn.values()
             if any(cat_of(t) == "read" for t in c["tools"]) and any(cat_of(t) == "write" for t in c["tools"]))
    print(f"rebalanced {len(conn)} connectors ({rw} now have both read+write tools)")
    print(f"ALLOWED additions: {len(allow)} | grounded schemas: {len(stools)}")
    print("next: python build_workflow_artifacts.py")


if __name__ == "__main__":
    main()
