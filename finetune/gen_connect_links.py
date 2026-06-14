"""Generate Composio OAuth connect links for the deep-validation flow ("top apps
first" — the user signs in, then validate_tools_auth.py tests the tools against
that connection). Reuses each toolkit's existing managed auth_config (the prod
one) and binds the link to a dedicated validation user_id so reads never touch
the owner's real account.

Links expire ~20 min, so generate a batch right before signing in.

    COMPOSIO_API_KEY=...  python gen_connect_links.py slack notion hubspot ...
    COMPOSIO_API_KEY=...  python gen_connect_links.py --top   # a sensible default set

Only managed-OAuth toolkits produce a one-click link; API-key ones are skipped
(those connect via the /connect-key key sheet in the app).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

BASE = "https://backend.composio.dev/api/"

# A sensible "top apps" default — productivity/CRM/PM/files/finance core.
TOP = ["googledrive", "googlecalendar", "googlesheets", "googledocs", "googletasks",
       "slack", "notion", "airtable", "hubspot", "salesforce", "asana", "trello",
       "clickup", "linear", "todoist", "calendly", "zoom", "dropbox", "box",
       "shopify", "stripe", "zendesk", "intercom", "youtube"]


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


def managed_auth_config(slug: str, key: str) -> str | None:
    """Find an existing managed auth_config, else create one (zero-config OAuth)."""
    c, d = api("GET", f"v3.1/auth_configs?toolkit_slug={slug}&limit=10", key)
    for it in (d.get("items") or d.get("data") or []):
        if it.get("is_composio_managed") or it.get("use_composio_managed_auth"):
            return it.get("id")
    # none — try to create a managed one
    c, d = api("POST", "v3.1/auth_configs", key,
               {"toolkit": {"slug": slug}, "auth_config": {"use_composio_managed_auth": True}})
    if c in (200, 201):
        return (d.get("auth_config") or d).get("id") or d.get("id")
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("apps", nargs="*")
    ap.add_argument("--top", action="store_true")
    ap.add_argument("--user", default="gf-validation-user")
    args = ap.parse_args()
    key = os.environ.get("COMPOSIO_API_KEY")
    if not key:
        print("set COMPOSIO_API_KEY"); sys.exit(1)

    apps = args.apps or (TOP if args.top else [])
    if not apps:
        print("pass app slugs or --top"); sys.exit(1)

    print(f"connect links for user_id={args.user} (expire ~20 min):\n")
    ok = skip = 0
    for slug in apps:
        ac = managed_auth_config(slug, key)
        if not ac:
            print(f"  {slug:16} — no managed OAuth (API-key app; use in-app key sheet)")
            skip += 1
            continue
        c, d = api("POST", "v3.1/connected_accounts/link", key,
                   {"user_id": args.user, "auth_config_id": ac})
        url = d.get("redirect_url")
        if url:
            print(f"  {slug:16} {url}")
            ok += 1
        else:
            print(f"  {slug:16} — link error {c}: {json.dumps(d)[:120]}")
            skip += 1
    print(f"\n{ok} links generated, {skip} skipped. After signing in:")
    print(f"  COMPOSIO_API_KEY=...  python validate_tools_auth.py --user {args.user}")


if __name__ == "__main__":
    main()
