from __future__ import annotations
"""
Uptime Monitoring — monitor deployed apps and report on availability.

Routes:
  GET  /api/projects/{project_id}/uptime        — uptime stats + recent checks
  POST /api/projects/{project_id}/uptime/check   — trigger a manual health check
"""

import uuid
import time
import logging
from datetime import datetime, timezone
from typing import Dict, List

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.project import Project

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["Uptime Monitoring"])

# ── In-memory check history (project_id -> list of recent checks) ───
# In production this would be stored in the DB or a time-series store.
_check_history: Dict[str, List[dict]] = {}
MAX_HISTORY = 288  # ~24h at 5-min intervals


# ── Helpers ──────────────────────────────────────────────────────────

async def _get_project(project_id: str, org_id: uuid.UUID, db: AsyncSession) -> Project:
    result = await db.execute(
        select(Project).where(
            Project.id == uuid.UUID(project_id),
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _get_live_url(project_id: str) -> str:
    """Build the live URL for a deployed project."""
    return f"/live/{project_id}"


async def _perform_check(project_id: str, base_url: str | None = None) -> dict:
    """
    Ping the deployed app and record the result.

    If base_url is provided (e.g. from the request), use an absolute URL.
    Otherwise, record a self-referential check against /live/{project_id}.
    """
    live_path = _get_live_url(project_id)

    # Build absolute URL for the HTTP call
    if base_url:
        url = f"{base_url.rstrip('/')}{live_path}"
    else:
        url = f"http://127.0.0.1:8000{live_path}"

    check_result = {
        "time": datetime.now(timezone.utc).isoformat(),
        "status": "down",
        "ms": 0,
        "status_code": None,
    }

    try:
        start = time.monotonic()
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, follow_redirects=True)
        elapsed_ms = round((time.monotonic() - start) * 1000)

        check_result["ms"] = elapsed_ms
        check_result["status_code"] = resp.status_code

        if 200 <= resp.status_code < 400:
            check_result["status"] = "up"
        else:
            check_result["status"] = "degraded"

    except httpx.TimeoutException:
        check_result["status"] = "timeout"
        check_result["ms"] = 10000
    except Exception as exc:
        logger.warning("Uptime check failed for project %s: %s", project_id, exc)
        check_result["status"] = "down"

    # Store in history
    if project_id not in _check_history:
        _check_history[project_id] = []
    _check_history[project_id].append(check_result)
    # Trim to last MAX_HISTORY entries
    if len(_check_history[project_id]) > MAX_HISTORY:
        _check_history[project_id] = _check_history[project_id][-MAX_HISTORY:]

    return check_result


def _compute_uptime_pct(project_id: str) -> float:
    """Compute uptime percentage from stored check history."""
    checks = _check_history.get(project_id, [])
    if not checks:
        return 100.0
    up_count = sum(1 for c in checks if c["status"] == "up")
    return round((up_count / len(checks)) * 100, 2)


def _avg_response_time(project_id: str) -> int:
    """Average response time from recent checks."""
    checks = _check_history.get(project_id, [])
    up_checks = [c for c in checks if c["status"] == "up"]
    if not up_checks:
        return 0
    return round(sum(c["ms"] for c in up_checks) / len(up_checks))


# ── Routes ───────────────────────────────────────────────────────────

@router.get("/{project_id}/uptime")
async def get_uptime(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Return uptime stats and recent check history for a deployed project."""
    await _get_project(project_id, org_id, db)

    checks = _check_history.get(project_id, [])
    last_check = checks[-1] if checks else None

    return {
        "project_id": project_id,
        "status": last_check["status"] if last_check else "unknown",
        "uptime_pct": _compute_uptime_pct(project_id),
        "last_check": last_check["time"] if last_check else None,
        "response_time_ms": _avg_response_time(project_id),
        "total_checks": len(checks),
        "checks_24h": checks[-288:],  # last 24h worth
    }


@router.post("/{project_id}/uptime/check")
async def trigger_check(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Trigger a manual uptime check for a deployed project."""
    await _get_project(project_id, org_id, db)

    result = await _perform_check(project_id)
    return {
        "project_id": project_id,
        "check": result,
        "uptime_pct": _compute_uptime_pct(project_id),
    }
