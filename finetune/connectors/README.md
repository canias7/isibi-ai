# Connector catalog — every connector and its full tool surface

Built by `../build_connector_catalog.py` from Composio. The curated grounding
(`../tool_schemas.json`, ~6 tools/connector) is what the runner trains on *now*;
this is the COMPLETE surface, for widening coverage **connector-by-connector**.

## Files
- **`index.json`** — every Composio toolkit (1043): `slug`, `name`, `tool_count`,
  `category`, and `supported` (is it one of the app's 54 connectors). *Breadth* —
  browse/pick what to add to the app.
- **`<slug>.json`** — one per app connector: every tool with `name`, a short
  `description`, and a compact arg `schema` (`{type, properties, required}`).
  *Depth* — training-ready, args grounded in the real Composio schema.

## Totals (snapshot)
54 supported connectors · **6,940 tools** (vs 315 curated). All **1,043** toolkits
/ **42,832** tools are listed in `index.json` for reference. Biggest surfaces:
Zendesk 452, Stripe 415/422, Pipedrive 398/401, Shopify 394, SendGrid 364.

## Training one connector at a time
When you're ready to widen the runner past the curated set:
1. Pick a connector (start with the ones users actually use; `index.json`'s
   `tool_count` shows where the big surfaces are).
2. Take its `<slug>.json` tools — generate traces that exercise those actions
   (seed scenarios that need them), validating each call's args against the
   tool's `schema` (same `validate_args` path as `runner_gen.py`).
3. Mix the new traces into `runner_data/` and retrain.

This keeps each expansion small, measurable (`runner_eval.py`), and grounded.

## Refresh
```bash
COMPOSIO_API_KEY=...  python build_connector_catalog.py            # the 54 supported
COMPOSIO_API_KEY=...  python build_connector_catalog.py --only stripe
COMPOSIO_API_KEY=...  python build_connector_catalog.py --all      # every toolkit (huge)
```
