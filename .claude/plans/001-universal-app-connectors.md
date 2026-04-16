# Universal App Connector System — Implementation Plan

## Architecture Overview

**Pattern:** Adapter-based connector system where each app implements a standard interface per category. The backend proxies all API calls. The frontend shows a "Connect Apps" section in Settings where users connect apps, and the AI system prompt dynamically includes available actions for connected apps.

---

## Phase 1: Backend — Connector Framework + Routes

### 1a. Connector registry & base classes (`backend/routes/ghost_connectors.py`)

One new route file handles everything:

- **In-memory store** (same pattern as SMTP_STORE):
  ```python
  CONNECTOR_STORE: dict[str, dict[str, dict]] = {}
  # email -> { "hubspot": { "api_key": "...", "connected": True }, ... }
  ```

- **Endpoints:**
  - `GET /connectors` — list all available connectors with connected status
  - `POST /connectors/{app_id}/connect` — save API key/credentials
  - `DELETE /connectors/{app_id}/disconnect` — remove credentials
  - `POST /connectors/{app_id}/action` — execute any action (get_leads, create_invoice, etc.)

- **App registry** — dict defining all supported apps:
  ```python
  APP_REGISTRY = {
      "hubspot": { "name": "HubSpot", "category": "CRM", "icon": "business", "actions": [...] },
      "quickbooks": { "name": "QuickBooks", "category": "Accounting", "icon": "calculator", "actions": [...] },
      ...
  }
  ```

- **Action dispatcher** — routes `action` requests to the right adapter function:
  ```python
  async def execute_action(app_id, action, params, credentials):
      adapter = ADAPTERS[app_id]
      return await adapter(action, params, credentials)
  ```

- **Adapter functions** — one per app, each handling its supported actions via httpx calls to the app's real API. For apps without accessible public APIs, we'll build the adapter structure with clear TODOs.

### 1b. Supported apps and actions

**CRM:**
| App | Actions | Auth |
|-----|---------|------|
| HubSpot | get_contacts, create_contact, get_deals, create_deal, search | API Key |
| Salesforce | get_leads, create_lead, get_opportunities, create_case | API Key |
| Pipedrive | get_deals, create_deal, get_persons, create_person | API Key |
| GoHighLevel | get_contacts, create_contact, get_opportunities | API Key |
| Zoho CRM | get_leads, create_lead, get_deals, search | API Key |
| Ringy | get_leads, create_lead | SID + AuthToken |

**Accounting:**
| App | Actions | Auth |
|-----|---------|------|
| QuickBooks | get_invoices, create_invoice, get_customers, get_expenses | API Key |
| Xero | get_invoices, create_invoice, get_contacts | API Key |
| FreshBooks | get_invoices, create_invoice, get_clients | API Key |
| Wave | get_invoices, get_customers | API Key |

**Project Management:**
| App | Actions | Auth |
|-----|---------|------|
| Asana | get_tasks, create_task, get_projects, update_task | API Key (PAT) |
| Trello | get_cards, create_card, get_boards, move_card | API Key + Token |
| Monday.com | get_items, create_item, get_boards | API Key |
| ClickUp | get_tasks, create_task, get_spaces | API Key |
| Notion | get_pages, create_page, search, update_page | API Key (Integration) |

**Communication:**
| App | Actions | Auth |
|-----|---------|------|
| Slack | send_message, get_channels, get_messages | Bot Token |
| Discord | send_message, get_channels | Bot Token |

**Calendar:**
| App | Actions | Auth |
|-----|---------|------|
| Google Calendar | get_events, create_event, update_event | API Key |
| Outlook Calendar | get_events, create_event | API Key |

**E-commerce:**
| App | Actions | Auth |
|-----|---------|------|
| Shopify | get_orders, get_products, get_customers | API Key |
| Stripe | get_payments, get_customers, create_payment_link | API Key |
| Square | get_payments, get_catalog | API Key |

**Storage:**
| App | Actions | Auth |
|-----|---------|------|
| Google Drive | list_files, search_files | API Key |
| Dropbox | list_files, search_files | API Key |
| OneDrive | list_files, search_files | API Key |

### 1c. Register in router_registry.py

Add `ghost_connectors_router` import and `app.include_router(...)` call.

---

## Phase 2: Frontend — Settings UI

### 2a. API functions (`api.ts`)

Add 4 new functions:
```typescript
getConnectors()           // GET /connectors
connectApp(appId, creds)  // POST /connectors/{appId}/connect
disconnectApp(appId)      // DELETE /connectors/{appId}/disconnect
connectorAction(appId, action, params)  // POST /connectors/{appId}/action
```

### 2b. AI service (`ai.ts`)

Add one function:
```typescript
runConnectorAction(appId, action, params)  // calls connectorAction from api.ts
```

### 2c. Settings screen — "Connect Apps" section

New collapsible section between "Email" and "App Settings":

- **Header:** "Connect Apps" with plug icon + count badge ("3 connected")
- **Category tabs/headers:** CRM, Accounting, PM, etc.
- **App cards:** Each shows icon + name + status badge (Connected/Not connected)
- **Tap an app → expand inline:**
  - API Key input field (secure text)
  - Any extra fields (e.g., Trello needs API Key + Token)
  - Setup instructions per app (like SMTP provider instructions)
  - Connect / Disconnect button
  - Test connection indicator

### 2d. Storage (`storage.ts`)

Cache connected apps list in AsyncStorage for offline display and system prompt building.

---

## Phase 3: AI Integration — Dynamic System Prompt

### 3a. ChatScreen.tsx changes

On mount, fetch connected apps. For each connected app, inject its available actions into the system prompt:

```
CONNECTED APPS:
You have access to these connected apps. Use the connector action when the user asks about them.

HubSpot (CRM) — connected:
{"type":"connector","target":"hubspot","text":"get_contacts","key":"optional search query"}
{"type":"connector","target":"hubspot","text":"create_contact","key":"name|email|phone"}

QuickBooks (Accounting) — connected:
{"type":"connector","target":"quickbooks","text":"create_invoice","key":"customer|items|amount"}
```

### 3b. useChat.ts — Handle connector action type

Add one new action handler block:
```typescript
if (finalAction?.type === 'connector') {
  // target = app_id, text = action_name, key = params (JSON or pipe-separated)
  const result = await runConnectorAction(finalAction.target, finalAction.text, finalAction.key);
  // Format and display result
}
```

This is **one handler** for ALL apps — the backend does the routing.

---

## Phase 4: Implementation Order (what I'll actually code)

1. **`backend/routes/ghost_connectors.py`** — Full file with registry, store, endpoints, and adapter stubs for all 25+ apps. Real API implementations for apps with well-documented public APIs (HubSpot, Asana, Trello, Stripe, Slack, Notion, Shopify). Placeholder adapters for others.

2. **`backend/router_registry.py`** — Add one import + one include_router line.

3. **`gofarther-ai/src/lib/api.ts`** — Add 4 connector API functions.

4. **`gofarther-ai/src/lib/ai.ts`** — Add `runConnectorAction()`.

5. **`gofarther-ai/src/lib/storage.ts`** — Add connected apps cache functions.

6. **`gofarther-ai/src/screens/SettingsScreen.tsx`** — Add "Connect Apps" section with app cards, credential inputs, connect/disconnect flow.

7. **`gofarther-ai/src/screens/ChatScreen.tsx`** — Load connected apps, inject dynamic actions into system prompt.

8. **`gofarther-ai/src/lib/useChat.ts`** — Add `connector` action handler.

---

## Key Design Decisions

- **One action type (`connector`)** for ALL apps — keeps the AI prompt clean and the handler simple
- **Backend does all routing** — frontend just passes `app_id + action + params`
- **API key auth only** (no OAuth flows) — keeps it simple for v1. OAuth can come later.
- **In-memory store** (matches existing SMTP pattern) — credentials persist per server restart. Fine for now since Render keeps processes warm.
- **No new npm/pip dependencies** — uses httpx (already installed) for all API calls
