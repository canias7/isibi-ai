"""Turn catalog_connectors.json into frontend Connector entries for
src/connectorData.ts — so after a universe rebuild, adding the new apps to the UI
is one command instead of hand-writing hundreds of lines.

Idempotent: only emits connectors whose frontend id isn't already in
connectorData.ts, so re-running after each rebuild just tops up the new ones.

  python gen_connector_entries.py            # inject new entries into src/connectorData.ts
  python gen_connector_entries.py --print    # print the new TS lines, change nothing
  python gen_connector_entries.py --dry-run  # report counts only

Logo uses the Composio logo CDN (the file's existing `cl(slug)` helper) — the
right source for the long tail. Color is a deterministic palette pick (drives the
fallback monogram); desc is the humanized Composio category. auth is omitted =
Composio-managed OAuth (the file's documented default).
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
REPO = HERE.parent
CATALOG = HERE / "catalog_connectors.json"
INDEX = HERE / "connectors" / "index.json"
FRONTEND = REPO / "src" / "connectorData.ts"

# Pleasant, distinct palette for the fallback monogram (picked deterministically).
PALETTE = [
    "#4F46E5", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
    "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#22C55E", "#3B82F6",
    "#A855F7", "#E11D48", "#0891B2", "#65A30D", "#D946EF", "#2563EB",
]
_ACRONYMS = {"ai": "AI", "crm": "CRM", "api": "API", "hr": "HR", "sms": "SMS",
             "seo": "SEO", "erp": "ERP", "iot": "IoT", "pdf": "PDF"}


def humanize(category: str) -> str:
    if not category:
        return "Connect your account"
    words = [_ACRONYMS.get(w, w.capitalize()) for w in category.split()]
    return " ".join(words)


def color_for(slug: str) -> str:
    return PALETTE[sum(map(ord, slug)) % len(PALETTE)]


def ts_str(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def existing_ids(text: str) -> set[str]:
    # ids already declared in the CONNECTORS array
    return set(re.findall(r"\bid:\s*'([^']+)'", text))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", dest="just_print", action="store_true", help="print new entries, change nothing")
    ap.add_argument("--dry-run", action="store_true", help="report counts only")
    args = ap.parse_args()

    if not CATALOG.exists():
        raise SystemExit(f"missing {CATALOG} — run build_universe_catalog.py first")
    if not FRONTEND.exists():
        raise SystemExit(f"missing {FRONTEND}")

    catalog = json.loads(CATALOG.read_text(encoding="utf-8")).get("connectors") or {}
    index = {}
    if INDEX.exists():
        index = {t["slug"]: t for t in json.loads(INDEX.read_text(encoding="utf-8")).get("toolkits", []) if t.get("slug")}

    fe_text = FRONTEND.read_text(encoding="utf-8")
    have = existing_ids(fe_text)

    rows: list[tuple[str, str]] = []  # (sort_name, ts_line)
    for slug, info in catalog.items():
        fid = info.get("frontend_id") or slug
        if fid in have:
            continue
        meta = index.get(slug, {})
        name = info.get("name") or meta.get("name") or slug
        category = info.get("category") or meta.get("category") or ""
        line = (f"  {{ id: '{ts_str(fid)}', name: '{ts_str(name)}', "
                f"logo: cl('{ts_str(slug)}'), color: '{color_for(slug)}', "
                f"desc: '{ts_str(humanize(category))}' }},")
        rows.append((name.lower(), line))

    rows.sort()
    new_lines = [line for _, line in rows]
    print(f"catalog connectors: {len(catalog)} | already in UI: {len(have)} | NEW to add: {len(new_lines)}")

    if args.dry_run:
        return
    if args.just_print:
        print("\n".join(new_lines))
        return
    if not new_lines:
        print("nothing to add — connectorData.ts already covers the catalog.")
        return

    # Inject before the closing `];` of the CONNECTORS array.
    marker = "export const CONNECTORS: Connector[] = ["
    start = fe_text.find(marker)
    if start == -1:
        raise SystemExit("couldn't find the CONNECTORS array in connectorData.ts")
    end = fe_text.find("\n];", start)
    if end == -1:
        raise SystemExit("couldn't find the end of the CONNECTORS array")
    updated = fe_text[:end] + "\n" + "\n".join(new_lines) + fe_text[end:]
    FRONTEND.write_text(updated, encoding="utf-8")
    print(f"inserted {len(new_lines)} connectors into {FRONTEND.relative_to(REPO)}")


if __name__ == "__main__":
    main()
