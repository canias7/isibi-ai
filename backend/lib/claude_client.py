"""
Shared Claude API client — used by ghost_ai, ghost_tools, and teams_bot.
Keeps the Anthropic API key server-side.
"""

import os
import httpx
from typing import Optional

ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = "claude-sonnet-4-20250514"


async def call_claude(
    messages: list[dict],
    system: str = "You are GoFarther AI, a helpful assistant.",
    tools: list[dict] | None = None,
    max_tokens: int = 4096,
) -> dict:
    """
    Call Claude API with optional tool use.

    Returns:
        {
            "text": str,           # Combined text from all text blocks
            "tool_use": dict|None, # {"id": str, "name": str, "input": dict} if tool was called
            "stop_reason": str,    # "end_turn" or "tool_use"
            "raw_content": list,   # Raw content blocks from API
        }
    """
    if not ANTHROPIC_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    payload = {
        "model": MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    }
    if tools:
        payload["tools"] = tools

    async with httpx.AsyncClient(timeout=120) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
            },
            json=payload,
        )
        if res.status_code != 200:
            detail = "Claude API error"
            try:
                detail = res.json().get("error", {}).get("message", detail)
            except Exception:
                pass
            raise RuntimeError(f"Claude API error ({res.status_code}): {detail}")
        data = res.json()

    # Parse response
    text_parts = []
    tool_use = None

    for block in data.get("content", []):
        if block.get("type") == "text":
            text_parts.append(block["text"])
        elif block.get("type") == "tool_use":
            tool_use = {
                "id": block.get("id", ""),
                "name": block["name"],
                "input": block["input"],
            }

    return {
        "text": "\n".join(text_parts) if text_parts else "",
        "tool_use": tool_use,
        "stop_reason": data.get("stop_reason", "end_turn"),
        "raw_content": data.get("content", []),
    }


async def ask_claude(prompt: str, system: str = "You are a helpful assistant.") -> str:
    """Simple one-shot Claude call. Returns text response."""
    result = await call_claude(
        messages=[{"role": "user", "content": prompt}],
        system=system,
    )
    return result["text"]
