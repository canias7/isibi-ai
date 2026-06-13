"""Bulk-add the rest of the connectable Composio universe to the app.

The app wires ~170 connectors by hand + first batches; this generates entries for
every OTHER *connectable* toolkit (managed OAuth / keyless / API-key, minus
Composio infra) and splices them into the frontend + backend handoff in one pass:

  src/connectorData.ts                   +entry {id,name,logo,color,desc,auth}
  src/brandLogos.tsx                     +bundled simple-icons glyph (where one exists)
  finetune/backend_connector_additions.json   +curated ALLOWED tools

Idempotent: connectors already in connectorData.ts are skipped, so re-running only
adds new ones. API-key connectors only *work* once gmail-oauth/connect-key is live
(BACKEND_HANDOFF.md §4) — run this AFTER that endpoint is validated.

    COMPOSIO_API_KEY=...  python build_app_connectors.py --dry-run     # report only
    COMPOSIO_API_KEY=...  python build_app_connectors.py [--limit N]   # write
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from catalog import frontend_id   # map Composio slug -> the app's connector id (outlook->m365, …)

HERE = Path(__file__).parent
ROOT = HERE.parent
CONNECTOR_DATA = ROOT / "src" / "connectorData.ts"
BRAND_LOGOS = ROOT / "src" / "brandLogos.tsx"
ALLOW_FILE = HERE / "backend_connector_additions.json"
CATALOG = HERE / "catalog_connectors.json"
API = "https://backend.composio.dev/api"

# Composio infrastructure / meta toolkits — never user-facing apps.
SKIP = {"composio", "composio_search", "test_app", "bench", "entelligence",
        "deepwiki_mcp", "code_interpreter", "codeinterpreter", "browser_tool",
        "text_to_pdf", "googlesuper", "slackbot", "discordbot"}
CATDESC = {"crm": "CRM & sales", "developer tools": "Developer tools", "analytics": "Analytics",
           "marketing automation": "Marketing", "accounting": "Accounting", "project management": "Projects",
           "communication": "Messaging", "documents": "Docs & files", "ecommerce": "Commerce",
           "customer support": "Support", "human resources": "HR", "forms & surveys": "Forms",
           "artificial intelligence": "AI", "databases": "Databases", "email newsletters": "Email"}


def get(path: str, params: dict[str, str], key: str) -> dict[str, Any]:
    req = urllib.request.Request(f"{API}/{path}?{urllib.parse.urlencode(params)}",
                                 headers={"x-api-key": key, "User-Agent": "gf/1.0", "accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_toolkits(key: str) -> list[dict[str, Any]]:
    out, cursor = [], None
    for _ in range(10):
        p = {"limit": "1000"}
        if cursor:
            p["cursor"] = cursor
        b = get("v3/toolkits", p, key)
        out += b.get("items") or []
        cursor = b.get("next_cursor")
        if not cursor:
            break
    return out


def kind(t: dict[str, Any]) -> str:
    if t.get("composio_managed_auth_schemes"):
        return "managed"
    a = t.get("auth_schemes") or []
    if "NO_AUTH" in a:
        return "keyless"
    if any(k in a for k in ("API_KEY", "BEARER_TOKEN", "BASIC", "BASIC_WITH_JWT")):
        return "apikey"
    return "oauth_manual" if any(k in a for k in ("OAUTH2", "OAUTH1")) else "other"


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def si_index() -> dict[str, str]:
    """slug -> hex, from simple-icons data (cached in /tmp)."""
    cache = Path("/tmp/si_data.json")
    if not cache.exists():
        req = urllib.request.Request("https://cdn.jsdelivr.net/npm/simple-icons@latest/data/simple-icons.json",
                                     headers={"User-Agent": "gf/1.0"})
        cache.write_bytes(urllib.request.urlopen(req, timeout=40).read())
    data = json.loads(cache.read_text())
    icons = data.get("icons") if isinstance(data, dict) else data
    idx: dict[str, str] = {}
    for ic in icons:
        for k in (ic.get("slug"), norm(ic.get("title", ""))):
            if k:
                idx.setdefault(k, ic.get("hex", ""))
    return idx


def fetch_path(slug: str) -> str | None:
    try:
        req = urllib.request.Request(f"https://cdn.jsdelivr.net/npm/simple-icons/icons/{slug}.svg",
                                     headers={"User-Agent": "gf/1.0"})
        m = re.search(r'\bd="([^"]+)"', urllib.request.urlopen(req, timeout=12).read().decode())
        return m.group(1) if m else None
    except Exception:
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="cap how many to add (0 = all)")
    ap.add_argument("--all-connectable", action="store_true",
                    help="also add connectable toolkits that have no curated tools yet")
    args = ap.parse_args()
    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        print("set COMPOSIO_API_KEY and re-run")
        sys.exit(1)

    existing = set(re.findall(r"id: '([a-z0-9_]+)'", CONNECTOR_DATA.read_text()))
    cat = json.loads(CATALOG.read_text()).get("connectors", {}) if CATALOG.exists() else {}
    toolkits = fetch_toolkits(key)
    todo = [t for t in toolkits if kind(t) in ("managed", "keyless", "apikey")
            and t["slug"] not in SKIP and frontend_id(t["slug"]) not in existing
            and (args.all_connectable or cat.get(t["slug"], {}).get("tools"))]  # skip aliased dupes
    todo.sort(key=lambda t: -(t.get("meta") or {}).get("tools_count", 0))
    if args.limit:
        todo = todo[: args.limit]

    print(f"toolkits: {len(toolkits)} | already in app: {len(existing)} | to add: {len(todo)}"
          + ("  (DRY RUN)" if args.dry_run else ""))
    if args.dry_run:
        for t in todo[:15]:
            print(f"  + {t['slug']:22} {t['name'][:24]:24} {kind(t)}")
        print("  …" if len(todo) > 15 else "")
        return

    si = si_index()
    cdata, brands, allow, logos = [], [], {}, 0
    for t in todo:
        slug, name = t["slug"], t["name"]
        fid = frontend_id(slug)   # app connector id (== slug for all new ones)
        c = cat.get(slug, {})
        a = "keyless" if kind(t) == "keyless" else ("apikey" if kind(t) == "apikey" else "oauth")
        category = c.get("category", "")
        desc = CATDESC.get(category, category.title() if category else ("No key needed" if a == "keyless" else "Connect with an API key"))[:32]
        color, path, lslug = "#6B7280", None, None
        for cand in dict.fromkeys([norm(slug), slug.replace("_", ""), slug]):
            if cand in si and si[cand]:
                color, lslug = "#" + si[cand], cand
                break
        if lslug:
            path = fetch_path(lslug)
        logo = f"si('{lslug}')" if (lslug and path) else f"cl('{fid}')"
        cdata.append(f"  {{ id: '{fid}', name: {json.dumps(name)}, logo: {logo}, color: '{color}', desc: {json.dumps(desc)}, auth: '{a}' }},")
        if path:
            brands.append(f'  {fid}: {{ color: "{color}", path: "{path}" }},')
            logos += 1
        if c.get("tools"):
            allow[slug] = c["tools"][:8]

    _insert(CONNECTOR_DATA, "export const CONNECTORS: Connector[] = [", "\n];", cdata)
    _insert(BRAND_LOGOS, "export const BRANDS: Record<string, Brand> = {", "\n};", brands)
    d = json.loads(ALLOW_FILE.read_text())
    d.setdefault("ALLOWED_additions", {}).update(allow)
    ALLOW_FILE.write_text(json.dumps(d, indent=2) + "\n")
    print(f"added {len(cdata)} connectors ({logos} bundled logos, {len(allow)} with tools). "
          f"Run `npm run build`, then ship with gmail-oauth/connect-key.")


def _insert(file: Path, start_marker: str, close_marker: str, lines: list[str]) -> None:
    if not lines:
        return
    src = file.read_text()
    start = src.index(start_marker)
    close = src.index(close_marker, start)
    file.write_text(src[:close] + "\n" + "\n".join(lines) + src[close:])


if __name__ == "__main__":
    main()
