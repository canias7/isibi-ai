"""Generate the build-workflow drop-in artifacts from the merged catalog.

Produces, for the local Claude to splice into
supabase/functions/build-workflow/index.ts:
  build_workflow_catalog.json   -> the inline CATALOG (builtins, toolsByFid, validApps)
  build_workflow_grammar.json   -> the inline WF_SCHEMA (grammar-constrained decoding)

Both span the full connector universe (catalog.py merges catalog_connectors.json).
See BACKEND_HANDOFF.md. Re-run after build_universe_catalog.py changes the catalog.

    python build_workflow_artifacts.py [--cap 10]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from catalog import ALLOWED, BUILTINS, SPECIAL_APPS, connector_ids, frontend_id
from grammar import workflow_json_schema

HERE = Path(__file__).parent
SPECIALS = ["schedule", "event", "ai", "decision"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=int, default=10, help="tools per connector listed in mlSystemPrompt")
    args = ap.parse_args()

    tools_by_fid = {frontend_id(s): ALLOWED[s][: args.cap] for s in ALLOWED}
    valid_apps = connector_ids() + SPECIALS  # a node app may be a connector OR a special

    (HERE / "build_workflow_catalog.json").write_text(json.dumps({
        "_note": "Drop-in CATALOG for build-workflow/index.ts — expands it to the 958-connector "
                 "universe. mlSystemPrompt + validateStructural read this; only the user's "
                 "CONNECTED apps appear in any prompt.",
        "builtins": list(BUILTINS.keys()),
        "toolsByFid": tools_by_fid,
        "validApps": valid_apps,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    (HERE / "build_workflow_grammar.json").write_text(json.dumps({
        "_note": "Drop-in WF_SCHEMA for build-workflow/index.ts. app enums span all 958 connectors. "
                 "PREFER building this per-request from connected apps — see BACKEND_HANDOFF.md.",
        "schema": workflow_json_schema(),
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    assert SPECIAL_APPS == set(SPECIALS)
    print(f"toolsByFid: {len(tools_by_fid)} connectors (cap {args.cap})")
    print(f"validApps: {len(valid_apps)} | wrote build_workflow_catalog.json + build_workflow_grammar.json")


if __name__ == "__main__":
    main()
