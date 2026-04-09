from __future__ import annotations

"""
Ghost task executor — runs a mobile-app scheduled task on the backend.

Uses Claude's native tool_use with a subset of tools that can actually be
executed server-side (email, sms, web_search, read_url, crypto, bulk_email,
bulk_sms). Claude can chain them across up to 3 turns so a task like
"Research X and email me the result" works.

For tools that only make sense on the user's phone (call, generate_qr,
create_meme, maps, etc.) we record them in last_result so the user sees
what was attempted when they open the app.
"""

import asyncio
import json
import logging
import os
from typing import Any
from urllib.parse import quote

import anthropic
import httpx

from models.ghost_scheduled_task import GhostScheduledTask
from services.email import send_generic_email, send_via_smtp
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")
TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")

MAX_TURNS = 3  # Claude can chain up to 3 tool calls per task

# Tools the backend can actually execute on its own (no phone needed)
SERVER_TOOLS: list[dict[str, Any]] = [
    {
        "name": "email",
        "description": "Send an email to a single recipient. Use this for any 'send me an email' or 'email X' request.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Recipient email address"},
                "subject": {"type": "string"},
                "body": {"type": "string", "description": "Plain text or simple HTML body"},
            },
            "required": ["to", "subject", "body"],
        },
    },
    {
        "name": "sms",
        "description": "Send a text message via Twilio to a single phone number in E.164 format (e.g. +15551234567).",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Phone number in E.164 format"},
                "body": {"type": "string", "description": "Message body (max 320 chars)"},
            },
            "required": ["to", "body"],
        },
    },
    {
        "name": "bulk_email",
        "description": "Send the same email to multiple recipients.",
        "input_schema": {
            "type": "object",
            "properties": {
                "recipients": {
                    "type": "array",
                    "items": {"type": "string", "description": "Email address"},
                },
                "subject": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["recipients", "subject", "body"],
        },
    },
    {
        "name": "bulk_sms",
        "description": "Send the same SMS to multiple phone numbers in E.164 format.",
        "input_schema": {
            "type": "object",
            "properties": {
                "recipients": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "body": {"type": "string"},
            },
            "required": ["recipients", "body"],
        },
    },
    {
        "name": "web_search",
        "description": "Search the web for current information using DuckDuckGo. Returns a list of snippets.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
    {
        "name": "read_url",
        "description": "Fetch a webpage and return its text content (up to 8000 chars).",
        "input_schema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
    },
    {
        "name": "crypto_price",
        "description": "Look up the current USD price of one or more cryptocurrencies via CoinGecko.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {
                    "type": "string",
                    "description": "Comma-separated coin ids like 'bitcoin,ethereum,solana'",
                }
            },
            "required": ["symbols"],
        },
    },
    {
        "name": "log_result",
        "description": "Record a plain-text result for the user to see in their app when you're done and no other tool is needed. Always call this last with a short summary, unless you already sent an email/sms.",
        "input_schema": {
            "type": "object",
            "properties": {"summary": {"type": "string"}},
            "required": ["summary"],
        },
    },
]


def _html_wrap(body: str) -> str:
    if "<html" in body.lower() or "<div" in body.lower():
        return body
    safe = (
        body.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )
    return (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
        "max-width:560px;margin:0 auto;padding:24px;font-size:15px;color:#222;line-height:1.55\">"
        f"{safe}"
        "<hr style=\"border:none;border-top:1px solid #eee;margin:24px 0 12px\"/>"
        "<p style=\"font-size:12px;color:#999;margin:0\">Sent by your scheduled task in isibi.ai</p>"
        "</div>"
    )


async def _lookup_user_smtp(user_email: str, db: AsyncSession) -> dict:
    try:
        from routes.ghost_auth import get_user_smtp
        return await get_user_smtp(user_email, db)
    except Exception as e:
        logger.warning("SMTP lookup failed for %s: %s", user_email, e)
        return {}


# ── Tool handlers ────────────────────────────────────────────────────────

async def _do_email(inp: dict, task: GhostScheduledTask, db: AsyncSession) -> str:
    to = (inp.get("to") or "").strip().rstrip(",.;")
    subject = (inp.get("subject") or "").strip()
    body = inp.get("body") or ""
    if "@" not in to or " " in to:
        return f"Invalid email address: {to}"
    html = _html_wrap(body)
    smtp = await _lookup_user_smtp(task.user_email, db)
    ok = False
    if smtp.get("smtp_host"):
        ok = await send_via_smtp(smtp, to=to, subject=subject, html=html)
    if not ok:
        ok = await send_generic_email(to=to, subject=subject, html=html)
    return f"Email sent to {to}" if ok else f"Email send FAILED to {to}"


async def _do_bulk_email(inp: dict, task: GhostScheduledTask, db: AsyncSession) -> str:
    recipients = inp.get("recipients") or []
    subject = (inp.get("subject") or "").strip()
    body = inp.get("body") or ""
    if not isinstance(recipients, list) or not recipients:
        return "No recipients"
    recipients = recipients[:50]
    html = _html_wrap(body)
    smtp = await _lookup_user_smtp(task.user_email, db)
    sent = 0
    for r in recipients:
        addr = (r or "").strip().rstrip(",.;") if isinstance(r, str) else ""
        if "@" not in addr:
            continue
        ok = False
        if smtp.get("smtp_host"):
            ok = await send_via_smtp(smtp, to=addr, subject=subject, html=html)
        if not ok:
            ok = await send_generic_email(to=addr, subject=subject, html=html)
        if ok:
            sent += 1
    return f"Bulk email sent to {sent}/{len(recipients)} recipients"


async def _do_sms(inp: dict) -> str:
    to = (inp.get("to") or "").strip()
    body = (inp.get("body") or "")[:320]
    if not to.startswith("+") or len(to) < 8:
        return f"Invalid phone number: {to}"
    if not (TWILIO_SID and TWILIO_TOKEN and TWILIO_NUMBER):
        return "SMS not configured on server (Twilio)"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
                auth=(TWILIO_SID, TWILIO_TOKEN),
                data={"From": TWILIO_NUMBER, "To": to, "Body": body},
            )
            if res.status_code in (200, 201):
                return f"SMS sent to {to}"
            return f"SMS failed ({res.status_code}): {res.text[:120]}"
    except Exception as e:
        return f"SMS error: {e}"


async def _do_bulk_sms(inp: dict) -> str:
    recipients = inp.get("recipients") or []
    body = (inp.get("body") or "")[:320]
    if not isinstance(recipients, list) or not recipients:
        return "No recipients"
    recipients = recipients[:50]
    sent = 0
    for to in recipients:
        result = await _do_sms({"to": to, "body": body})
        if result.startswith("SMS sent"):
            sent += 1
    return f"Bulk SMS sent to {sent}/{len(recipients)}"


async def _do_web_search(inp: dict) -> str:
    query = (inp.get("query") or "").strip()
    if not query:
        return "Empty query"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(
                f"https://api.duckduckgo.com/?q={quote(query)}&format=json&no_html=1"
            )
            data = res.json()
        parts: list[str] = []
        if data.get("Abstract"):
            parts.append(f"{data.get('Heading', 'Answer')}: {data['Abstract']}")
        for topic in (data.get("RelatedTopics") or [])[:5]:
            if isinstance(topic, dict) and topic.get("Text"):
                parts.append(f"- {topic['Text']}")
        if not parts:
            return "No results found."
        return "\n".join(parts)[:2000]
    except Exception as e:
        return f"Search error: {e}"


async def _do_read_url(inp: dict) -> str:
    url = (inp.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        return "Invalid URL"
    try:
        from routes.ghost_tools_v2 import _validate_external_url
        _validate_external_url(url)
    except Exception:
        return "URL rejected (SSRF protection)"
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            res = await client.get(url, headers={"User-Agent": "GoFarther-AI/1.0"})
            if res.status_code != 200:
                return f"Fetch failed: HTTP {res.status_code}"
            html = res.text[:50000]
        # Strip tags very naively
        import re
        text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
        text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:8000]
    except Exception as e:
        return f"Read error: {e}"


async def _do_crypto_price(inp: dict) -> str:
    symbols = (inp.get("symbols") or "").strip().lower()
    if not symbols:
        return "No symbols"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(
                f"https://api.coingecko.com/api/v3/simple/price?ids={quote(symbols)}&vs_currencies=usd"
            )
            if res.status_code != 200:
                return f"Crypto API error: HTTP {res.status_code}"
            data = res.json()
        if not data:
            return f"No price data for '{symbols}'"
        return "; ".join(f"{k}=${v.get('usd', '?')}" for k, v in data.items())
    except Exception as e:
        return f"Crypto error: {e}"


async def _dispatch_tool(
    name: str, inp: dict, task: GhostScheduledTask, db: AsyncSession
) -> str:
    try:
        if name == "email":
            return await _do_email(inp, task, db)
        if name == "bulk_email":
            return await _do_bulk_email(inp, task, db)
        if name == "sms":
            return await _do_sms(inp)
        if name == "bulk_sms":
            return await _do_bulk_sms(inp)
        if name == "web_search":
            return await _do_web_search(inp)
        if name == "read_url":
            return await _do_read_url(inp)
        if name == "crypto_price":
            return await _do_crypto_price(inp)
        if name == "log_result":
            return (inp.get("summary") or "Done.")[:500]
        return f"Unknown tool: {name}"
    except Exception as e:
        logger.error("Tool %s failed: %s", name, e, exc_info=True)
        return f"{name} error: {e}"


# ── Main executor ────────────────────────────────────────────────────────

def _build_system_prompt(task: GhostScheduledTask) -> str:
    agent_prompt = (task.agent_system_prompt or "").strip()
    base = agent_prompt or "You are a helpful AI assistant executing a scheduled task."
    return (
        f"{base}\n\n"
        "You are running a user's scheduled task on the server (no human is at "
        "the keyboard). Use the provided tools to actually DO the task — don't "
        "just describe what you would do. If the task asks you to send an email "
        "or text, call the email/sms tool. If it asks you to research or check "
        "something and then report back, use web_search/read_url/crypto_price "
        "first, then call email/sms to deliver the answer, then call log_result "
        "with a one-line summary. If the task just asks you to 'remind me' or "
        "'tell me' without a channel, send it as an email to the user (their "
        f"address is {task.user_email}). Be concise. Always finish with "
        "log_result if you didn't send a message."
    )


def _call_claude_sync(system: str, messages: list[dict]) -> dict:
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=system,
        tools=SERVER_TOOLS,
        messages=messages,
    )
    return {
        "stop_reason": response.stop_reason,
        "content": [
            {
                "type": block.type,
                **(
                    {"text": block.text}
                    if block.type == "text"
                    else {
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    }
                ),
            }
            for block in response.content
        ],
    }


async def execute_ghost_task(task: GhostScheduledTask, db: AsyncSession) -> str:
    """Run one scheduled task to completion. Returns a human summary."""
    if not ANTHROPIC_API_KEY:
        return "ANTHROPIC_API_KEY not configured"

    system = _build_system_prompt(task)
    messages: list[dict] = [{"role": "user", "content": task.command}]
    actions_taken: list[str] = []

    for turn in range(MAX_TURNS):
        try:
            resp = await asyncio.to_thread(_call_claude_sync, system, messages)
        except anthropic.APIError as e:
            logger.error("Task '%s' Anthropic error: %s", task.label, e)
            return f"AI error: {e}"
        except Exception as e:
            logger.error("Task '%s' AI call failed: %s", task.label, e, exc_info=True)
            return f"Error: {e}"

        content = resp["content"]
        tool_uses = [b for b in content if b["type"] == "tool_use"]
        text_blocks = [b["text"] for b in content if b["type"] == "text"]

        if not tool_uses:
            # Claude gave a final text answer. Record it.
            final = "\n".join(text_blocks).strip()
            if actions_taken:
                return " | ".join(actions_taken) + (f" — {final[:200]}" if final else "")
            return final[:500] or "Task completed with no action."

        # Execute each tool call, collect results
        tool_results = []
        for tu in tool_uses:
            name = tu["name"]
            inp = tu.get("input") or {}
            result = await _dispatch_tool(name, inp, task, db)
            logger.info("Task '%s' tool %s → %s", task.label, name, result[:120])
            actions_taken.append(f"{name}: {result[:100]}")
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": result,
                }
            )

        # Feed results back for the next turn
        messages.append({"role": "assistant", "content": content})
        messages.append({"role": "user", "content": tool_results})

    # Hit MAX_TURNS without a final text — return what we did
    return " | ".join(actions_taken) or "Task ran but produced no output."
