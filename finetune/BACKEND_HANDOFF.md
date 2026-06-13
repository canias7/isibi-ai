# Backend handoff — wiring the connector universe into prod

Generated artifacts (in `finetune/`) for the **local Claude** that owns the
deployed Supabase functions. The frontend (54→130 connectors + picker + search)
is ready on the branch; these make the new connectors actually *work*. Ship them
**together** — a connector that connects but whose tools aren't served is a
half-broken state for users.

## 1. `gofarther-mcp` — serve the new connectors' tools (makes them work in chat)
File: **`backend_connector_additions.json`** → `ALLOWED_additions`
- Merge each `{slug: [tools]}` into `gofarther-mcp`'s `ALLOWED` (72 connectors,
  ~8 curated tools each).
- Frontend id == Composio slug for all of these, so the `gmail-oauth` `TOOLKIT`
  map needs **no** new entries (it already defaults id→slug). Connect itself is
  zero-config (managed auth auto-creates).

## 2. `build-workflow` — let the builder emit the new apps in workflows
Two inline constants in `supabase/functions/build-workflow/index.ts`:

- **`CATALOG`** ← `build_workflow_catalog.json` (`builtins`, `toolsByFid`,
  `validApps`). Expands it from 54 → 958. `mlSystemPrompt` and
  `validateStructural` read this; only the user's *connected* apps ever appear in
  a prompt, so per-request size is unchanged.
- **`WF_SCHEMA`** ← `build_workflow_grammar.json` (`schema`). The grammar's `app`
  enums now span all 958.

### ⚠️ Recommended: build the grammar PER-REQUEST, not from the full catalog
A static 962-value enum makes the GBNF grammar heavy (the model recompiles it
each call). Better — and we already have `connected` in the lazy path — restrict
the enum to the user's connected apps:

```ts
// instead of the static WF_SCHEMA constant, per request:
const grammar = workflowSchema(connectedFrontendIds); // app enum = connected + specials
```
`finetune/grammar.py::workflow_json_schema(connected)` is the reference — port
its `connected` branch. Smaller enum = faster + the model only picks from apps the
user actually has. (You lose the "emit unconnected → suggest connect X" UX; with
958 connectors that tradeoff is worth it. Keep the full-catalog `WF_SCHEMA` only
if you want that UX.)

## 4. API-key / keyless connect — new `gmail-oauth/connect-key` endpoint
The frontend now supports connectors whose `auth` is `'apikey'` or `'keyless'`
(the ~865 API-key + 15 keyless toolkits Composio can't one-click-OAuth). Tapping
Connect opens a key sheet and POSTs:

```
POST ${CONNECT_API}/connect-key      (Authorization: Bearer <user jwt>)
body: { "app": "<frontend id>", "apiKey": "<user key>" }   // apiKey omitted for keyless
```

Implement it like the managed-OAuth path, minus the redirect:
1. Resolve the user from the JWT (same as `/start`).
2. `toolkit = TOOLKIT[app] ?? app`.
3. Create an auth_config with the USER'S credentials instead of managed auth:
   - **apikey:** `auth_config: { type: "use_custom_auth", credentials: { <the
     toolkit's API_KEY field(s)>: apiKey } }` — check the toolkit's auth scheme
     for the exact credential field name(s).
   - **keyless:** the toolkit's `NO_AUTH` scheme (no credentials).
4. Create a **connected_account** for (user, auth_config). No redirect URL —
   API-key / no-auth accounts are active immediately.
5. Return `{ "connected": true }` (or `{ "error": "..." }`). `/status?app=<id>`
   should then report it connected like any other.

Each user supplies their **own** key, so these auth_configs/credentials are
**per-user** (don't reuse one app-wide auth_config the way managed OAuth can).
This is what takes the app from ~130 to ~1,000 connectable apps. (Per the toolmap
seam, any of these can later be moved to a direct, non-Composio backend without
retraining.)

**Bulk-add the rest (~750) once `/connect-key` is validated:**
```bash
COMPOSIO_API_KEY=...  python build_app_connectors.py --dry-run   # preview
COMPOSIO_API_KEY=...  python build_app_connectors.py             # splice into the app
npm run build                                                    # verify, then ship
```
`build_app_connectors.py` is idempotent (skips connectors already wired, respects
aliases like outlook→m365), adds bundled logos where simple-icons has them
(monogram otherwise), and merges curated tools into this file's `ALLOWED_additions`.
Validate one API-key connector end-to-end first so you're not staging ~750 that
can't connect.

## 3. Model competence (later, needs the teacher key)
The builder/runner are still trained on the original 54. After this, they *can*
emit the new connectors (catalog + grammar allow it), but quality on them is
pretraining-level until we generate traces across the universe and retrain.
That's the teacher-key step — orthogonal to shipping connect + tools.

## Regenerate
```bash
COMPOSIO_API_KEY=... python build_universe_catalog.py   # refresh catalog_connectors.json (the universe)
python build_workflow_artifacts.py                      # -> build_workflow_catalog.json + _grammar.json
# (backend_connector_additions.json comes from the connector-package step on the frontend branch)
```
