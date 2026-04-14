"""Daily morning digest — per-user personalized summary.

Each user picks:
  - What time they want it (local clock time + IANA timezone)
  - Which workspace it runs against (so you can have a "personal"
    digest and a separate "work" digest)
  - Which sources to include:
      * inbox_summary  — count of unread, top 3 unread senders/subjects
      * calendar_today — events for today from a connected calendar
      * saved_notes    — recent memory facts + custom instructions
      * finance        — pending invoices, yesterday's receipts (future)
      * spreadsheet    — sum of a specific column in a named workbook
  - Custom prompt (optional) — freeform text that gets appended to
    the AI's summarization step so users can inject their own rules
    ("Start with a joke", "Always mention the weather", etc.)
  - Delivery channels:
      * push (default on)
      * email — send the digest HTML to the user's email address too

How it runs (worker/digest_runner.py):
  Every minute, the main scheduler loop checks which digest configs
  should fire now. "Should fire now" means:
    - enabled = TRUE
    - minute_of_day in the user's timezone equals the configured minute
    - last_fired_at is older than 23 hours (prevents double-fires on
      DST transitions or clock drift)
  For every matching user we assemble the digest content by calling
  each source's helper, stitch it into a short text + HTML payload,
  push it via ghost_push.send_push_to_user, and optionally email it
  via ghost_connectors.send_email_for_user.

What this module owns:
  - Pydantic schemas for the config
  - The table model + idempotent schema ensure
  - GET/POST /api/ghost/digest/config endpoints
  - POST /api/ghost/digest/run-now endpoint (for testing)

What this module does NOT own:
  - The actual digest assembly logic — lives in
    worker/digest_runner.py so the web dyno isn't blocked on the
    (potentially slow) connector calls.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from sqlalchemy import Column, String, DateTime, Boolean, Integer, Text, select, text as sql_text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession

from db import Base, get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ghost/digest", tags=["ghost-digest"])


# ── Model ──────────────────────────────────────────────────────────────

class GhostDigestConfig(Base):
    """One row per (user_id, workspace_id) — each workspace can have
    its own digest, so a user can have "Personal" fire at 7am and
    "Work" fire at 8:30am on weekdays only."""
    __tablename__ = "ghost_digest_configs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    workspace_id = Column(String(100), nullable=False, default="personal")
    enabled = Column(Boolean, nullable=False, default=False)

    # Fire time — stored as minutes-from-midnight so the DB type is
    # workspace-friendly (no TIME column with tz issues). 480 = 08:00.
    time_min = Column(Integer, nullable=False, default=480)
    timezone_name = Column(String(64), nullable=False, default="UTC")

    # Day-of-week filter as a 7-char string where "MTWTFSS" slots are
    # "Y" (on) or "-" (off). Default = weekdays only.
    # Monday=index 0, Sunday=index 6.
    days_of_week = Column(String(7), nullable=False, default="YYYYY--")

    # Sources — toggled on/off by the user. Persisted as individual
    # bool columns so adding a new source is one ALTER TABLE
    # (idempotent via _ensure_schema below) and doesn't require a
    # JSON migration.
    inbox_summary = Column(Boolean, nullable=False, default=True)
    calendar_today = Column(Boolean, nullable=False, default=True)
    saved_notes = Column(Boolean, nullable=False, default=False)
    finance = Column(Boolean, nullable=False, default=False)

    # Optional: a specific workbook + column to sum every morning.
    # Handy for "show me total sales so far this month" digests.
    spreadsheet_workbook = Column(String(200), nullable=True)
    spreadsheet_column = Column(String(10), nullable=True)

    # Freeform user instructions appended to the AI summarization
    # prompt, e.g. "Always mention the weather" or "Be extra brief".
    custom_prompt = Column(Text, nullable=True)

    # Delivery channels
    push_enabled = Column(Boolean, nullable=False, default=True)
    email_enabled = Column(Boolean, nullable=False, default=False)
    email_recipient = Column(String(200), nullable=True)

    # Bookkeeping
    last_fired_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ── Idempotent schema ensure ───────────────────────────────────────────

_schema_checked = False


async def ensure_digest_schema(db: AsyncSession) -> None:
    """Create the table on first use so Render doesn't need an
    alembic migration for this to ship."""
    global _schema_checked
    if _schema_checked:
        return
    try:
        await db.execute(sql_text("""
            CREATE TABLE IF NOT EXISTS ghost_digest_configs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                workspace_id VARCHAR(100) NOT NULL DEFAULT 'personal',
                enabled BOOLEAN NOT NULL DEFAULT FALSE,
                time_min INTEGER NOT NULL DEFAULT 480,
                timezone_name VARCHAR(64) NOT NULL DEFAULT 'UTC',
                days_of_week VARCHAR(7) NOT NULL DEFAULT 'YYYYY--',
                inbox_summary BOOLEAN NOT NULL DEFAULT TRUE,
                calendar_today BOOLEAN NOT NULL DEFAULT TRUE,
                saved_notes BOOLEAN NOT NULL DEFAULT FALSE,
                finance BOOLEAN NOT NULL DEFAULT FALSE,
                spreadsheet_workbook VARCHAR(200),
                spreadsheet_column VARCHAR(10),
                custom_prompt TEXT,
                push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                email_recipient VARCHAR(200),
                last_fired_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await db.execute(sql_text(
            "CREATE INDEX IF NOT EXISTS ix_ghost_digest_configs_user_ws "
            "ON ghost_digest_configs (user_id, workspace_id)"
        ))
        # Uniqueness: one row per (user, workspace). Using a unique
        # index instead of a constraint so the command is idempotent.
        await db.execute(sql_text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_ghost_digest_configs_user_ws "
            "ON ghost_digest_configs (user_id, workspace_id)"
        ))
        await db.commit()
        _schema_checked = True
        logger.info("ghost_digest: table ensured")
    except Exception as e:
        logger.warning(f"ghost_digest: schema ensure failed: {e}")
        _schema_checked = True


# ── Auth helper ────────────────────────────────────────────────────────


def _verify_auth(authorization: str) -> dict:
    from routes.ghost_auth import verify_ghost_token
    token = authorization.replace("Bearer ", "")
    return verify_ghost_token(token)


def _normalize_workspace(value: Optional[str]) -> str:
    if not value:
        return "personal"
    s = "".join(c for c in str(value) if c.isalnum() or c in ("_", "-"))[:100]
    return s or "personal"


# ── Schemas ────────────────────────────────────────────────────────────


class DigestConfigBody(BaseModel):
    enabled: Optional[bool] = None
    time_min: Optional[int] = None
    timezone_name: Optional[str] = None
    days_of_week: Optional[str] = None
    inbox_summary: Optional[bool] = None
    calendar_today: Optional[bool] = None
    saved_notes: Optional[bool] = None
    finance: Optional[bool] = None
    spreadsheet_workbook: Optional[str] = None
    spreadsheet_column: Optional[str] = None
    custom_prompt: Optional[str] = None
    push_enabled: Optional[bool] = None
    email_enabled: Optional[bool] = None
    email_recipient: Optional[str] = None


def _row_to_dict(row: GhostDigestConfig) -> dict:
    return {
        "id": str(row.id),
        "user_id": str(row.user_id),
        "workspace_id": row.workspace_id,
        "enabled": row.enabled,
        "time_min": row.time_min,
        "timezone_name": row.timezone_name,
        "days_of_week": row.days_of_week,
        "inbox_summary": row.inbox_summary,
        "calendar_today": row.calendar_today,
        "saved_notes": row.saved_notes,
        "finance": row.finance,
        "spreadsheet_workbook": row.spreadsheet_workbook,
        "spreadsheet_column": row.spreadsheet_column,
        "custom_prompt": row.custom_prompt,
        "push_enabled": row.push_enabled,
        "email_enabled": row.email_enabled,
        "email_recipient": row.email_recipient,
        "last_fired_at": row.last_fired_at.isoformat() if row.last_fired_at else None,
    }


# ── Endpoints ──────────────────────────────────────────────────────────


@router.get("/config")
async def get_config(
    authorization: str = Header(...),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Return the digest config for the active user + workspace,
    creating default (disabled) row if one doesn't exist yet so the
    client always has something to render."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    workspace_id = _normalize_workspace(x_workspace_id)
    await ensure_digest_schema(db)

    result = await db.execute(
        select(GhostDigestConfig).where(
            GhostDigestConfig.user_id == user_id,
            GhostDigestConfig.workspace_id == workspace_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        row = GhostDigestConfig(
            user_id=user_id,
            workspace_id=workspace_id,
            enabled=False,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return _row_to_dict(row)


@router.post("/config")
async def update_config(
    body: DigestConfigBody,
    authorization: str = Header(...),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Partial update of the digest config. Any omitted field stays
    at its existing value. Creates a default row if one doesn't
    exist yet (so the first POST after signup doesn't 404)."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    workspace_id = _normalize_workspace(x_workspace_id)
    await ensure_digest_schema(db)

    result = await db.execute(
        select(GhostDigestConfig).where(
            GhostDigestConfig.user_id == user_id,
            GhostDigestConfig.workspace_id == workspace_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        row = GhostDigestConfig(user_id=user_id, workspace_id=workspace_id)
        db.add(row)

    for field in (
        "enabled", "time_min", "timezone_name", "days_of_week",
        "inbox_summary", "calendar_today", "saved_notes", "finance",
        "spreadsheet_workbook", "spreadsheet_column", "custom_prompt",
        "push_enabled", "email_enabled", "email_recipient",
    ):
        v = getattr(body, field, None)
        if v is not None:
            setattr(row, field, v)

    # Simple validation — keep time in [0, 1439] and days_of_week
    # exactly 7 chars of Y/- to prevent junk from poisoning the
    # worker's matching logic later.
    if not (0 <= row.time_min < 1440):
        raise HTTPException(400, "time_min must be between 0 and 1439")
    if len(row.days_of_week) != 7 or any(c not in ("Y", "-") for c in row.days_of_week):
        raise HTTPException(400, "days_of_week must be a 7-char string of Y or -")

    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.post("/run-now")
async def run_digest_now(
    authorization: str = Header(...),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Run the digest for the current user + workspace immediately,
    regardless of the configured time. Used by the Settings UI's
    "Preview digest" button so users can test their setup without
    waiting for tomorrow morning."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    workspace_id = _normalize_workspace(x_workspace_id)
    await ensure_digest_schema(db)

    result = await db.execute(
        select(GhostDigestConfig).where(
            GhostDigestConfig.user_id == user_id,
            GhostDigestConfig.workspace_id == workspace_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(400, "No digest config yet — save settings first.")

    from worker.digest_runner import run_digest_for_config
    result_payload = await run_digest_for_config(row, db, force=True)
    return result_payload
