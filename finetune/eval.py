"""Score a served model against the held-out val set.

Points an OpenAI-compatible endpoint (your Ollama server, or the base model for a
baseline) at each val prompt and reports:
  - % output that parses as JSON
  - % that passes the real workflow schema
  - % that only uses the apps the prompt said were connected

Usage:
    # fine-tuned model via Ollama:
    python eval.py --base-url http://localhost:11434/v1 --model gf-workflows
    # baseline (stock Qwen) for comparison:
    python eval.py --base-url http://localhost:11434/v1 --model qwen2.5:7b-instruct
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from openai import OpenAI

from grammar import workflow_json_schema
from schema import parse_and_validate

HERE = Path(__file__).parent


def connected_from_system(system: str) -> set[str]:
    """Recover the connected app ids from the system prompt's bullet list."""
    apps: set[str] = set()
    for m in re.finditer(r"^- ([a-z0-9_]+):", system, re.MULTILINE):
        apps.add(m.group(1))
    return apps | {"schedule", "event", "ai", "decision"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:11434/v1")
    ap.add_argument("--model", required=True)
    ap.add_argument("--api-key", default="ollama")
    ap.add_argument("--file", default=str(HERE / "data" / "val.jsonl"))
    ap.add_argument("--raw", action="store_true",
                    help="eval the BARE model (no grammar) — for comparison. Default uses the grammar = the real served path.")
    ap.add_argument("--restrict-apps", action="store_true",
                    help="hard-restrict the grammar's app enum to each row's CONNECTED apps "
                         "(grammar.py workflow_json_schema(connected=...)). The model then physically "
                         "cannot emit an unconnected app, so 'apps all connected' -> ~100% by construction. "
                         "Use to separate real routing errors from the default-grammar 'name any app' policy.")
    args = ap.parse_args()

    client = OpenAI(base_url=args.base_url, api_key=args.api_key)
    rows = [json.loads(l) for l in Path(args.file).read_text(encoding="utf-8").splitlines() if l.strip()]
    # Default = the PRODUCTION path: grammar-constrained decoding (matches what
    # build-workflow sends). --raw measures the bare model for comparison.
    rf = None if args.raw else {"type": "json_schema",
        "json_schema": {"name": "workflow", "schema": workflow_json_schema(), "strict": True}}
    mode = ("RAW (no grammar)" if args.raw
            else "grammar-constrained, app enum restricted to each row's connected apps" if args.restrict_apps
            else "grammar-constrained (served path)")
    print(f"mode: {mode}\n")

    META = {"schedule", "event", "ai", "decision"}
    n = len(rows)
    json_ok = schema_ok = apps_ok = 0
    for i, r in enumerate(rows, 1):
        connected = connected_from_system(r["system"])
        if args.raw:
            rf_row = None
        elif args.restrict_apps:
            # lock `app` to ONLY this row's connected connectors (specials are re-added inside)
            rf_row = {"type": "json_schema", "json_schema": {"name": "workflow",
                "schema": workflow_json_schema(sorted(connected - META)), "strict": True}}
        else:
            rf_row = rf
        resp = client.chat.completions.create(
            model=args.model, max_tokens=2048,
            messages=[{"role": "system", "content": r["system"]},
                      {"role": "user", "content": r["user"]}],
            **({"response_format": rf_row} if rf_row else {}),
        )
        text = resp.choices[0].message.content or ""
        ok, errs, wf = parse_and_validate(text, connected=connected)
        if wf is not None:
            json_ok += 1
        if ok:
            schema_ok += 1
            apps_ok += 1
        else:
            # was it ONLY an unconnected-app problem, or structurally broken?
            ok2, _, _ = parse_and_validate(text)  # ignore connected-check
            if ok2:
                schema_ok += 1
        tag = "ok" if ok else (errs[0] if errs else "fail")
        print(f"[{i}/{n}] {tag}")

    print("\n--- results ---")
    print(f"valid JSON:        {json_ok}/{n}  ({100*json_ok//max(n,1)}%)")
    print(f"schema-valid:      {schema_ok}/{n}  ({100*schema_ok//max(n,1)}%)")
    print(f"apps all connected:{apps_ok}/{n}  ({100*apps_ok//max(n,1)}%)")


if __name__ == "__main__":
    main()
