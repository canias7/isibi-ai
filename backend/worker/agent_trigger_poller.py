"""Proactive-agent trigger poller.

For every user's saved agents, this checks all configured triggers and
fires whichever ones match "right now". Two trigger families:

  1. **Email triggers** (`email_from`, `email_keyword`) — share a single
     mailbox poll per user with `push_email_poller`. We pull the same
     ~10 most-recent inbox messages and walk every agent looking for
     matches. Same dedupe cursor approach: store the last seen message
     id per (user, workspace, agent_id) so we never push the same email
     twice for the same agent. First poll ever just records the cursor
     without firing.

  2. **Schedule triggers** (`schedule`) — for each agent the scheduler
     loop checks: does the configured time-of-day in the agent's
     timezone match "now" (within the current minute)? If yes, run the
     agent's prompt with no event payload (just "It's your scheduled
     check-in") and push the result. 23-hour dedupe so DST or scheduler
     restart can't double-fire.

When a trigger matches, we run the agent's instructions through Claude
with the event payload as context. Claude returns a short message
(headline + one-line body). We push it via `send_push_to_user` titled
with the agent's name. The push payload includes `agent_id` so the
client can deep-link into the agent chat with the email loaded.

Why this lives in worker/ and not in the route: the route handles
persistence + CRUD (cheap, sync). The poller does the slow stuff —
mailbox calls, OAuth refreshes, LLM calls. Keeping it on the worker
side means the web dyno never blocks on it.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import select, text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from db import async_session

logger = logging.getLogger(__name__)


# ── Cursor table for dedupe ────────────────────────────────────────────


_cursor_schema_checked = False


async def _ensure_cursor_schema(db: AsyncSession) -> None:
    """One row per (user, workspace, agent_id, trigger_idx). Stores the
    last email message id we fired for that trigger so we don't double-
    push, and last_fired_at for schedule triggers (23h dedupe)."""
    global _cursor_schema_checked
    if _cursor_schema_checked:
        return
    try:
        await db.execute(sql_text("""
            CREATE TABLE IF NOT EXISTS ghost_agent_trigger_state (
                id VARCHAR(300) PRIMARY KEY,
                user_id UUID NOT NULL,
                workspace_id VARCHAR(100) NOT NULL,
                agent_client_id VARCHAR(100) NOT NULL,
                trigger_idx INTEGER NOT NULL,
                last_message_id VARCHAR(300),
                last_fired_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await db.execute(sql_text(
            "CREATE INDEX IF NOT EXISTS ix_ghost_agent_trigger_state_user "
            "ON ghost_agent_trigger_state (user_id)"
        ))
        await db.commit()
        _cursor_schema_checked = True
    except Exception as e:
        logger.warning(f"agent_trigger_poller: cursor schema ensure failed: {e}")
        _cursor_schema_checked = True


def _state_id(user_id, workspace_id: str, agent_client_id: str, trigger_idx: int) -> str:
    return f"{user_id}:{workspace_id}:{agent_client_id}:{trigger_idx}"


async def _load_cursor(db: AsyncSession, sid: str) -> dict | None:
    res = await db.execute(sql_text(
        "SELECT last_message_id, last_fired_at FROM ghost_agent_trigger_state WHERE id = :sid"
    ), {"sid": sid})
    row = res.first()
    if not row:
        return None
    return {"last_message_id": row[0], "last_fired_at": row[1]}


async def _save_message_cursor(db: AsyncSession, sid: str, user_id, workspace_id: str,
                                agent_client_id: str, trigger_idx: int, message_id: str) -> None:
    await db.execute(sql_text("""
        INSERT INTO ghost_agent_trigger_state
            (id, user_id, workspace_id, agent_client_id, trigger_idx, last_message_id, updated_at)
        VALUES (:sid, :uid, :ws, :acid, :tidx, :mid, NOW())
        ON CONFLICT (id) DO UPDATE SET last_message_id = :mid, updated_at = NOW()
    """), {
        "sid": sid, "uid": str(user_id), "ws": workspace_id,
        "acid": agent_client_id, "tidx": trigger_idx, "mid": message_id,
    })
    await db.commit()


async def _save_fired_cursor(db: AsyncSession, sid: str, user_id, workspace_id: str,
                              agent_client_id: str, trigger_idx: int) -> None:
    await db.execute(sql_text("""
        INSERT INTO ghost_agent_trigger_state
            (id, user_id, workspace_id, agent_client_id, trigger_idx, last_fired_at, updated_at)
        VALUES (:sid, :uid, :ws, :acid, :tidx, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET last_fired_at = NOW(), updated_at = NOW()
    """), {
        "sid": sid, "uid": str(user_id), "ws": workspace_id,
        "acid": agent_client_id, "tidx": trigger_idx,
    })
    await db.commit()


# ── Claude call ────────────────────────────────────────────────────────


async def _load_saved_contacts_for_user(db: AsyncSession, user_id, workspace_id: str) -> list[dict]:
    """Load the user's relationship labels (e.g. 'my boss' → email)
    so we can inject them into the agent's runtime system prompt. Without
    this the agent's LLM call doesn't know that Cristian Anias IS the
    user's boss and ends up saying 'this is not from your boss' on a
    correctly-matched trigger."""
    try:
        res = await db.execute(sql_text(
            "SELECT label, name, email, phone FROM ghost_saved_contacts "
            "WHERE user_id = :uid AND workspace_id = :ws"
        ), {"uid": str(user_id), "ws": workspace_id})
        return [
            {"label": r[0], "name": r[1], "email": r[2], "phone": r[3]}
            for r in res.all()
        ]
    except Exception:
        return []


def _format_saved_contacts_block(contacts: list[dict]) -> str:
    """Render contacts as a relationship context block for the agent's
    system prompt."""
    lines = []
    for c in contacts or []:
        label = (c.get("label") or "").strip()
        email = (c.get("email") or "").strip()
        name = (c.get("name") or "").strip()
        if not label:
            continue
        if email and name:
            lines.append(f'  - "{label}" is {name} ({email})')
        elif email:
            lines.append(f'  - "{label}" → {email}')
        elif name:
            lines.append(f'  - "{label}" is {name}')
    if not lines:
        return ""
    return (
        "\n\nThe user has these saved relationships. Use them when "
        "interpreting events — if an email is from one of these people, "
        "the relationship label applies:\n" + "\n".join(lines)
    )


async def _run_agent_against_event(
    agent_name: str,
    instructions: str,
    event_text: str,
    saved_contacts: list[dict] | None = None,
) -> tuple[str, str]:
    """Run the agent's system prompt against an event payload. Returns
    (headline, body). Falls back to a mechanical summary if Claude fails
    so we always push something useful instead of dropping the alert."""
    try:
        from anthropic import AsyncAnthropic
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY missing")
        client = AsyncAnthropic(api_key=api_key, timeout=30.0)
        contacts_block = _format_saved_contacts_block(saved_contacts or [])
        sys = (
            f"You are {agent_name}. {instructions or 'You watch for events and report back to the user concisely.'}"
            + contacts_block
            + "\n\nWhen given an event, respond in EXACTLY this format with no extra text:\n"
            "HEADLINE: <max 60 chars, what happened>\n"
            "BODY: <max 140 chars, the actionable detail>\n"
        )
        msg = await client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=200,
            system=sys,
            messages=[{"role": "user", "content": event_text}],
        )
        text = "".join(b.text for b in msg.content if hasattr(b, "text")).strip()
        headline = ""
        body = ""
        for line in text.splitlines():
            if line.startswith("HEADLINE:"):
                headline = line[len("HEADLINE:"):].strip()
            elif line.startswith("BODY:"):
                body = line[len("BODY:"):].strip()
        if headline or body:
            return (headline or agent_name, body or text[:140])
        return (agent_name, text[:140])
    except Exception as e:
        logger.warning(f"agent_trigger_poller: Claude failed: {e}")
        # Mechanical fallback — return the event truncated
        return (agent_name, event_text[:140])


# ── Trigger matching helpers ───────────────────────────────────────────


def _email_matches_from(msg: dict, target_email: str) -> bool:
    if not target_email:
        return False
    target = target_email.strip().lower()
    from_raw = (msg.get("from") or msg.get("from_name") or "").strip()
    addr = ""
    m = re.search(r"<([^>]+)>", from_raw)
    if m:
        addr = m.group(1).strip().lower()
    elif "@" in from_raw:
        addr = from_raw.lower()
    return addr == target or target in addr


def _email_matches_keyword(msg: dict, keyword: str) -> bool:
    if not keyword:
        return False
    subject = (msg.get("subject") or "").lower()
    return keyword.strip().lower() in subject


def _format_email_event(msg: dict) -> str:
    from_display = msg.get("from_name") or msg.get("from") or "unknown"
    subject = msg.get("subject") or "(no subject)"
    snippet = (msg.get("snippet") or msg.get("preview") or "")[:300]
    return f"New email\nFrom: {from_display}\nSubject: {subject}\nPreview: {snippet}"


# ── Main entry: email trigger pass ─────────────────────────────────────


async def poll_email_triggers_for_all_users(cap_messages_per_user: int = 10) -> int:
    """Walk every agent that has at least one email trigger, poll the
    user's mailbox, fire any matching triggers. Returns the number of
    pushes fired."""
    from routes.ghost_connectors import (
        ADAPTERS,
        _decrypt_creds,
        _refresh_mail_creds,
    )
    from routes.ghost_push import send_push_to_user, _ensure_schema as ensure_push_schema
    from routes.ghost_agents import GhostAgent, ensure_agents_schema
    from worker.push_email_poller import MAIL_APPS_TO_POLL

    pushes_fired = 0

    async with async_session() as db:
        try:
            await ensure_agents_schema(db)
            await ensure_push_schema(db)
            await _ensure_cursor_schema(db)

            # Load every enabled agent that has any trigger at all
            res = await db.execute(sql_text(
                "SELECT user_id, workspace_id, client_id, name, instructions, triggers "
                "FROM ghost_agents WHERE enabled = TRUE "
                "AND jsonb_array_length(triggers) > 0"
            ))
            agent_rows = res.all()
            if not agent_rows:
                return 0

            # Group agents by user so we share one mailbox poll per user
            by_user: dict[Any, list[dict]] = {}
            for r in agent_rows:
                triggers = r.triggers or []
                # Skip agents whose ONLY triggers are schedule (no email work needed)
                has_email_trigger = any(
                    isinstance(t, dict) and t.get("kind") in ("email_from", "email_keyword")
                    for t in triggers
                )
                if not has_email_trigger:
                    continue
                by_user.setdefault(r.user_id, []).append({
                    "workspace_id": r.workspace_id,
                    "client_id": r.client_id,
                    "name": r.name,
                    "instructions": r.instructions or "",
                    "triggers": triggers,
                })
            if not by_user:
                return 0

            # For each user, find their first connected mailbox and pull
            # the latest messages once. Walk every agent against that
            # batch.
            for user_id, agents in by_user.items():
                try:
                    # Find this user's mail connectors. We use the same
                    # preference order as push_email_poller and stop
                    # at the first successful one.
                    app_id_list = ", ".join(f"'{a}'" for a in MAIL_APPS_TO_POLL)
                    rows_result = await db.execute(sql_text(
                        f"SELECT workspace_id, app_id, encrypted_creds "
                        f"FROM ghost_connector_creds "
                        f"WHERE user_id = :uid AND app_id IN ({app_id_list})"
                    ), {"uid": str(user_id)})
                    creds_rows = rows_result.all()
                    if not creds_rows:
                        continue

                    messages_by_workspace: dict[str, list[dict]] = {}

                    for cr in creds_rows:
                        ws = cr.workspace_id or "personal"
                        if ws in messages_by_workspace:
                            continue  # already polled this workspace
                        try:
                            creds = _decrypt_creds(cr.encrypted_creds)
                            if not creds:
                                continue
                            creds = await _refresh_mail_creds(user_id, cr.app_id, creds, db, ws)
                            adapter = ADAPTERS.get(cr.app_id)
                            if not adapter:
                                continue
                            result = await adapter("list_inbox", {"limit": cap_messages_per_user}, creds)
                            if not isinstance(result, dict) or "error" in result:
                                continue
                            messages = result.get("messages") or []
                            if messages:
                                messages_by_workspace[ws] = messages
                        except Exception as poll_err:
                            logger.warning(f"agent_trigger_poller: poll failed user={user_id} app={cr.app_id}: {poll_err}")
                            continue

                    if not messages_by_workspace:
                        continue

                    # Walk each agent's email triggers against the polled messages
                    for agent in agents:
                        ws = agent["workspace_id"] or "personal"
                        messages = messages_by_workspace.get(ws)
                        if not messages:
                            # No mailbox for that agent's workspace
                            continue

                        for tidx, trig in enumerate(agent["triggers"]):
                            if not isinstance(trig, dict):
                                continue
                            kind = trig.get("kind")
                            if kind not in ("email_from", "email_keyword"):
                                continue

                            sid = _state_id(user_id, ws, agent["client_id"], tidx)
                            cursor = await _load_cursor(db, sid)

                            # First poll: just record cursor at top of inbox
                            if not cursor or not cursor.get("last_message_id"):
                                top_id = str(messages[0].get("id") or "")
                                if top_id:
                                    await _save_message_cursor(db, sid, user_id, ws, agent["client_id"], tidx, top_id)
                                continue

                            last_seen = cursor["last_message_id"] or ""
                            new_msgs: list[dict] = []
                            for msg in messages:
                                mid = str(msg.get("id") or "")
                                if mid == last_seen:
                                    break
                                new_msgs.append(msg)
                            if not new_msgs:
                                continue

                            matched_msg = None
                            for msg in new_msgs:
                                if kind == "email_from" and _email_matches_from(msg, trig.get("from_email") or ""):
                                    matched_msg = msg
                                    break
                                if kind == "email_keyword" and _email_matches_keyword(msg, trig.get("subject_keyword") or ""):
                                    matched_msg = msg
                                    break

                            # Always advance the cursor to the newest message
                            # so we don't re-inspect the same batch next poll
                            newest_id = str(new_msgs[0].get("id") or "")
                            if newest_id:
                                await _save_message_cursor(db, sid, user_id, ws, agent["client_id"], tidx, newest_id)

                            if not matched_msg:
                                continue

                            # Run the agent against the matched event —
                            # inject saved contacts so the LLM can resolve
                            # relationship labels ("my boss" → real email).
                            event_text = _format_email_event(matched_msg)
                            saved_contacts = await _load_saved_contacts_for_user(db, user_id, ws)
                            headline, body = await _run_agent_against_event(
                                agent["name"], agent["instructions"], event_text,
                                saved_contacts=saved_contacts,
                            )
                            push_result = await send_push_to_user(
                                user_id,
                                db,
                                title=f"{agent['name']}: {headline}"[:80],
                                body=body[:200],
                                kind="agent_trigger",
                                data={
                                    "workspace_id": ws,
                                    "agent_client_id": agent["client_id"],
                                    "trigger_kind": kind,
                                    "message_id": str(matched_msg.get("id") or ""),
                                },
                                urgent=True,  # bypass quiet hours — user explicitly armed this
                            )
                            if push_result.get("sent", 0) > 0:
                                pushes_fired += 1
                except Exception as outer:
                    logger.warning(f"agent_trigger_poller: user={user_id} failed: {outer}")
                    continue
        except Exception as e:
            logger.warning(f"agent_trigger_poller: top-level error: {e}", exc_info=True)

    if pushes_fired:
        logger.info(f"agent_trigger_poller: fired {pushes_fired} agent pushes")
    return pushes_fired


# ── Schedule trigger pass ──────────────────────────────────────────────


async def tick_schedule_triggers() -> int:
    """Called every minute. Walks every agent with a schedule trigger
    and fires any whose configured time-of-day matches "now" in the
    agent's timezone (with 23h dedupe)."""
    from routes.ghost_push import send_push_to_user, _ensure_schema as ensure_push_schema
    from routes.ghost_agents import GhostAgent, ensure_agents_schema

    fired = 0

    async with async_session() as db:
        try:
            await ensure_agents_schema(db)
            await ensure_push_schema(db)
            await _ensure_cursor_schema(db)

            res = await db.execute(sql_text(
                "SELECT user_id, workspace_id, client_id, name, instructions, triggers "
                "FROM ghost_agents WHERE enabled = TRUE "
                "AND jsonb_array_length(triggers) > 0"
            ))
            rows = res.all()
            if not rows:
                return 0

            now_utc = datetime.now(timezone.utc)
            for r in rows:
                triggers = r.triggers or []
                ws = r.workspace_id or "personal"
                for tidx, trig in enumerate(triggers):
                    if not isinstance(trig, dict) or trig.get("kind") != "schedule":
                        continue
                    time_min = trig.get("time_min")
                    if time_min is None:
                        continue
                    tz_name = trig.get("timezone_name") or "UTC"
                    days_of_week = trig.get("days_of_week") or "YYYYYYY"
                    try:
                        from zoneinfo import ZoneInfo
                        tz = ZoneInfo(tz_name)
                    except Exception:
                        tz = timezone.utc
                    now_local = now_utc.astimezone(tz)
                    minute_of_day = now_local.hour * 60 + now_local.minute
                    if minute_of_day != int(time_min):
                        continue
                    # Day-of-week filter (Monday=0)
                    dow_idx = now_local.weekday()
                    if dow_idx >= len(days_of_week) or days_of_week[dow_idx] != "Y":
                        continue

                    sid = _state_id(r.user_id, ws, r.client_id, tidx)
                    cursor = await _load_cursor(db, sid)
                    if cursor and cursor.get("last_fired_at"):
                        last = cursor["last_fired_at"]
                        if isinstance(last, datetime) and (now_utc - last) < timedelta(hours=23):
                            continue

                    event_text = (
                        f"It's your scheduled check-in time ({now_local.strftime('%I:%M %p %Z')}). "
                        f"Generate your scheduled report based on your instructions."
                    )
                    try:
                        saved_contacts = await _load_saved_contacts_for_user(
                            db, r.user_id, r.workspace_id or "personal",
                        )
                        headline, body = await _run_agent_against_event(
                            r.name, r.instructions or "", event_text,
                            saved_contacts=saved_contacts,
                        )
                        push_result = await send_push_to_user(
                            r.user_id,
                            db,
                            title=f"{r.name}: {headline}"[:80],
                            body=body[:200],
                            kind="agent_trigger",
                            data={
                                "workspace_id": ws,
                                "agent_client_id": r.client_id,
                                "trigger_kind": "schedule",
                            },
                            urgent=True,
                        )
                        if push_result.get("sent", 0) > 0:
                            fired += 1
                        await _save_fired_cursor(db, sid, r.user_id, ws, r.client_id, tidx)
                    except Exception as inner:
                        logger.warning(f"agent_trigger_poller: schedule fire failed user={r.user_id}: {inner}")
                        continue
        except Exception as e:
            logger.warning(f"agent_trigger_poller: schedule top-level error: {e}", exc_info=True)

    if fired:
        logger.info(f"agent_trigger_poller: fired {fired} scheduled agent pushes")
    return fired
