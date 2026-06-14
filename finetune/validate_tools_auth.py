"""Deep (auth-based) validation: confirm catalog tools actually return real data
when a real account is connected — not just that they exist (the no-auth scan in
validate_tools.py only proves 404-vs-400). Run this AFTER the user connects apps
via gen_connect_links.py (same user_id).

SAFETY: by default only READ tools are executed (LIST/GET/SEARCH/FETCH/...), so
this never creates/sends/deletes anything on the connected account. Write tools
are reported as "exists (not executed)" — validating them by execution would
cause real side effects. Pass --include-writes to override (dangerous).

A connected READ tool that returns 200 is confirmed working. One that errors
(404 dead, 4xx/5xx runtime failure — e.g. the "Composio says no required args
but the call needs them" class) is a candidate to drop.

    COMPOSIO_API_KEY=...  python validate_tools_auth.py [--user gf-validation-user] [--apps slack,notion,...]

Writes /tmp/auth_validation.json and prints a per-app pass/fail summary.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import catalog as C
from rebalance_tools import cat_of  # read/write/other classifier

HERE = Path(__file__).parent
BASE = "https://backend.composio.dev/api/"


def api(method: str, path: str, key: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, method=method, data=data,
        headers={"x-api-key": key, "content-type": "application/json", "User-Agent": "gf/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except ValueError:
            return e.code, {}
    except Exception as ex:  # noqa: BLE001
        return -1, {"error": str(ex)}


def connected_toolkits(user_id: str, key: str) -> set[str]:
    """Toolkits the user actually has an active connected account for."""
    out: set[str] = set()
    c, d = api("GET", f"v3.1/connected_accounts?user_ids={user_id}&statuses=ACTIVE&limit=500", key)
    for it in (d.get("items") or d.get("data") or []):
        tk = it.get("toolkit") or {}
        slug = tk.get("slug") if isinstance(tk, dict) else tk
        if slug:
            out.add(slug.lower())
    return out


def execute(tool: str, user_id: str, key: str):
    for attempt in range(4):
        c, d = api("POST", f"v3/tools/execute/{tool}", key, {"user_id": user_id, "arguments": {}})
        if c == 429:
            time.sleep(2 ** attempt)
            continue
        return c, d
    return 429, {}


def classify(code: int, body: dict) -> str:
    if code == 404:
        return "dead"                         # Tool not found
    if code == 200:
        # Composio wraps tool errors in 200 sometimes — check successful flag
        ok = body.get("successful", body.get("success"))
        if ok is False:
            return "runtime_error"
        return "works"
    if code == 400:
        msg = json.dumps(body).lower()
        if "no connected account" in msg or "connectednotfound" in msg or "1810" in msg:
            return "no_connection"            # user didn't connect this app
        return "needs_args"                   # exists, empty-args rejected (read tool that needs a param)
    return f"err_{code}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default="gf-validation-user")
    ap.add_argument("--apps", default="", help="comma list of slugs; default = all connected")
    ap.add_argument("--include-writes", action="store_true")
    args = ap.parse_args()
    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        print("set COMPOSIO_API_KEY"); sys.exit(1)

    want = {a.strip().lower() for a in args.apps.split(",") if a.strip()}
    conn = connected_toolkits(args.user, key)
    apps = sorted((want & set(C.ALLOWED)) if want else (conn & set(C.ALLOWED)))
    if want:
        missing = sorted(want - conn)
        if missing:
            print(f"⚠ requested but NOT connected (will report no_connection): {missing}")
    if not apps:
        print(f"no connected catalog apps for user {args.user}. Connect some via gen_connect_links.py first.")
        print(f"(currently connected toolkits: {sorted(conn)})")
        return

    jobs = []
    for app in apps:
        for t in C.ALLOWED[app]:
            kind = cat_of(t)
            if kind == "write" and not args.include_writes:
                continue
            jobs.append((app, t))

    results: dict[str, dict] = {}
    print(f"validating {len(jobs)} read tools across {len(apps)} connected apps as user {args.user}…")
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(execute, t, args.user, key): (app, t) for app, t in jobs}
        for fut in futs:
            app, t = futs[fut]
            code, body = fut.result()
            results[t] = {"app": app, "code": code, "verdict": classify(code, body)}

    # per-app summary + drop candidates
    by_app: dict[str, dict[str, int]] = {}
    drop: list[str] = []
    for t, r in results.items():
        by_app.setdefault(r["app"], {}).setdefault(r["verdict"], 0)
        by_app[r["app"]][r["verdict"]] += 1
        if r["verdict"] in ("dead", "runtime_error"):
            drop.append(t)
    print("\n=== per-app (read tools) ===")
    for app in sorted(by_app):
        print(f"  {app:16} {by_app[app]}")
    print(f"\nDROP candidates (dead/runtime_error with real auth): {len(drop)}")
    for t in sorted(drop):
        print("  ", t)

    out = HERE / "auth_validation_results.json"
    out.write_text(json.dumps({"user": args.user, "apps": apps, "results": results,
                               "drop_candidates": sorted(drop)}, indent=1) + "\n")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
