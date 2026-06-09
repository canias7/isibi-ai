# CLAUDE.md — Go Farther

Notes for Claude Code sessions working in this repo.

## Workflow: ship finished work to `main` (do this every time)

After each change is complete and verified, **merge it to `main`** — never leave finished work sitting only on a feature branch.

1. Develop on the assigned feature branch.
2. When the work is done and checked, open a PR from the branch into `main` and **squash-merge** it (matches the repo's `(#NN)` commit history).
3. After the squash-merge, **realign the feature branch** on top of `main` (`git reset --hard origin/main`) so the next PR shows only new work.

## Why merging matters — how things ship

- **Frontend** (`src/**`, the React/Capacitor app) ships via **OTA**: a push to `main` runs `.github/workflows/web-ota.yml`, which publishes the bundle the app picks up on next launch. So frontend changes only go live once merged to `main`.
- **Backend** (`supabase/functions/**`) is deployed **separately** to Supabase (Management API / Supabase MCP `deploy_edge_function`), independent of git. After editing a function, deploy it; `ACTIVE` status means it compiled. Merging to `main` does **not** deploy backend functions.
