# isibi.ai Platform Audit Report
**Date:** 2026-03-26
**Auditor:** Claude Opus 4.6 (automated)
**Scope:** Full platform — frontend, backend, specs, infrastructure

---

## Executive Summary

The platform has made significant structural progress. The backend boots with 365 routes, 24/26 tests pass, the spec library contains 1,000 files with real relational data, and the frontend has genuine lazy loading, caching, and a rich feature set. However, several areas remain shallow (scheduler stubs, missing pages, hardcoded marketplace data) and the frontend build could not be verified due to missing Node.js on the audit machine.

---

## 1. Frontend Build & TypeScript (Score: 5/10)

### What was checked
- `npx tsc --noEmit` and `npm run build` — COULD NOT RUN. Node.js/npm is not available in the shell environment. This means TypeScript correctness and bundle output are **unverified**.

### What exists
- `App.tsx` uses `React.lazy()` for all 10 page components with proper `Suspense` fallback. This is real.
- `QueryClient` configured with `staleTime: 30_000` and `retry: 1`. Real.
- `src/api/client.ts` has a genuine in-memory GET cache with 30s TTL, `invalidateCache()`, and auto-logout on 401. Real and functional.

### Issues
- **Cannot confirm the project compiles.** No CI/CD evidence, no build artifacts on disk.
- The `QueryClient` cache and the manual `client.ts` cache are redundant — both cache GETs with 30s TTL. Not a bug, but sloppy.

---

## 2. OnboardingPage Features (Score: 7/10)

### Settings tab
- **EXISTS.** `previewTab === "settings"` renders `<ProjectSettingsPage>` with the project's ID and spec. Settings icon in the tab bar at line 1548.

### Live preview toggle
- **EXISTS.** Full implementation: `handleToggleLivePreview` deploys the app if needed, then shows it in an iframe. Loading state, error state, banner ("Live Preview — This is your actual app") all present.

### Billing check before build
- **EXISTS.** Fetches `/billing/can-build` on mount, stores `billingInfo` with `can_build`, `builds_used`, `builds_limit`. Blocks build at line 1018-1019 if `!billingInfo.can_build`. Refreshes billing after build. Upgrade flow calls `/billing/checkout`.

### Marketplace listing button
- **EXISTS.** "List on Marketplace" button at line 1722, `handleListOnMarketplace` deploys first if needed, then opens a modal. `handlePublishToMarketplace` calls `POST /template-marketplace/publish`. Real API integration.

### Template cards
- **EXISTS.** 8 template quick-start cards (CRM, Restaurant, Gym, E-commerce, Real Estate, Project Manager, Healthcare, School) at line 2578. Clicking one auto-submits the prompt. Real and functional.

### Presence avatars
- **EXISTS.** Polls `GET /collab/{projectId}/presence` every 10 seconds. Renders up to 5 avatars with a "+N" overflow badge. Proper cleanup on unmount.

### Share button
- **EXISTS.** Share modal with: copy link, invite by email with permission dropdown (edit/view), invite success state.

### Issues
- The presence endpoint may not exist on the backend (the code silently ignores errors at line 669). This means presence avatars likely never appear.
- The share/invite feature calls an API but it's unclear if the backend actually sends emails or just stores the invite.
- Template cards are hardcoded in the frontend, not fetched from an API.

---

## 3. ProjectSettingsPage (Score: 8/10)

### What was checked
- Whether API calls use real `get/post/put/del` from `@/api/client`.

### Verdict: REAL API CALLS
This page makes **30+ real API calls** including:
- `PATCH /projects/{id}` for name/description
- `PUT /projects/{id}/branding` for branding settings
- `POST /apps/{id}/roles`, `PUT`, `DELETE` for role management
- `POST /projects/{id}/email-triggers`, webhook-triggers, auto-assign rules, status rules, deadline reminders — all with DELETE support
- `POST /projects/{id}/integrations` with test endpoint
- `POST /apps/{id}/snapshots` and restore
- `POST /apps/{id}/gdpr/{action}`
- `PUT /projects/{id}/ip-whitelist`, encryption, 2FA toggle
- `POST /projects/{id}/views` CRUD
- `POST /projects/{id}/subdomain`

This is genuinely impressive — not UI shells. Uses `safeFetch` wrapper for graceful 403/404 handling.

### Issues
- The settings page is a single massive component with 2000+ lines. No code splitting within it.
- Some backend endpoints may return 404 if the corresponding route/model hasn't been fully implemented.

---

## 4. MarketplacePage (Score: 5/10)

### What was checked
- Whether it fetches from the API or uses only hardcoded data.

### Verdict: HYBRID (mostly fake)
- On mount, it calls `GET /template-marketplace` to fetch real listings.
- **BUT**: If the API returns empty results (likely for new deployments), it falls back to `MOCK_ITEMS` — a hardcoded array of ~10 fake listings with fake download counts (4820, 1240, etc.) and fake ratings.
- The "Task Tracker Pro" item contains a full hardcoded HTML app embedded as a string constant (~130 lines of HTML/CSS/JS).
- Purchase calls `POST /template-marketplace/{id}/purchase` and rating calls `POST /template-marketplace/{id}/rate` — these are real API calls.

### Issues
- For most users, the marketplace will show fake data since there are no real published templates.
- Fake download counts (4820) and ratings (4.9) are misleading.
- The hardcoded HTML apps in the source code are a maintenance liability.

---

## 5. LandingPage Footer (Score: 4/10)

### What was checked
- Whether footer links point to real pages.

### Verdict: MANY DEAD LINKS
- `/terms` and `/privacy` — WORK (routes exist in App.tsx, pages exist)
- `#features` and `#pricing` — WORK (scroll-to-section buttons)
- `/marketplace` — DEAD. No route in App.tsx.
- `/templates` — DEAD. No route in App.tsx.
- `/about` — DEAD. No route in App.tsx.
- `/blog` — DEAD. No route in App.tsx.
- `/careers` — DEAD. No route in App.tsx.
- `/contact` — DEAD. No route in App.tsx.
- `/security` — DEAD. No route in App.tsx.
- External links (Twitter, GitHub, Discord) point to non-existent accounts/servers.

**9 out of 15 footer links are dead.** They will all land on the NotFoundPage.

---

## 6. Backend: Routes & Tests (Score: 7/10)

### What was checked
- Route count and test results.

### Results
- **365 routes** registered. This is substantial.
- **24 passed, 2 skipped, 0 failed** out of 26 tests.
- Skipped tests: marketplace tests requiring a real DB connection.
- Tests cover: auth, billing, chat, deploy, health, marketplace, projects, RAG, spec validator.

### Issues
- 26 tests for 365 routes = **7% route coverage**. Most routes have zero test coverage.
- The 2 skipped marketplace tests suggest the test infrastructure cannot connect to a real database.
- No integration tests, no end-to-end tests.

---

## 7. Backend: main.py Architecture (Score: 7/10)

### What was checked
- Background scheduler in lifespan
- File serve router
- Migrations

### Verdicts
- **Scheduler**: EXISTS. `lifespan()` calls `asyncio.create_task(run_scheduler())` and cancels on shutdown. Real.
- **File serve router**: EXISTS. `file_serve_router` registered at `/api`. The app also serves `/live/{project_id}` for deployed apps, plus manifest.json, sw.js, icon.svg endpoints.
- **Migrations**: Uses `Base.metadata.create_all` (line 193). This is NOT real migrations — it's "create tables if they don't exist" which cannot handle schema changes. No Alembic.

### Issues
- No Alembic or migration system. Schema changes require dropping and recreating tables. This is a serious production concern.
- The massive number of model imports (40+ explicit imports) at the top of main.py is fragile and hard to maintain.

---

## 8. Generator: deployer.py CSS Quality (Score: 7/10)

### What was checked
- Inter font loading, shadows, animations, transitions.

### Verdicts
- **Inter font**: YES. Loaded from Google Fonts CDN. Used as primary font-family with system fallbacks.
- **Shadows**: YES. Full shadow system: `--shadow-xs` through `--shadow-xl` with realistic multi-layer values.
- **Transitions**: YES. `--transition: 0.15s ease` and `--transition-slow: 0.25s ease` used throughout (buttons, inputs, sidebar, cards).
- **PWA support**: YES. Generates manifest.json, service worker, and dynamic SVG icons.

### Issues
- All generated apps are single HTML files. No code splitting, no lazy loading of modules within the generated app.
- The CSS is embedded inline, not in a separate file. This is fine for small apps but limits cacheability.

---

## 9. Generator: ai_generator.py System Prompt (Score: 8/10)

### What was checked
- Whether the system prompt includes relationships, validation, computed fields.

### Verdicts
- **Foreign key relationships**: YES. Detailed section on `fk_entity` with examples (line 126-150). Includes "Always create relationships when entities are logically connected."
- **Validation rules**: YES. Section on validation with email, min, pattern rules (lines 319-340).
- **Computed fields**: YES. Section with formula examples: `quantity * price`, `first_name + ' ' + last_name`, `DAYS_UNTIL(due_date)` (lines 291-310).
- **Conditional visibility**: YES. `visible_when` with operators eq/gt etc. (lines 273-288).
- **Entity format**: Comprehensive template with system fields, ui_config, list_view, create/edit forms, detail view.

### Issues
- The system prompt is very long (350+ lines visible). Long prompts can degrade AI output quality.
- The CRM example in the prompt is very detailed but may cause the AI to generate CRM-like apps regardless of what the user asks for.

---

## 10. Generator: spec_validator.py Auto-Repair (Score: 8/10)

### What was checked
- Whether it auto-repairs specs.

### Verdict: YES, genuinely
- `validate_and_repair()` is the main entry point (line 444).
- Fixes: duplicate entity names, generic app names, table name conventions, reserved field names, input component mismatches, missing system fields, enum badge colors, email validation.
- Validates: `visible_when` operators, validation rules, required field attributes.
- Has 7 passing tests specifically for the validator.

### Issues
- None significant. This is one of the strongest components.

---

## 11. Generator: rag.py (Score: 8/10)

### What was checked
- Category taxonomy and composite matching.

### Verdicts
- **Category taxonomy**: YES. 30 categories with synonym lists (CRM, restaurant, healthcare, fitness, education, real estate, ecommerce, hospitality, beauty, automotive, construction, legal, finance, logistics, events, nonprofit, pet, tech, creative, cleaning, food_production, agriculture, government, staffing, security, repair, recreation, wellness, manufacturing).
- **Composite matching**: YES. `_find_composite_specs()` detects multi-concept prompts (e.g., "gym with restaurant") and merges specs from different categories.
- **Universal patterns**: YES. Injected into every RAG context with standard field types and badge color conventions.

### Issues
- The reverse synonym lookup is built at module load time, which is fine.

---

## 12. Routes: deploy.py (Score: 7/10)

### What was checked
- Whether deploy returns absolute URLs.

### Verdict: YES
- Returns `{app_host}/live/{project_id}` where `app_host` comes from env, or falls back to `https://api.isibi.ai/live/{project_id}`.

### Issues
- The fallback URL `https://api.isibi.ai` may not be the actual deployed domain.

---

## 13. Worker: scheduler.py (Score: 3/10)

### What was checked
- Whether it exists and runs.

### Verdict: EXISTS but is a STUB
- The file exists with 55 lines.
- It runs a loop every 60 seconds checking: deadline reminders, status rules, webhooks.
- **BUT**: All three functions are stubs:
  - `_check_deadline_reminders`: Queries the DB for reminders, then just `logger.info()`. Does nothing.
  - `_check_status_rules`: Queries the DB for rules, then just `logger.info()`. Does nothing.
  - `_fire_webhooks`: Just `pass`. Literally empty.

This is pure scaffolding. The scheduler runs but accomplishes nothing.

---

## 14. Spec Library (Score: 7/10)

### What was checked
- Count and quality of spec files.

### Results
| Metric | Count |
|--------|-------|
| Total specs | 1,000 |
| FK relationships | 234 |
| Validation rules | 566 |
| Computed fields | 156 |
| Conditional visibility | 24 |
| Entities with view configs | 178 |
| Entities with quick filters | 130 |

### Verdict: SUBSTANTIAL AND REAL
- 1,000 spec files is a significant corpus.
- 234 FK relationships across specs means entities are properly cross-linked.
- 566 validation rules and 156 computed fields show real data modeling.
- 24 conditional visibility rules is low but present.

### Issues
- Only 178/1000+ entities have view configs — many entities may generate with default/minimal UIs.
- 24 conditional visibility rules across 1,000 specs is very sparse (0.024 per spec average).

---

## Overall Scores

| Category | Score | Notes |
|----------|-------|-------|
| Frontend Build/TS | 5/10 | Cannot verify build. Lazy loading and caching are real. |
| OnboardingPage Features | 7/10 | All claimed features exist. Presence may be non-functional. |
| ProjectSettingsPage | 8/10 | Genuinely impressive — 30+ real API calls, not shells. |
| MarketplacePage | 5/10 | Fetches from API but falls back to hardcoded fake data. |
| LandingPage Footer | 4/10 | 9 of 15 links are dead (404). |
| Backend Routes/Tests | 7/10 | 365 routes, 24 tests pass. Only 7% coverage. |
| Backend Architecture | 7/10 | Scheduler, file serving, table creation all present. No real migrations. |
| Deployer CSS | 7/10 | Inter font, shadows, transitions all real. Single-file output. |
| AI Generator Prompt | 8/10 | Relationships, validation, computed, visibility all in prompt. |
| Spec Validator | 8/10 | Genuine auto-repair with tests. Strong. |
| RAG System | 8/10 | 30 categories, composite matching, universal patterns. Strong. |
| Deploy URLs | 7/10 | Absolute URLs returned. Fallback domain may be wrong. |
| Background Scheduler | 3/10 | Exists but all handlers are stubs (logger.info or pass). |
| Spec Library | 7/10 | 1,000 specs with real FK/validation/computed data. |

### Weighted Overall: 6.4 / 10

---

## Critical Issues (Must Fix)

1. **9 dead footer links** — /marketplace, /templates, /about, /blog, /careers, /contact, /security all 404
2. **Scheduler is a stub** — runs every 60 seconds but does literally nothing
3. **No database migrations** — `create_all` cannot handle schema changes
4. **Frontend build unverified** — no CI/CD, no evidence the TypeScript compiles
5. **Marketplace shows fake data** — hardcoded ratings and download counts

## Moderate Issues (Should Fix)

6. Presence avatars likely non-functional (endpoint silently fails)
7. Only 26 tests for 365 routes (7% coverage)
8. External social links point to non-existent accounts
9. Redundant caching (QueryClient + manual cache)
10. Template cards are hardcoded, not fetched from API

## What's Genuinely Good

- ProjectSettingsPage is real — 30+ API calls with proper CRUD
- Spec validator with auto-repair is solid and tested
- RAG system with 30 categories and composite matching is well-designed
- AI prompt includes relationships, validation, computed fields, conditional visibility
- 1,000 spec files with real structural data
- Lazy loading, caching, auto-logout, billing checks all implemented
- Live preview toggle with deploy-on-demand is a nice UX feature
- Generated apps have Inter font, proper shadows, transitions, PWA support

---

*This report was generated by automated audit. No files were modified.*
