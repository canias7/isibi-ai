from __future__ import annotations

"""
Ghost task executor — runs a mobile-app scheduled task on the backend.

Exposes the FULL set of tools the mobile chat/agent can use by calling the
existing ghost_tools* HTTP endpoints internally (over 127.0.0.1:$PORT) with
a minted ghost token for the task's owner. Claude runs in a multi-turn
tool_use loop so a task like "research X and email me" works end-to-end.

Client-only tools that can't run without the phone (maps, save_contact,
remember, modify_file) are mapped to a "client_only" stub that tells
Claude the result must be delivered via email/sms instead.
"""

import asyncio
import json
import logging
import os
from typing import Any, Callable

import anthropic
import httpx

from models.ghost_scheduled_task import GhostScheduledTask
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")
INTERNAL_BASE = os.getenv(
    "INTERNAL_API_BASE", f"http://127.0.0.1:{os.getenv('PORT', '8000')}"
)

MAX_TURNS = 4  # allow research → summarize → email chain


# ── Tool definitions (mirrors routes/ghost_ai.py CLAUDE_TOOLS) ───────────

def _load_claude_tools() -> list[dict]:
    """Pull the full tool list from ghost_ai so we stay in sync with chat."""
    try:
        from routes.ghost_ai import CLAUDE_TOOLS
        return list(CLAUDE_TOOLS)
    except Exception as e:
        logger.error("Could not import CLAUDE_TOOLS: %s", e)
        return []


# Map tool name → (relative URL path, fn(input)→request body).
# Every tool that can actually run server-side has an entry. Anything else
# is treated as "client_only" and rejected with a helpful hint.
TOOL_ENDPOINTS: dict[str, tuple[str, Callable[[dict], dict]]] = {
    "create_file": (
        "/api/ghost/tools/create-file",
        lambda i: {
            "description": i.get("description", ""),
            "file_type": i.get("file_type", "pdf"),
            "quality": i.get("quality", "standard"),
        },
    ),
    "web_search": (
        "/api/ghost/tools/web-search",
        lambda i: {"query": i.get("query", "")},
    ),
    "read_url": (
        "/api/ghost/tools/read-url",
        lambda i: {"url": i.get("url", ""), "question": i.get("question", "Summarize this page.")},
    ),
    "run_code": (
        "/api/ghost/tools/run-code",
        lambda i: {"description": i.get("description", "")},
    ),
    "translate": (
        "/api/ghost/tools/translate-doc",
        lambda i: {"text": i.get("text", ""), "target_language": i.get("target_language", "English")},
    ),
    "generate_image": (
        "/api/ghost/ai/image",
        lambda i: {"prompt": i.get("description", ""), "size": "1024x1024"},
    ),
    "sms": (
        "/api/ghost/tools/v2/send-sms",
        lambda i: {"to": i.get("target", ""), "body": i.get("text", "")},
    ),
    "email": (
        "/api/ghost/tools/v2/send-email",
        lambda i: {
            "to": i.get("target", ""),
            "subject": i.get("subject", ""),
            "body": i.get("body", ""),
        },
    ),
    "youtube_summary": (
        "/api/ghost/tools/v2/youtube-summary",
        lambda i: {"url": i.get("url", "")},
    ),
    "research": (
        "/api/ghost/tools/v2/research",
        lambda i: {"topic": i.get("topic", ""), "type": i.get("type", "general")},
    ),
    "generate_qr": (
        "/api/ghost/tools/v2/generate-qr",
        lambda i: {"data": i.get("data", "")},
    ),
    "create_event": (
        "/api/ghost/tools/v2/create-event",
        lambda i: {
            "title": i.get("title", ""),
            "date": i.get("date", ""),
            "time": i.get("time"),
        },
    ),
    "create_invoice": (
        "/api/ghost/tools/v2/create-invoice",
        lambda i: {"client_name": i.get("client_name", ""), "items": i.get("items", "")},
    ),
    "crypto_portfolio": (
        "/api/ghost/tools/v2/crypto-portfolio",
        lambda i: {"symbols": i.get("symbols", "")},
    ),
    "social_post": (
        "/api/ghost/tools/v2/social-post",
        lambda i: {"platform": i.get("platform", "twitter"), "content": i.get("content", "")},
    ),
    "create_meme": (
        "/api/ghost/tools/v3/create-meme",
        lambda i: {"top_text": i.get("top_text", ""), "bottom_text": i.get("bottom_text", "")},
    ),
    "barcode_lookup": (
        "/api/ghost/tools/v3/barcode-lookup",
        lambda i: {"barcode": i.get("barcode", "")},
    ),
    "compare_urls": (
        "/api/ghost/tools/v2/compare",
        lambda i: {"urls": i.get("urls", ""), "question": i.get("question", "Compare these.")},
    ),
    "bulk_email": (
        "/api/ghost/tools/v2/send-email-bulk",
        lambda i: {"recipients": i.get("recipients", [])},
    ),
    "bulk_sms": (
        "/api/ghost/tools/v2/send-sms-bulk",
        lambda i: {"recipients": i.get("recipients", [])},
    ),
}

# Tools that only work on the user's phone — we tell Claude to reroute.
CLIENT_ONLY_TOOLS = {
    "call": "Voice calls require the user's phone. Send an SMS or email instead.",
    "maps": "Use web_search for location info and email the result instead.",
    "remember": "Memory facts can only be saved from the chat. Log the fact via email to yourself instead.",
    "save_contact": "Contacts can only be saved from the chat. Email yourself the contact info instead.",
    "modify_file": "File modification requires an already-uploaded file. Use create_file instead.",
}


# ── Token minting + HTTP dispatch ───────────────────────────────────────

async def _get_user_id(email: str, db: AsyncSession) -> str | None:
    try:
        from routes.ghost_auth import GhostUser
        res = await db.execute(select(GhostUser).where(GhostUser.email == email))
        user = res.scalar_one_or_none()
        return str(user.id) if user else None
    except Exception as e:
        logger.warning("User lookup failed for %s: %s", email, e)
        return None


async def _mint_internal_token(email: str, db: AsyncSession) -> str | None:
    try:
        from routes.ghost_auth import create_ghost_token
        user_id = await _get_user_id(email, db)
        if not user_id:
            return None
        return create_ghost_token(user_id, email)
    except Exception as e:
        logger.error("Token mint failed for %s: %s", email, e)
        return None


async def _http_call(path: str, body: dict, token: str) -> tuple[bool, str]:
    """Call an internal endpoint. Returns (ok, short_text_result)."""
    url = f"{INTERNAL_BASE}{path}"
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(
                url,
                json=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
    except Exception as e:
        return False, f"Network error: {e}"

    if res.status_code >= 400:
        return False, f"HTTP {res.status_code}: {res.text[:300]}"

    # Extract a short human-readable result from whatever JSON shape came back
    try:
        data = res.json()
    except Exception:
        return True, (res.text or "")[:800]

    # Pick the most useful key in priority order
    for key in (
        "result",
        "summary",
        "text",
        "answer",
        "content",
        "message",
        "url",
        "file_url",
        "image_url",
        "results",
    ):
        if key in data and data[key]:
            val = data[key]
            if isinstance(val, (dict, list)):
                return True, json.dumps(val)[:1500]
            return True, str(val)[:1500]
    # Fallback: return the whole payload
    return True, json.dumps(data)[:1500]


# ── Main executor ────────────────────────────────────────────────────────

def _build_system_prompt(task: GhostScheduledTask) -> str:
    agent_prompt = (task.agent_system_prompt or "").strip()
    base = agent_prompt or "You are a helpful AI assistant executing a scheduled task."
    return (
        f"{base}\n\n"
        "You are running a user's scheduled task on the server (no human is "
        "at the keyboard). Use the provided tools to actually DO the task — "
        "don't just describe what you would do. The user's email is "
        f"{task.user_email}. If the task asks you to check, research, or "
        "compute something and then deliver it, chain multiple tool calls: "
        "first gather the info (web_search/read_url/research/crypto_portfolio/"
        "run_code/etc.), then call `email` or `sms` with the results. If the "
        "task doesn't specify a delivery channel but asks you to 'tell me' or "
        "'remind me', send the result as an email to the user's address above. "
        "Be concise. When finished, give a short final text summary of what "
        "you did."
    )


def _call_claude_sync(system: str, messages: list[dict], tools: list[dict]) -> dict:
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=system,
        tools=tools,
        messages=messages,
    )
    blocks = []
    for b in response.content:
        if b.type == "text":
            blocks.append({"type": "text", "text": b.text})
        elif b.type == "tool_use":
            blocks.append(
                {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
            )
    return {"stop_reason": response.stop_reason, "content": blocks}


async def _dispatch_tool(
    name: str, inp: dict, token: str
) -> str:
    """Run one tool call. Returns a string result for feeding back to Claude."""
    if name in CLIENT_ONLY_TOOLS:
        return f"Tool '{name}' is not available server-side. {CLIENT_ONLY_TOOLS[name]}"

    endpoint = TOOL_ENDPOINTS.get(name)
    if not endpoint:
        return f"Tool '{name}' has no server mapping. Email the user with the answer instead."

    path, body_fn = endpoint
    try:
        body = body_fn(inp or {})
    except Exception as e:
        return f"Tool '{name}' input error: {e}"

    ok, text = await _http_call(path, body, token)
    prefix = "OK" if ok else "ERROR"
    return f"{prefix}: {text}"


async def execute_ghost_task(task: GhostScheduledTask, db: AsyncSession) -> str:
    """Run one scheduled task to completion. Returns a human summary."""
    if not ANTHROPIC_API_KEY:
        return "ANTHROPIC_API_KEY not configured"

    token = await _mint_internal_token(task.user_email, db)
    if not token:
        return f"Could not mint token for {task.user_email} (user missing?)"

    tools = _load_claude_tools()
    if not tools:
        return "No tools available (CLAUDE_TOOLS import failed)"

    system = _build_system_prompt(task)
    messages: list[dict] = [{"role": "user", "content": task.command}]
    actions_taken: list[str] = []

    for _turn in range(MAX_TURNS):
        try:
            resp = await asyncio.to_thread(
                _call_claude_sync, system, messages, tools
            )
        except anthropic.APIError as e:
            logger.error("Task '%s' Anthropic error: %s", task.label, e)
            return f"AI error: {e}"
        except Exception as e:
            logger.error(
                "Task '%s' AI call failed: %s", task.label, e, exc_info=True
            )
            return f"Error: {e}"

        content = resp["content"]
        tool_uses = [b for b in content if b["type"] == "tool_use"]
        text_blocks = [b["text"] for b in content if b["type"] == "text"]

        if not tool_uses:
            final = "\n".join(text_blocks).strip()
            if actions_taken:
                tail = f" — {final[:200]}" if final else ""
                return (" | ".join(actions_taken) + tail)[:2000]
            return final[:500] or "Task completed with no action."

        tool_results = []
        for tu in tool_uses:
            name = tu["name"]
            inp = tu.get("input") or {}
            result = await _dispatch_tool(name, inp, token)
            logger.info(
                "Task '%s' tool %s → %s", task.label, name, result[:160]
            )
            actions_taken.append(f"{name}: {result[:120]}")
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": result,
                }
            )

        messages.append({"role": "assistant", "content": content})
        messages.append({"role": "user", "content": tool_results})

    return (" | ".join(actions_taken) or "Task ran but produced no output.")[:2000]
