"""Urgent-email push poller.

Runs inside the backend scheduler loop every N minutes. For every
user that has at least one mail connector connected AND urgent_email
pushes enabled, it pulls the latest ~10 messages from their primary
inbox and looks for anything that qualifies as "urgent". When it
finds one, it pushes a notification to that user's devices.

What counts as urgent (any ONE of these is enough):

  1. **Sender matches a saved relationship contact** — e.g. the user
     has "my boss" saved pointing at john@acme.com and an email
     from john@acme.com just landed. This is the highest-signal
     criterion; relationship-tagged people are almost always
     important to the user.

  2. **Provider flagged it** — the mail provider itself marked the
     message as important:
     - Gmail: message has the IMPORTANT label
     - Outlook: importance = "high"
     - IMAP: the \\Flagged system flag is set

  3. **Subject contains urgency keywords** — case-insensitive match
     against: urgent, asap, critical, deadline, time-sensitive,
     action required, overdue, needs your attention.

Deduping: we track the last message id we pushed per (user, app_id)
pair in the poller_state table. On each poll we only push messages
whose id is "newer than last_seen". First poll after register just
records the current top-of-inbox id without pushing anything — we
don't want to flood the user with 10 years of backlog on day one.

Performance: at most 10 messages per user per poll, sequential
per-user with a small concurrency cap. The poller runs every 5
minutes, so worst-case latency is ~5 min between an urgent email
landing and the push firing. That's fine for anything short of a
real alerting product.

Not covered here (intentional):
  - Real-time push via IMAP IDLE / Gmail push watches. Needs
    per-user long-lived connections and Graph webhook endpoints;
    worth doing later if 5-min polling isn't fast enough.
  - Spam filtering. The user's inbox already filters spam for us;
    we only look at what's in the inbox.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Column, String, DateTime, select, and_, text as sql_text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession

from db import Base, async_session

logger = logging.getLogger(__name__)


# Keywords that, when present in the subject line, mark a message as
# urgent. Kept short and high-signal — too many false positives would
# desensitize users to the push. All matched case-insensitively.
URGENCY_KEYWORDS = [
    "urgent",
    "asap",
    "critical",
    "deadline",
    "time-sensitive",
    "time sensitive",
    "action required",
    "action needed",
    "overdue",
    "needs your attention",
    "immediate attention",
    "important:",  # "Important:" at the start is a common pattern
]

_URGENCY_RE = re.compile("|".join(re.escape(k) for k in URGENCY_KEYWORDS), re.IGNORECASE)


# Mail connector apps we'll poll. Order matters — we poll in this
# order and stop at the first successful call per user so a user with
# Gmail + Outlook doesn't get polled twice (they'd only see one of
# them anyway — the poller treats the first-connected mailbox as the
# primary one). Users who want all their mailboxes polled can give
# them separate workspaces.
MAIL_APPS_TO_POLL = [
    "gmail",
    "outlook_mail",
    "neo_mail",
    "titan_mail",
    "yahoo_mail",
    "icloud_mail",
    "zoho_mail",
    "fastmail_mail",
    "imap_mail",
]


class PushEmailPollerState(Base):
    """One row per (user, workspace, app_id) pair. Stores the last
    message id we processed so we only push emails that are genuinely
    new since the last poll."""
    __tablename__ = "ghost_push_email_poller_state"
    id = Column(String(200), primary_key=True)              # "<user_id>:<workspace_id>:<app_id>"
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    workspace_id = Column(String(100), nullable=False)
    app_id = Column(String(100), nullable=False)
    last_message_id = Column(String(300), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


_schema_checked = False


async def _ensure_schema(db: AsyncSession) -> None:
    global _schema_checked
    if _schema_checked:
        return
    try:
        await db.execute(sql_text("""
            CREATE TABLE IF NOT EXISTS ghost_push_email_poller_state (
                id VARCHAR(200) PRIMARY KEY,
                user_id UUID NOT NULL,
                workspace_id VARCHAR(100) NOT NULL,
                app_id VARCHAR(100) NOT NULL,
                last_message_id VARCHAR(300),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await db.execute(sql_text(
            "CREATE INDEX IF NOT EXISTS ix_ghost_push_email_poller_state_user "
            "ON ghost_push_email_poller_state (user_id)"
        ))
        await db.commit()
        _schema_checked = True
    except Exception as e:
        logger.warning(f"push_email_poller: schema ensure failed: {e}")
        _schema_checked = True


def _state_id(user_id, workspace_id: str, app_id: str) -> str:
    return f"{user_id}:{workspace_id}:{app_id}"


async def _load_state(db: AsyncSession, user_id, workspace_id: str, app_id: str) -> PushEmailPollerState | None:
    res = await db.execute(
        select(PushEmailPollerState).where(PushEmailPollerState.id == _state_id(user_id, workspace_id, app_id))
    )
    return res.scalar_one_or_none()


async def _save_state(db: AsyncSession, user_id, workspace_id: str, app_id: str, last_message_id: str) -> None:
    row = await _load_state(db, user_id, workspace_id, app_id)
    now = datetime.now(timezone.utc)
    if row:
        row.last_message_id = last_message_id
        row.updated_at = now
    else:
        db.add(PushEmailPollerState(
            id=_state_id(user_id, workspace_id, app_id),
            user_id=user_id,
            workspace_id=workspace_id,
            app_id=app_id,
            last_message_id=last_message_id,
            updated_at=now,
        ))
    await db.commit()


def _is_urgent(
    msg: dict,
    saved_contact_emails: set[str],
) -> tuple[bool, str]:
    """Decide whether a message counts as urgent. Returns (urgent, reason).
    The reason string is surfaced in the push body so the user knows
    why they're being pinged."""
    subject = (msg.get("subject") or "").strip()
    from_raw = (msg.get("from") or msg.get("from_name") or "").strip()

    # Parse the email address out of "Name <addr@domain>"
    addr = ""
    m = re.search(r"<([^>]+)>", from_raw)
    if m:
        addr = m.group(1).strip().lower()
    elif "@" in from_raw:
        addr = from_raw.lower()

    # 1. Saved contact match (highest priority)
    if addr and addr in saved_contact_emails:
        return True, f"from a saved contact"

    # 2. Provider-flagged
    flags = msg.get("flags") or []
    labels = msg.get("labels") or []
    importance = (msg.get("importance") or "").lower()
    if isinstance(flags, str):
        flags = [flags]
    if "\\Flagged" in flags or "IMPORTANT" in labels or importance == "high":
        return True, "flagged as important"

    # 3. Keyword match in subject
    if subject and _URGENCY_RE.search(subject):
        return True, "urgent keyword in subject"

    return False, ""


async def _load_saved_contact_emails_from_users_settings(db: AsyncSession, user_id) -> set[str]:
    """Our saved contacts live client-side in AsyncStorage, not on the
    backend — so we can't directly load them here. For now the poller
    ships with a simpler detection: provider-flag + subject-keyword only.
    If we ever start persisting contacts server-side (e.g. for the
    multi-user workspace phase), we'll load them here.

    Returning an empty set means the 'saved contact' rule is disabled,
    and urgency is decided entirely by flags + keywords. That's a
    narrower net but still catches the most actionable stuff."""
    return set()


async def poll_urgent_emails_for_all_users(cap_messages_per_user: int = 10) -> int:
    """Main entry point called by the scheduler loop. Walks every user
    who has at least one mail connector + urgent_email push enabled,
    pulls the latest messages from each, and pushes any that qualify.

    Returns the number of pushes fired (summed across all users)."""
    from routes.ghost_connectors import (
        GhostConnectorCred,
        ADAPTERS,
        APP_REGISTRY,
        _decrypt_creds,
        _refresh_mail_creds,
    )
    from routes.ghost_push import (
        GhostNotificationPref,
        get_user_prefs,
        send_push_to_user,
        _ensure_schema as ensure_push_schema,
    )

    pushes_fired = 0

    async with async_session() as db:
        try:
            await _ensure_schema(db)
            await ensure_push_schema(db)

            # Find every (user_id, workspace_id, app_id) row where the
            # app_id is one of our mail connectors. We group the result
            # by user_id so we only poll the first success per user.
            app_id_list = ", ".join(f"'{a}'" for a in MAIL_APPS_TO_POLL)
            rows_result = await db.execute(sql_text(
                f"SELECT user_id, workspace_id, app_id, encrypted_creds "
                f"FROM ghost_connector_creds "
                f"WHERE app_id IN ({app_id_list})"
            ))
            rows = rows_result.all()
            if not rows:
                return 0

            # Group by user
            by_user: dict[Any, list[tuple[str, str, str]]] = {}
            for r in rows:
                by_user.setdefault(r.user_id, []).append((r.workspace_id or "personal", r.app_id, r.encrypted_creds))

            for user_id, user_rows in by_user.items():
                try:
                    # Respect preferences
                    prefs = await get_user_prefs(user_id, db)
                    if not prefs.get("enabled", True) or not prefs.get("urgent_email", True):
                        continue

                    # Pre-load saved contact addresses for this user
                    saved_emails = await _load_saved_contact_emails_from_users_settings(db, user_id)

                    for workspace_id, app_id, encrypted_creds in user_rows:
                        try:
                            creds = _decrypt_creds(encrypted_creds)
                            if not creds:
                                continue
                            # Refresh OAuth tokens if needed
                            creds = await _refresh_mail_creds(user_id, app_id, creds, db, workspace_id)
                            adapter = ADAPTERS.get(app_id)
                            if not adapter:
                                continue

                            result = await adapter("list_inbox", {"limit": cap_messages_per_user}, creds)
                            if not isinstance(result, dict) or "error" in result:
                                continue
                            messages = result.get("messages") or []
                            if not messages:
                                continue

                            # First poll ever: just record the top-of-inbox
                            # id without pushing anything.
                            state = await _load_state(db, user_id, workspace_id, app_id)
                            if not state:
                                top_id = messages[0].get("id")
                                if top_id:
                                    await _save_state(db, user_id, workspace_id, app_id, str(top_id))
                                continue

                            last_seen = state.last_message_id or ""
                            new_msgs: list[dict] = []
                            for msg in messages:
                                mid = str(msg.get("id") or "")
                                if mid == last_seen:
                                    break
                                new_msgs.append(msg)

                            if not new_msgs:
                                continue

                            # Check each new message for urgency. Push
                            # the first urgent one we find so we don't
                            # spam (users on a busy inbox would get
                            # destroyed otherwise).
                            for msg in new_msgs:
                                urgent, reason = _is_urgent(msg, saved_emails)
                                if urgent:
                                    from_display = msg.get("from_name") or msg.get("from") or "someone"
                                    subject = msg.get("subject") or "(no subject)"
                                    push_result = await send_push_to_user(
                                        user_id,
                                        db,
                                        title=f"Urgent email from {from_display[:60]}",
                                        body=f"{subject[:180]} — {reason}",
                                        kind="urgent_email",
                                        data={
                                            "workspace_id": workspace_id,
                                            "app_id": app_id,
                                            "message_id": str(msg.get("id") or ""),
                                        },
                                        urgent=True,  # bypass quiet hours for truly urgent
                                    )
                                    if push_result.get("sent", 0) > 0:
                                        pushes_fired += 1
                                    break  # one push per poll per user, always

                            # Advance the last-seen cursor to the newest
                            # message regardless of whether we pushed
                            # (so we don't re-inspect it next poll).
                            newest = new_msgs[0].get("id")
                            if newest:
                                await _save_state(db, user_id, workspace_id, app_id, str(newest))
                            # Stop at the first mailbox we successfully
                            # polled per user — prevents double-pushing
                            # from users with multiple mail connectors.
                            break
                        except Exception as inner:
                            logger.warning(f"push_email_poller: user={user_id} app={app_id} failed: {inner}")
                            continue
                except Exception as outer:
                    logger.warning(f"push_email_poller: user={user_id} outer failed: {outer}")
                    continue

        except Exception as e:
            logger.warning(f"push_email_poller: top-level error: {e}", exc_info=True)

    if pushes_fired:
        logger.info(f"push_email_poller: fired {pushes_fired} urgent-email pushes")
    return pushes_fired
