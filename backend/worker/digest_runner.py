"""Daily morning digest runner.

Called from the main scheduler loop every minute. For each user with
a digest config that matches "now" in their timezone, assembles a
personalized summary from the sources they picked and delivers it
via push and/or email.

Assembly strategy:
  1. For each enabled source, fetch raw data (inbox counts, calendar
     events, saved memory, spreadsheet sums).
  2. Pass the raw data through Claude Sonnet with a tight prompt that
     says "summarize this into a 3-bullet morning brief, be
     conversational, use the user's name, append the user's custom
     instructions". The user's personal tone/rules come in via the
     custom_prompt field.
  3. Push the short 1-line headline via ghost_push.send_push_to_user
     (user sees it on lock screen).
  4. If email_enabled, also send the full HTML digest via
     ghost_connectors.send_email_for_user so the user can read the
     long version in their inbox.

Why the AI summarization layer:
  Without it the digest is a mechanical bullet list ("14 unread, 3
  calendar events, $890 pending"). Passing it through Claude makes
  it feel written for the user — it picks the most relevant stuff,
  drops empty sections gracefully, and respects the user's custom
  voice/tone instructions. Uses the cheapest available Sonnet call,
  ~500 input tokens + 200 output tokens per digest.

Dedupe / idempotency:
  After a successful run we set last_fired_at = now. The scheduler
  loop checks "is last_fired_at < 23 hours ago" before re-firing so
  DST transitions and clock drift can't double-send.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from db import async_session

logger = logging.getLogger(__name__)


def _day_matches(days_of_week: str, weekday_idx: int) -> bool:
    """Does the config's day filter allow `weekday_idx` (0=Mon, 6=Sun)?"""
    if not days_of_week or len(days_of_week) != 7:
        return True
    try:
        return days_of_week[weekday_idx] == "Y"
    except Exception:
        return True


async def _fetch_inbox_summary(user_id, workspace_id: str, db: AsyncSession) -> dict | None:
    """Pull the latest 10 messages from the first connected mailbox in
    this workspace and summarize them into a counts-and-senders dict."""
    try:
        from routes.ghost_connectors import (
            _get_creds,
            _refresh_mail_creds,
            ADAPTERS,
        )
        MAIL_APPS = ("gmail", "outlook_mail", "neo_mail", "titan_mail", "yahoo_mail", "icloud_mail", "zoho_mail", "fastmail_mail", "imap_mail")
        for app_id in MAIL_APPS:
            creds = await _get_creds(user_id, app_id, db, workspace_id)
            if not creds:
                continue
            creds = await _refresh_mail_creds(user_id, app_id, creds, db, workspace_id)
            adapter = ADAPTERS.get(app_id)
            if not adapter:
                continue
            result = await adapter("list_inbox", {"limit": 10}, creds)
            if not isinstance(result, dict) or "error" in result:
                continue
            msgs = result.get("messages") or []
            unread = [m for m in msgs if m.get("unread")]
            return {
                "provider": app_id,
                "total": len(msgs),
                "unread": len(unread),
                "top_unread": [
                    {
                        "from": (m.get("from_name") or m.get("from") or "").split("<")[0].strip(),
                        "subject": (m.get("subject") or "(no subject)")[:100],
                    }
                    for m in unread[:3]
                ],
            }
    except Exception as e:
        logger.warning(f"digest inbox summary failed user={user_id}: {e}")
    return None


async def _fetch_spreadsheet_sum(
    user_id, workspace_id: str, workbook: str, column: str, db: AsyncSession,
) -> dict | None:
    """Run excel_online.sum_column against the user's workbook. Returns
    {sum, count, workbook} or None on any error."""
    try:
        from routes.ghost_connectors import _get_creds, _refresh_microsoft_token, ADAPTERS
        creds = await _get_creds(user_id, "excel_online", db, workspace_id)
        if not creds:
            return None
        creds = await _refresh_microsoft_token(user_id, "excel_online", creds, db, workspace_id)
        adapter = ADAPTERS.get("excel_online")
        if not adapter:
            return None
        result = await adapter("sum_column", {"workbook_id": workbook, "column": column}, creds)
        if not isinstance(result, dict) or "error" in result:
            return None
        return {
            "workbook": workbook,
            "column": column,
            "sum": result.get("sum"),
            "count": result.get("count"),
        }
    except Exception as e:
        logger.warning(f"digest spreadsheet sum failed user={user_id}: {e}")
    return None


async def _summarize_with_claude(
    raw: dict, user_name: str, custom_prompt: str | None,
) -> tuple[str, str]:
    """Stitch the raw digest data into a short headline + HTML body
    via Claude. Returns (headline, html_body).

    The headline is what shows in the push banner. The HTML body
    goes into the email if email_enabled."""
    import os
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not anthropic_key:
        return _fallback_summary(raw, user_name)

    try:
        import anthropic as _anthropic
        client = _anthropic.Anthropic(api_key=anthropic_key)

        # Compact, structured input the model can parse reliably.
        import json
        facts = json.dumps({k: v for k, v in raw.items() if v is not None}, default=str)

        custom = f"\n\nUser's personal instructions: {custom_prompt}" if custom_prompt else ""
        name_part = f" for {user_name}" if user_name else ""

        prompt = (
            f"You are writing a morning brief{name_part}. Read the facts below "
            "and write TWO outputs in this exact format:\n\n"
            "HEADLINE: <one sentence, max 10 words, the single most important thing>\n"
            "BODY: <3-5 short bullets in HTML with <ul><li>, friendly tone, skip any section with no data>\n"
            "\n"
            "If there are no actionable items, say so briefly instead of padding."
            f"{custom}\n\n"
            f"Facts (JSON):\n{facts}"
        )

        resp = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text if resp.content else ""

        # Parse the two-part output. Loose parsing so small formatting
        # drift from Claude doesn't break the whole digest.
        headline = ""
        body = ""
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.upper().startswith("HEADLINE:"):
                headline = stripped.split(":", 1)[1].strip()
            elif stripped.upper().startswith("BODY:"):
                body = stripped.split(":", 1)[1].strip()
                # Also absorb any remaining lines as part of the body
                # (Claude sometimes wraps HTML across multiple lines)
                body_lines = []
                collecting = False
                for l in text.splitlines():
                    if l.strip().upper().startswith("BODY:"):
                        body_lines.append(l.split(":", 1)[1].strip())
                        collecting = True
                    elif collecting:
                        body_lines.append(l)
                body = "\n".join(body_lines).strip()
                break
        if not headline:
            headline = "Your morning brief"
        if not body:
            body = f"<p>{text[:500]}</p>"
        return headline[:200], body[:5000]
    except Exception as e:
        logger.warning(f"digest claude summarization failed: {e}")
        return _fallback_summary(raw, user_name)


def _fallback_summary(raw: dict, user_name: str) -> tuple[str, str]:
    """Mechanical summary when Claude isn't available or errors out.
    Builds a safe non-AI version so the digest still delivers."""
    parts: list[str] = []
    inbox = raw.get("inbox")
    if inbox:
        parts.append(f"<li><b>Inbox:</b> {inbox.get('unread', 0)} unread of {inbox.get('total', 0)} recent</li>")
        for m in (inbox.get("top_unread") or [])[:3]:
            parts.append(f"<li style='margin-left:14px'>{m.get('from')}: {m.get('subject')}</li>")
    if raw.get("spreadsheet"):
        s = raw["spreadsheet"]
        parts.append(f"<li><b>{s.get('workbook')}</b> column {s.get('column')}: {s.get('sum')} across {s.get('count')} values</li>")
    if raw.get("notes"):
        parts.append(f"<li><b>Reminders:</b> {len(raw['notes'])} saved notes</li>")
    headline = f"Good morning{', ' + user_name if user_name else ''}"
    if not parts:
        body = "<p>Quiet morning — no urgent items on your plate.</p>"
    else:
        body = "<ul>" + "".join(parts) + "</ul>"
    return headline, body


async def run_digest_for_config(
    config, db: AsyncSession, force: bool = False,
) -> dict:
    """Assemble and deliver one user's digest. Used by both the
    scheduler tick (force=False, dedupes on last_fired_at) and the
    'run now' endpoint (force=True, always runs)."""
    from routes.ghost_push import send_push_to_user
    from routes.ghost_connectors import send_email_for_user
    from routes.ghost_auth import GhostUser

    user_id = config.user_id
    workspace_id = config.workspace_id or "personal"

    # Load the user's display name for personalization
    user_name = ""
    try:
        res = await db.execute(select(GhostUser).where(GhostUser.id == user_id))
        user = res.scalar_one_or_none()
        if user:
            user_name = (user.name or "").split(" ")[0]
    except Exception:
        pass

    # 1. Gather raw data from each enabled source
    raw: dict[str, Any] = {}
    if config.inbox_summary:
        inbox = await _fetch_inbox_summary(user_id, workspace_id, db)
        if inbox:
            raw["inbox"] = inbox
    if config.spreadsheet_workbook and config.spreadsheet_column:
        ss = await _fetch_spreadsheet_sum(
            user_id, workspace_id, config.spreadsheet_workbook, config.spreadsheet_column, db,
        )
        if ss:
            raw["spreadsheet"] = ss
    # Calendar source: Google Calendar / Outlook Calendar connectors
    # aren't implemented yet (only Excel / mail / CRM). When they ship,
    # plug them in here via the same pattern as _fetch_inbox_summary.

    # 2. Summarize via Claude (with fallback)
    headline, body_html = await _summarize_with_claude(raw, user_name, config.custom_prompt)

    # 3. Deliver via push
    push_result = None
    if config.push_enabled:
        try:
            push_result = await send_push_to_user(
                user_id,
                db,
                title=headline[:100],
                body="Tap to see your full brief",
                kind="digest",
                data={"source": "digest", "workspace_id": workspace_id},
            )
        except Exception as e:
            logger.warning(f"digest push failed user={user_id}: {e}")

    # 4. Deliver via email (optional)
    email_result = None
    if config.email_enabled and config.email_recipient:
        try:
            full_html = f"""
                <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px">
                  <h2 style="font-size:22px;font-weight:700;margin:0 0 12px">{headline}</h2>
                  {body_html}
                  <p style="font-size:12px;color:#999;margin-top:32px">Sent by GoFarther AI · Morning Digest</p>
                </div>
            """
            email_result = await send_email_for_user(
                user_id,
                "",  # user_email — the router auto-loads it from ghost_auth
                db,
                to=config.email_recipient,
                subject=headline[:150],
                html=full_html,
                workspace_id=workspace_id,
            )
        except Exception as e:
            logger.warning(f"digest email failed user={user_id}: {e}")

    # 5. Mark last_fired_at so we don't re-fire for 23 hours
    if not force:
        config.last_fired_at = datetime.now(timezone.utc)
        await db.commit()

    return {
        "headline": headline,
        "body_html": body_html,
        "push": push_result,
        "email": email_result,
        "raw_sources": list(raw.keys()),
    }


async def tick_digests() -> int:
    """Main entry called by the scheduler loop. Walks every digest
    config, checks whether it should fire right now in the user's
    local time, and runs the ones that match. Returns the number
    of digests delivered."""
    from routes.ghost_digest import GhostDigestConfig, ensure_digest_schema

    fired = 0
    async with async_session() as db:
        try:
            await ensure_digest_schema(db)
            result = await db.execute(
                select(GhostDigestConfig).where(GhostDigestConfig.enabled == True)  # noqa: E712
            )
            configs = result.scalars().all()
            if not configs:
                return 0

            now_utc = datetime.now(timezone.utc)

            for config in configs:
                try:
                    # Dedupe: if this config fired in the last 23 hours,
                    # skip (handles DST, clock drift, retries).
                    if config.last_fired_at:
                        elapsed = now_utc - config.last_fired_at
                        if elapsed < timedelta(hours=23):
                            continue

                    # Convert "now" to the user's local timezone
                    try:
                        from zoneinfo import ZoneInfo
                        tz = ZoneInfo(config.timezone_name or "UTC")
                    except Exception:
                        tz = timezone.utc
                    local_now = now_utc.astimezone(tz)
                    local_min = local_now.hour * 60 + local_now.minute

                    # Fire window — must match within a 60s tolerance
                    # since the scheduler runs every 60 seconds
                    if abs(local_min - config.time_min) > 1:
                        # Not this minute
                        continue

                    # Day-of-week filter (Monday = 0)
                    weekday = local_now.weekday()
                    if not _day_matches(config.days_of_week, weekday):
                        continue

                    logger.info(f"Firing digest: user={config.user_id} workspace={config.workspace_id}")
                    await run_digest_for_config(config, db, force=False)
                    fired += 1
                except Exception as inner:
                    logger.warning(f"digest tick failed for config={config.id}: {inner}")
                    continue
        except Exception as e:
            logger.warning(f"digest tick top-level: {e}", exc_info=True)

    if fired:
        logger.info(f"digest tick fired {fired} digests")
    return fired
