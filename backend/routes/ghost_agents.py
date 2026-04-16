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

import asyncio
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


class GhostSavedContact(Base):
    """A user's "my boss"/"my mom" relationship table. Synced from the
    mobile client so the agent extractor can resolve labels like
    "my boss" → the actual email address. One row per
    (user_id, workspace_id, label)."""
    __tablename__ = "ghost_saved_contacts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    workspace_id = Column(String(100), nullable=False, default="personal")
    label = Column(String(120), nullable=False)   # "my boss"
    name = Column(String(200), nullable=True)     # "John Smith"
    email = Column(String(200), nullable=True)
    phone = Column(String(60), nullable=True)
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
        # Saved contacts (relationships table)
        await db.execute(sql_text("""
            CREATE TABLE IF NOT EXISTS ghost_saved_contacts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                workspace_id VARCHAR(100) NOT NULL DEFAULT 'personal',
                label VARCHAR(120) NOT NULL,
                name VARCHAR(200),
                email VARCHAR(200),
                phone VARCHAR(60),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await db.execute(sql_text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_ghost_saved_contacts "
            "ON ghost_saved_contacts (user_id, workspace_id, label)"
        ))
        # Invoices captured by Bill Catcher (and future agents)
        await db.execute(sql_text("""
            CREATE TABLE IF NOT EXISTS ghost_invoices (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                workspace_id VARCHAR(100) NOT NULL DEFAULT 'personal',
                agent_client_id VARCHAR(100),
                vendor_name VARCHAR(300) NOT NULL,
                invoice_number VARCHAR(120),
                amount NUMERIC(15,2),
                currency VARCHAR(10) NOT NULL DEFAULT 'USD',
                due_date DATE,
                status VARCHAR(30) NOT NULL DEFAULT 'pending',
                items JSONB NOT NULL DEFAULT '[]'::jsonb,
                source_email_from VARCHAR(300),
                source_email_subject VARCHAR(500),
                source_email_date TIMESTAMPTZ,
                raw_extraction JSONB NOT NULL DEFAULT '{}'::jsonb,
                notes TEXT,
                approved_by UUID,
                approved_at TIMESTAMPTZ,
                paid_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await db.execute(sql_text(
            "CREATE INDEX IF NOT EXISTS ix_ghost_invoices_user_ws "
            "ON ghost_invoices (user_id, workspace_id)"
        ))
        await db.execute(sql_text(
            "CREATE INDEX IF NOT EXISTS ix_ghost_invoices_status "
            "ON ghost_invoices (user_id, workspace_id, status)"
        ))
        await db.execute(sql_text(
            "CREATE INDEX IF NOT EXISTS ix_ghost_invoices_due "
            "ON ghost_invoices (user_id, workspace_id, due_date)"
        ))
        await db.commit()
        _schema_checked = True
        logger.info("ghost_agents: tables ensured")
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


async def _extract_triggers_from_prompt(
    name: str,
    instructions: str,
    default_tz: str = "UTC",
    saved_contacts: list[dict] | None = None,
) -> list[dict]:
    """Parse the agent's freeform system prompt and return a structured
    triggers list. Returns [] if nothing actionable is found.

    saved_contacts is a list of {label, name, email} dicts the user has
    stored under their relationships ("my boss", "my mom"). They get
    injected into the system prompt so Claude can resolve "my boss" to
    the actual email address."""
    if not instructions or len(instructions.strip()) < 5:
        return []

    # Build contact resolution lines for the LLM
    contacts_section = ""
    if saved_contacts:
        contact_lines = []
        for c in saved_contacts:
            label = (c.get("label") or "").strip()
            email = (c.get("email") or "").strip()
            name_part = (c.get("name") or "").strip()
            if label and email:
                if name_part:
                    contact_lines.append(f'  - "{label}" ({name_part}) → {email}')
                else:
                    contact_lines.append(f'  - "{label}" → {email}')
        if contact_lines:
            contacts_section = (
                "\n\nUser's saved contacts (resolve label references like 'my boss' "
                "to the matching email when emitting triggers):\n" + "\n".join(contact_lines)
            )

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return _regex_extract_triggers(instructions)

    try:
        from anthropic import AsyncAnthropic
        # 30s hard timeout on the Claude call. Without this, a slow or
        # stalled Anthropic response would block the POST /agents handler
        # past the frontend's 60s fetch deadline, surfacing as
        # "Server is taking a moment" even with retries. On timeout we
        # fall back to the regex extractor below.
        client = AsyncAnthropic(api_key=api_key, timeout=30.0)
        sys_prompt = (
            "You extract proactive trigger configurations from a user's natural-language "
            "instructions for a personal assistant agent. Return ONLY a JSON array of "
            "trigger objects (no markdown, no commentary). Each trigger is one of:\n"
            '  {"kind": "email_from", "from_email": "<lowercase email address>", "actions": [<optional action list>]}\n'
            '  {"kind": "email_keyword", "subject_keyword": "<single word or short phrase>", "actions": [<optional action list>]}\n'
            '  {"kind": "schedule", "time_min": <minutes 0-1439>, "days_of_week": "<7-char Y/- mask Mon-Sun>", "timezone_name": "<IANA tz>"}\n\n'
            "Supported actions (for email triggers only, schedule triggers never carry actions):\n"
            '  "auto_reply" — the agent will automatically draft and send an email reply on the user\'s behalf.\n\n'
            "Rules:\n"
            "- If the user says 'every weekday' use 'YYYYY--'. 'Every day' = 'YYYYYYY'. 'Mon/Wed/Fri' = 'Y-Y-Y--'.\n"
            "- For times like '9am' use time_min=540, '9:30am' = 570, '6pm' = 1080.\n"
            f"- If timezone isn't mentioned, use \"{default_tz}\".\n"
            "- If the user mentions watching emails from a person identified by a label (e.g. 'my boss', 'my mom'), look up the saved contact list and emit an email_from trigger using the matching contact's email. If the label is NOT in the saved contacts and no concrete email is provided, do NOT emit a trigger for that — skip it.\n"
            "- If the user's prompt contains reply intent — phrases like 'reply back', 'respond to them', 'answer them', 'auto-reply', 'write back', 'send a reply' — add \"auto_reply\" to the matching email trigger's actions array. Only apply to email triggers.\n"
            "- Do NOT invent actions. Only emit \"auto_reply\" when the user explicitly asks for a reply. Reading/notifying alone is NOT reply intent.\n"
            "- Omit the actions field entirely (or use []) when there are no actions.\n"
            "- Multiple triggers per agent are fine. Return [] if nothing is actionable."
            + contacts_section
        )
        user_msg = (
            f'Agent name: "{name}"\n\n'
            f"System prompt:\n{instructions}\n\n"
            "Return the triggers JSON array now."
        )
        msg = await client.messages.create(
            model="claude-sonnet-4-20250514",
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
        # Known actions allowlist; drop anything we don't recognize so a
        # hallucinated action can't slip through to the poller.
        KNOWN_ACTIONS = {"auto_reply"}

        def _clean_actions(raw: Any) -> list[str]:
            if not isinstance(raw, list):
                return []
            return [a for a in raw if isinstance(a, str) and a in KNOWN_ACTIONS]

        clean: list[dict] = []
        for t in parsed:
            if not isinstance(t, dict):
                continue
            kind = t.get("kind")
            if kind == "email_from" and t.get("from_email"):
                entry = {"kind": "email_from", "from_email": str(t["from_email"]).lower().strip()}
                actions = _clean_actions(t.get("actions"))
                if actions:
                    entry["actions"] = actions
                clean.append(entry)
            elif kind == "email_keyword" and t.get("subject_keyword"):
                entry = {"kind": "email_keyword", "subject_keyword": str(t["subject_keyword"]).strip()}
                actions = _clean_actions(t.get("actions"))
                if actions:
                    entry["actions"] = actions
                clean.append(entry)
            elif kind == "schedule" and isinstance(t.get("time_min"), (int, float)):
                # Schedule triggers never carry actions
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


async def _load_saved_contacts(db: AsyncSession, user_id, workspace_id: str) -> list[dict]:
    """Return [{label, name, email}, …] for use as resolution context
    when extracting triggers from the agent prompt."""
    try:
        res = await db.execute(sql_text(
            "SELECT label, name, email, phone FROM ghost_saved_contacts "
            "WHERE user_id = :uid AND workspace_id = :ws"
        ), {"uid": str(user_id), "ws": workspace_id})
        out = []
        for row in res.all():
            out.append({"label": row[0], "name": row[1], "email": row[2], "phone": row[3]})
        return out
    except Exception:
        return []


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
    # Email-trigger actions: for now only ["auto_reply"] is supported.
    # Schedule triggers must leave this empty.
    actions: Optional[list[str]] = None
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
    # Inline contacts — if provided, saves them before extraction so
    # the extractor can resolve labels like "my boss" in one round-trip.
    saved_contacts: Optional[list[dict]] = None


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


@router.get("/prebuilt")
async def list_prebuilt_agents_endpoint(authorization: str = Header(...)):
    """List all available pre-built agent templates."""
    _verify_auth(authorization)
    from lib.prebuilt_agents import list_prebuilt_agents
    return {"agents": list_prebuilt_agents()}


@router.post("/prebuilt/{template_id}/activate")
async def activate_prebuilt_agent(
    template_id: str,
    authorization: str = Header(...),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Activate a pre-built agent for the user."""
    from lib.prebuilt_agents import get_prebuilt_agent
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    workspace_id = _normalize_workspace(x_workspace_id)
    await ensure_agents_schema(db)

    template = get_prebuilt_agent(template_id)
    if not template:
        raise HTTPException(404, f"Unknown template: {template_id}")

    client_id = f"prebuilt_{template_id}_{str(uuid.uuid4())[:6]}"

    agent = GhostAgent(
        id=uuid.uuid4(),
        user_id=user_id,
        workspace_id=workspace_id,
        client_id=client_id,
        name=template["name"],
        role=template["role"],
        instructions=template["instructions"],
        triggers=template["triggers"],
        enabled=True,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    logger.info("Activated prebuilt agent '%s' for user=%s", template_id, user_id)
    return {"status": "ok", "agent": _row_to_dict(agent)}


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
    import time as _time
    stage_timings: dict = {}
    t_start = _time.monotonic()

    def _mark(stage: str) -> None:
        stage_timings[stage] = round((_time.monotonic() - t_start) * 1000)

    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    workspace_id = _normalize_workspace(x_workspace_id)
    _mark("auth")
    await ensure_agents_schema(db)
    _mark("schema")

    if not body.client_id or not body.name:
        raise HTTPException(status_code=400, detail="client_id and name are required")

    # Extract triggers automatically from the system prompt. The client
    # is allowed to send explicit triggers too (advanced users / future
    # UIs); if it does, we use those AS-IS and skip extraction. Otherwise
    # we run the LLM extractor on `instructions`.
    # If contacts were passed inline, save them first. Runs on a FRESH
    # session so a lock on ghost_saved_contacts from a previous stuck
    # transaction can't block the main save path — and is wrapped in
    # a hard 5s ceiling so the request never waits on DB locks.
    contacts_debug: dict = {"sent": 0}
    if body.saved_contacts:
        contacts_debug["sent"] = len(body.saved_contacts)

        async def _save_contacts_isolated() -> None:
            from db import async_session
            async with async_session() as contacts_db:
                # 3s per-statement ceiling: if there's lock contention,
                # fail fast instead of blocking the whole handler.
                await contacts_db.execute(sql_text("SET LOCAL statement_timeout = 3000"))
                await contacts_db.execute(sql_text(
                    "DELETE FROM ghost_saved_contacts WHERE user_id = :uid AND workspace_id = :ws"
                ), {"uid": str(user_id), "ws": workspace_id})
                for c in body.saved_contacts or []:
                    label = (c.get("label") or "").strip()
                    if not label:
                        continue
                    # Generate the id in Python rather than relying on
                    # the column DEFAULT gen_random_uuid() — pgcrypto
                    # isn't enabled on the Render postgres, so letting
                    # it default hit a NOT NULL violation and poisoned
                    # the transaction.
                    await contacts_db.execute(sql_text(
                        "INSERT INTO ghost_saved_contacts (id, user_id, workspace_id, label, name, email, phone, updated_at) "
                        "VALUES (:id, :uid, :ws, :label, :name, :email, :phone, NOW()) "
                        "ON CONFLICT (user_id, workspace_id, label) DO UPDATE "
                        "SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = NOW()"
                    ), {
                        "id": str(uuid.uuid4()),
                        "uid": str(user_id), "ws": workspace_id,
                        "label": label, "name": c.get("name"), "email": c.get("email"), "phone": c.get("phone"),
                    })
                await contacts_db.commit()

        try:
            await asyncio.wait_for(_save_contacts_isolated(), timeout=5.0)
            contacts_debug["ok"] = True
        except asyncio.TimeoutError:
            contacts_debug["error"] = "contacts_save_timeout_5s"
            logger.warning("ghost_agents: inline contacts save timed out (locks?)")
        except Exception as contacts_err:
            contacts_debug["error"] = str(contacts_err)[:200]
            logger.warning(f"ghost_agents: inline contacts save failed: {contacts_err}")
    _mark("contacts_save")

    # ── Save the agent FIRST with whatever triggers the client sent (or
    #    keep existing triggers on update). Extraction runs after the
    #    save is committed so a slow/broken extraction can NEVER block
    #    the save from succeeding. ────────────────────────────────────
    result = await db.execute(
        select(GhostAgent).where(
            GhostAgent.user_id == user_id,
            GhostAgent.workspace_id == workspace_id,
            GhostAgent.client_id == body.client_id,
        )
    )
    row = result.scalar_one_or_none()
    _mark("find_existing")
    now = datetime.now(timezone.utc)

    # Decide the triggers_json to persist on this first save:
    # - If the client sent explicit triggers, use them.
    # - Otherwise keep the existing row's triggers (preserves previous
    #   extraction while the new one runs).
    if body.triggers is not None and len(body.triggers) > 0:
        initial_triggers = [t.model_dump(exclude_none=True) for t in body.triggers]
    elif row is not None:
        initial_triggers = row.triggers or []
    else:
        initial_triggers = []

    if row:
        row.name = body.name
        row.role = body.role
        row.instructions = body.instructions
        row.triggers = initial_triggers
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
            triggers=initial_triggers,
            enabled=body.enabled if body.enabled is not None else True,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    await db.commit()
    await db.refresh(row)
    _mark("initial_save")

    # ── Now try extraction (skipped when client sent explicit triggers).
    #    Bounded by asyncio.wait_for so the handler always returns in
    #    bounded time. If it succeeds, update the row again with the
    #    extracted triggers. ────────────────────────────────────────────
    extraction_debug: dict = {}
    if body.triggers is not None and len(body.triggers) > 0:
        extraction_debug = {"mode": "explicit", "count": len(initial_triggers)}
    else:
        default_tz = await _user_default_timezone(db, user_id)
        _mark("load_tz")
        loaded_contacts = await _load_saved_contacts(db, user_id, workspace_id)
        _mark("load_contacts")
        extraction_debug["mode"] = "auto"
        extraction_debug["contacts_count"] = len(loaded_contacts)
        extraction_debug["workspace"] = workspace_id
        try:
            extracted = await asyncio.wait_for(
                _extract_triggers_from_prompt(
                    body.name, body.instructions or "",
                    default_tz=default_tz,
                    saved_contacts=loaded_contacts,
                ),
                timeout=15.0,
            )
            _mark("extract")
            extraction_debug["triggers_count"] = len(extracted)
            extraction_debug["triggers"] = extracted
            # Second commit: update row with extracted triggers
            row.triggers = extracted
            row.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(row)
            _mark("update_triggers")
        except asyncio.TimeoutError:
            extraction_debug["error"] = "extraction_timeout_15s"
            _mark("extract_timeout")
        except Exception as ext_err:
            extraction_debug["error"] = str(ext_err)[:200]
            _mark("extract_error")

    result_dict = _row_to_dict(row)
    extraction_debug["contacts_save"] = contacts_debug
    extraction_debug["stages_ms"] = stage_timings
    extraction_debug["total_ms"] = round((_time.monotonic() - t_start) * 1000)
    result_dict["_debug"] = extraction_debug
    logger.info(f"ghost_agents: upsert {body.client_id} stages={stage_timings}")
    return result_dict


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


# ── Saved contacts sync ────────────────────────────────────────────────


class SavedContactBody(BaseModel):
    label: str
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class SavedContactsBulkBody(BaseModel):
    contacts: list[SavedContactBody]


@router.post("/contacts/sync")
async def sync_saved_contacts(
    body: SavedContactsBulkBody,
    authorization: str = Header(...),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
):
    """Replace all saved contacts for the user+workspace with the
    incoming list. The mobile client owns the source of truth — this
    endpoint just mirrors it server-side so the agent extractor (and
    later, the trigger poller for relationship-based detection) can
    resolve labels like 'my boss' to actual email addresses."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    workspace_id = _normalize_workspace(x_workspace_id)
    await ensure_agents_schema(db)

    # Wipe + re-insert. Cheap because contact lists are tiny (<50 entries).
    await db.execute(sql_text(
        "DELETE FROM ghost_saved_contacts WHERE user_id = :uid AND workspace_id = :ws"
    ), {"uid": str(user_id), "ws": workspace_id})
    for c in body.contacts:
        if not c.label:
            continue
        await db.execute(sql_text("""
            INSERT INTO ghost_saved_contacts (user_id, workspace_id, label, name, email, phone, updated_at)
            VALUES (:uid, :ws, :label, :name, :email, :phone, NOW())
            ON CONFLICT (user_id, workspace_id, label) DO UPDATE
              SET name = :name, email = :email, phone = :phone, updated_at = NOW()
        """), {
            "uid": str(user_id), "ws": workspace_id,
            "label": c.label, "name": c.name, "email": c.email, "phone": c.phone,
        })
    await db.commit()

    # ── Re-extract triggers for every agent in this workspace ──────────
    # This closes the race condition where the user created an agent
    # with "my boss" before contacts were synced. Now that we have the
    # contacts, re-run the extraction so labels resolve to emails.
    try:
        contacts = await _load_saved_contacts(db, user_id, workspace_id)
        default_tz = await _user_default_timezone(db, user_id)
        agents_result = await db.execute(
            select(GhostAgent).where(
                GhostAgent.user_id == user_id,
                GhostAgent.workspace_id == workspace_id,
            )
        )
        agents = agents_result.scalars().all()
        re_extracted = 0
        for agent in agents:
            if not agent.instructions:
                continue
            new_triggers = await _extract_triggers_from_prompt(
                agent.name, agent.instructions,
                default_tz=default_tz,
                saved_contacts=contacts,
            )
            old_json = json.dumps(agent.triggers or [], sort_keys=True)
            new_json = json.dumps(new_triggers, sort_keys=True)
            if old_json != new_json:
                agent.triggers = new_triggers
                agent.updated_at = datetime.now(timezone.utc)
                re_extracted += 1
        if re_extracted:
            await db.commit()
            logger.info(f"ghost_agents: re-extracted triggers for {re_extracted} agent(s) "
                        f"after contacts sync for user={user_id}")
    except Exception as e:
        logger.warning(f"ghost_agents: trigger re-extraction failed: {e}")

    return {"ok": True, "count": len(body.contacts)}


@router.get("/contacts")
async def list_saved_contacts(
    authorization: str = Header(...),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
):
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    workspace_id = _normalize_workspace(x_workspace_id)
    await ensure_agents_schema(db)
    contacts = await _load_saved_contacts(db, user_id, workspace_id)
    return {"contacts": contacts}
