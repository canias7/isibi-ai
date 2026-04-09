from __future__ import annotations

"""
Ghost task executor — runs a mobile-app scheduled task on the backend.

Flow:
1. Call Claude with the user's agent system prompt + the task command.
2. The system prompt tells Claude to respond in a structured format when
   an email is needed:
       SEND_EMAIL to=<addr> subject=<subject>
       <body lines…>
3. If we see SEND_EMAIL, parse it and send via user's SMTP (or Resend).
4. Otherwise return the reply text as-is for logging/notification.
"""

import asyncio
import logging
import os
import re
from typing import Optional, Tuple

import anthropic

from models.ghost_scheduled_task import GhostScheduledTask
from services.email import send_generic_email, send_via_smtp
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")

_EMAIL_HEADER_RE = re.compile(
    r"^\s*SEND_EMAIL\s+to=([^\s]+)\s+subject=(.+?)\s*$",
    re.IGNORECASE,
)


def _build_system_prompt(task: GhostScheduledTask) -> str:
    """Compose the agent system prompt with email-sending instructions."""
    agent_prompt = (task.agent_system_prompt or "").strip()
    base = agent_prompt or "You are a helpful AI assistant executing a scheduled task."
    return (
        f"{base}\n\n"
        "You are running a user's scheduled task. The task instruction is below.\n"
        "If the task asks you to send an email, respond EXACTLY in this format "
        "on the first line and nothing before it:\n"
        "SEND_EMAIL to=<recipient@email.com> subject=<your subject>\n"
        "Then write the email body on the following lines as plain text or simple HTML.\n"
        "Do not include any preamble, markdown code fences, or quotes around the header line.\n"
        "If the task does NOT require sending an email, just respond with a short plain-text "
        "result of what you did or found — it will be logged for the user."
    )


def _call_claude_sync(system: str, user_msg: str) -> str:
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    )
    return response.content[0].text.strip()


def _parse_email_response(text: str) -> Optional[Tuple[str, str, str]]:
    """If `text` starts with SEND_EMAIL header, return (to, subject, body). Else None."""
    if not text:
        return None
    lines = text.split("\n", 1)
    header = lines[0]
    body = lines[1] if len(lines) > 1 else ""
    m = _EMAIL_HEADER_RE.match(header)
    if not m:
        return None
    to = m.group(1).strip().rstrip(",.;")
    subject = m.group(2).strip()
    # Basic email sanity
    if "@" not in to or " " in to:
        return None
    return (to, subject, body.strip())


async def _lookup_user_smtp(user_email: str, db: AsyncSession) -> dict:
    """Best-effort lookup of user SMTP settings. Returns {} on any failure."""
    try:
        from routes.ghost_auth import get_user_smtp
        return await get_user_smtp(user_email, db)
    except Exception as e:
        logger.warning("SMTP lookup failed for %s: %s", user_email, e)
        return {}


async def execute_ghost_task(task: GhostScheduledTask, db: AsyncSession) -> str:
    """Run one scheduled task. Returns a short result string for logging."""
    if not ANTHROPIC_API_KEY:
        msg = "ANTHROPIC_API_KEY not configured"
        logger.error(msg)
        return msg

    system = _build_system_prompt(task)
    try:
        reply = await asyncio.to_thread(_call_claude_sync, system, task.command)
    except anthropic.APIError as e:
        logger.error("Anthropic error running task '%s': %s", task.label, e)
        return f"AI error: {e}"
    except Exception as e:
        logger.error("Task '%s' AI call failed: %s", task.label, e, exc_info=True)
        return f"Error: {e}"

    parsed = _parse_email_response(reply)
    if parsed is None:
        logger.info("Task '%s' produced non-email result: %s", task.label, reply[:120])
        return reply[:500]

    to, subject, body = parsed
    # Wrap plain text in a minimal HTML envelope
    if "<html" not in body.lower() and "<div" not in body.lower():
        safe = body.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
        html = (
            "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
            "max-width:560px;margin:0 auto;padding:24px;font-size:15px;color:#222;line-height:1.55\">"
            f"{safe}"
            "<hr style=\"border:none;border-top:1px solid #eee;margin:24px 0 12px\"/>"
            "<p style=\"font-size:12px;color:#999;margin:0\">Sent by your scheduled task in isibi.ai</p>"
            "</div>"
        )
    else:
        html = body

    # Prefer user's SMTP, fall back to Resend
    smtp_settings = await _lookup_user_smtp(task.user_email, db)
    ok = False
    if smtp_settings.get("smtp_host"):
        ok = await send_via_smtp(smtp_settings, to=to, subject=subject, html=html)
    if not ok:
        ok = await send_generic_email(to=to, subject=subject, html=html)

    if ok:
        result = f"Email sent to {to} (subject: {subject[:80]})"
        logger.info("Task '%s' → %s", task.label, result)
        return result
    else:
        result = f"Email send FAILED to {to}"
        logger.warning("Task '%s' → %s", task.label, result)
        return result
