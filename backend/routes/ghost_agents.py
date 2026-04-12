"""Proactive agents — agents that live inside connected apps and ping
the user back with whatever the user told them to watch for.

Conceptual model:
  - An "agent" is a small assistant with a name, role, and system prompt
    that the user defined on the client (e.g. "Juan, my email assistant
    who tells me when my boss writes").
  - Until now agents only ran in chat — the user typed at them and they
    responded. This module makes them PROACTIVE by adding "triggers":
    background events that wake the agent up, run it through Claude with
    the event payload, and push the agent's response to the user.

Trigger types in v1:
  1. email_from        — fires on a new email from a specific sender
  2. email_keyword     — fires on a new email whose subject contains a
                          keyword (case-insensitive)
  3. schedule          — fires at a specific minute-of-day on chosen
                          weekdays in the user's timezone

Storage:
  - Agents now persist server-side (one row per user+workspace+agent_id),
    overlaying whatever the client has in AsyncStorage. The mobile app
    pushes its local agents to the backend on first sync, then reads
    from the backend going forward.
  - Triggers live as a JSONB column on the agent row so we can add new
    trigger types without schema migrations.

Endpoints:
  GET    /api/ghost/agents              — list agents for user+workspace
  POST   /api/ghost/agents              — upsert one agent (full body)
  DELETE /api/ghost/agents/{agent_id}   — delete an agent

The actual polling/firing logic lives in worker/agent_trigger_poller.py
so the web dyno isn't blocked by mailbox or LLM calls. The scheduler
loop ticks the poller every minute (schedule triggers) and every 5 min
for email triggers (matching push_email_poller cadence — they share the
same mailbox call so we don't double-poll).
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from sqlalchemy import Column, String, DateTime, Boolean, Text, select, text as sql_text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from db import Base, get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ghost/agents", tags=["ghost-agents"])


# ── Model ──────────────────────────────────────────────────────────────


class GhostAgent(Base):
    """One row per (user, workspace, client_agent_id). The client_agent_id
    is the id the mobile app generated locally — we keep it stable so
    re-syncs don't create duplicates."""
    __tablename__ = "ghost_agents"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    workspace_id = Column(String(100), nullable=False, default="personal")
    # The client-side id (e.g. "ag_1736541234_x9k2m") — used for upsert
    # so the same agent always lands on the same row.
    client_id = Column(String(100), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    role = Column(String(300), nullable=True)
    instructions = Column(Text, nullable=True)
    # Triggers as JSONB. Each entry has the shape:
    #   { "kind": "email_from", "from_email": "boss@acme.com", "app_id": "gmail" }
    #   { "kind": "email_keyword", "subject_keyword": "invoice", "app_id": "gmail" }
    #   { "kind": "schedule", "time_min": 540, "days_of_week": "YYYYY--", "timezone_name": "America/New_York" }
    triggers = Column(JSONB, nullable=False, default=list)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ── Idempotent schema ensure ───────────────────────────────────────────

_schema_checked = False


async def ensure_agents_schema(db: AsyncSession) -> None:
    global _schema_checked
    if _schema_checked:
        return
    try:
        await db.execute(sql_text("""
            CREATE TABLE IF NOT EXISTS ghost_agents (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                workspace_id VARCHAR(100) NOT NULL DEFAULT 'personal',
                client_id VARCHAR(100) NOT NULL,
                name VARCHAR(120) NOT NULL,
                role VARCHAR(300),
                instructions TEXT,
                triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await db.execute(sql_text(
            "CREATE INDEX IF NOT EXISTS ix_ghost_agents_user_ws "
            "ON ghost_agents (user_id, workspace_id)"
        ))
        await db.execute(sql_text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_ghost_agents_client "
            "ON ghost_agents (user_id, workspace_id, client_id)"
        ))
        await db.commit()
        _schema_checked = True
        logger.info("ghost_agents: table ensured")
    except Exception as e:
        logger.warning(f"ghost_agents: schema ensure failed: {e}")
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


class AgentTriggerBody(BaseModel):
    """One trigger entry. Loose validation — the worker is the source of
    truth on what shapes are supported."""
    kind: str
    # email_from
    from_email: Optional[str] = None
    # email_keyword
    subject_keyword: Optional[str] = None
    # email_* shared
    app_id: Optional[str] = None
    # schedule
    time_min: Optional[int] = None
    days_of_week: Optional[str] = None
    timezone_name: Optional[str] = None


class AgentBody(BaseModel):
    client_id: str
    name: str
    role: Optional[str] = None
    instructions: Optional[str] = None
    triggers: Optional[list[AgentTriggerBody]] = None
    enabled: Optional[bool] = True


def _row_to_dict(row: GhostAgent) -> dict:
    return {
        "id": str(row.id),
        "client_id": row.client_id,
        "workspace_id": row.workspace_id,
        "name": row.name,
        "role": row.role or "",
        "instructions": row.instructions or "",
        "triggers": row.triggers or [],
        "enabled": row.enabled,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ── Endpoints ──────────────────────────────────────────────────────────


@router.get("")
async def list_agents(
    authorization: str = Header(...),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
):
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    workspace_id = _normalize_workspace(x_workspace_id)
    await ensure_agents_schema(db)

    result = await db.execute(
        select(GhostAgent).where(
            GhostAgent.user_id == user_id,
            GhostAgent.workspace_id == workspace_id,
        ).order_by(GhostAgent.created_at.asc())
    )
    rows = result.scalars().all()
    return {"agents": [_row_to_dict(r) for r in rows]}


@router.post("")
async def upsert_agent(
    body: AgentBody,
    authorization: str = Header(...),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
):
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    workspace_id = _normalize_workspace(x_workspace_id)
    await ensure_agents_schema(db)

    if not body.client_id or not body.name:
        raise HTTPException(status_code=400, detail="client_id and name are required")

    triggers_json = [t.model_dump(exclude_none=True) for t in (body.triggers or [])]

    # Try to find existing row by client_id (idempotent upsert)
    result = await db.execute(
        select(GhostAgent).where(
            GhostAgent.user_id == user_id,
            GhostAgent.workspace_id == workspace_id,
            GhostAgent.client_id == body.client_id,
        )
    )
    row = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row:
        row.name = body.name
        row.role = body.role
        row.instructions = body.instructions
        row.triggers = triggers_json
        if body.enabled is not None:
            row.enabled = body.enabled
        row.updated_at = now
    else:
        row = GhostAgent(
            user_id=user_id,
            workspace_id=workspace_id,
            client_id=body.client_id,
            name=body.name,
            role=body.role,
            instructions=body.instructions,
            triggers=triggers_json,
            enabled=body.enabled if body.enabled is not None else True,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.delete("/{client_id}")
async def delete_agent(
    client_id: str,
    authorization: str = Header(...),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
):
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    workspace_id = _normalize_workspace(x_workspace_id)
    await ensure_agents_schema(db)

    await db.execute(sql_text(
        "DELETE FROM ghost_agents WHERE user_id = :uid AND workspace_id = :ws AND client_id = :cid"
    ), {"uid": str(user_id), "ws": workspace_id, "cid": client_id})
    await db.commit()
    return {"ok": True}
