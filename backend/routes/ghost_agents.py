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

How triggers get configured (auto-extraction):
  The user does NOT pick triggers from a menu. They just write what they
  want in plain English in the agent's system prompt:
    "Tell me when I get an email from cris@acme.com"
    "Watch for invoices in my inbox"
    "Every weekday at 9am give me a summary"
  On every upsert we run a small Claude call that parses the prompt and
  emits a structured triggers list, which we save on the row. The
  trigger poller then fires on those triggers in the background.

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
import os
import re
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


# ── Trigger extraction (LLM) ───────────────────────────────────────────


# Cheap regex fallback so an empty ANTHROPIC_API_KEY or a Claude outage
# doesn't kill the feature entirely. Catches the most common email-from
# pattern explicitly; everything else falls back to "no triggers, agent
# only responds in chat".
_EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")


def _regex_extract_triggers(instructions: str) -> list[dict]:
    out: list[dict] = []
    if not instructions:
        return out
    text_lower = instructions.lower()
    # email_from: any literal address mentioned in a "from"-ish context
    if any(kw in text_lower for kw in ("email from", "emails from", "messages from", "writes me", "writes to me", "writes")):
        for addr in _EMAIL_RE.findall(instructions):
            out.append({"kind": "email_from", "from_email": addr.lower()})
    return out


async def _extract_triggers_from_prompt(name: str, instructions: str, default_tz: str = "UTC") -> list[dict]:
    """Parse the agent's freeform system prompt and return a structured
    triggers list. Returns [] if nothing actionable is found."""
    if not instructions or len(instructions.strip()) < 5:
        return []

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return _regex_extract_triggers(instructions)

    try:
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=api_key)
        sys_prompt = (
            "You extract proactive trigger configurations from a user's natural-language "
            "instructions for a personal assistant agent. Return ONLY a JSON array of "
            "trigger objects (no markdown, no commentary). Each trigger is one of:\n"
            '  {"kind": "email_from", "from_email": "<lowercase email address>"}\n'
            '  {"kind": "email_keyword", "subject_keyword": "<single word or short phrase>"}\n'
            '  {"kind": "schedule", "time_min": <minutes 0-1439>, "days_of_week": "<7-char Y/- mask Mon-Sun>", "timezone_name": "<IANA tz>"}\n\n'
            "Rules:\n"
            "- If the user says 'every weekday' use 'YYYYY--'. 'Every day' = 'YYYYYYY'. 'Mon/Wed/Fri' = 'Y-Y-Y--'.\n"
            "- For times like '9am' use time_min=540, '9:30am' = 570, '6pm' = 1080.\n"
            f"- If timezone isn't mentioned, use \"{default_tz}\".\n"
            "- If the user mentions watching emails from a person without an email address (e.g. 'my boss'), DO NOT emit an email_from trigger — return [] for that part since we don't know the address.\n"
            "- Multiple triggers per agent are fine. Return [] if nothing is actionable."
        )
        user_msg = (
            f'Agent name: "{name}"\n\n'
            f"System prompt:\n{instructions}\n\n"
            "Return the triggers JSON array now."
        )
        msg = await client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=600,
            system=sys_prompt,
            messages=[{"role": "user", "content": user_msg}],
        )
        text = "".join(b.text for b in msg.content if hasattr(b, "text")).strip()
        # Strip ```json fences if Claude added them anyway
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
        # Find the first '[' to be defensive against any preamble
        start = text.find("[")
        end = text.rfind("]")
        if start == -1 or end == -1 or end < start:
            return _regex_extract_triggers(instructions)
        parsed = json.loads(text[start : end + 1])
        if not isinstance(parsed, list):
            return _regex_extract_triggers(instructions)
        # Light validation — drop anything that doesn't match our schema
        clean: list[dict] = []
        for t in parsed:
            if not isinstance(t, dict):
                continue
            kind = t.get("kind")
            if kind == "email_from" and t.get("from_email"):
                clean.append({"kind": "email_from", "from_email": str(t["from_email"]).lower().strip()})
            elif kind == "email_keyword" and t.get("subject_keyword"):
                clean.append({"kind": "email_keyword", "subject_keyword": str(t["subject_keyword"]).strip()})
            elif kind == "schedule" and isinstance(t.get("time_min"), (int, float)):
                clean.append({
                    "kind": "schedule",
                    "time_min": int(t["time_min"]),
                    "days_of_week": str(t.get("days_of_week") or "YYYYYYY")[:7].ljust(7, "-"),
                    "timezone_name": str(t.get("timezone_name") or default_tz),
                })
        return clean
    except Exception as e:
        logger.warning(f"ghost_agents: trigger extraction failed: {e}")
        return _regex_extract_triggers(instructions)


async def _user_default_timezone(db: AsyncSession, user_id) -> str:
    """Best-effort: pull the user's timezone from their notification
    preferences row. Falls back to UTC if not set."""
    try:
        from routes.ghost_push import GhostNotificationPref
        result = await db.execute(
            select(GhostNotificationPref).where(GhostNotificationPref.user_id == user_id)
        )
        row = result.scalar_one_or_none()
        if row and row.timezone_name:
            return row.timezone_name
    except Exception:
        pass
    return "UTC"


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

    # Extract triggers automatically from the system prompt. The client
    # is allowed to send explicit triggers too (advanced users / future
    # UIs); if it does, we use those AS-IS and skip extraction. Otherwise
    # we run the LLM extractor on `instructions`.
    if body.triggers is not None and len(body.triggers) > 0:
        triggers_json = [t.model_dump(exclude_none=True) for t in body.triggers]
    else:
        default_tz = await _user_default_timezone(db, user_id)
        triggers_json = await _extract_triggers_from_prompt(
            body.name, body.instructions or "", default_tz=default_tz,
        )

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
