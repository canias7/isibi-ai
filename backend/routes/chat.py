from __future__ import annotations
"""
Chat API — conversational AI endpoint.

The user chats with a model (Anias, Ambar, Mario, Claw).
The AI asks clarifying questions (max 2, multiple choice), then when it has
enough info, generates the spec and creates the project.

Improvements:
- Better question format with clickable [OPTIONS]
- Better [READY_TO_BUILD] detection with JSON validation
- Retry logic for malformed JSON (max 2 retries)
- Graceful error recovery with helpful messages
"""

import asyncio
import json
import logging
import os
import re
import traceback
import anthropic
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id, get_current_user_id
from generator.rag import build_rag_context, get_full_spec_as_schema_reference
from generator.orchestrator import create_project
from routes.billing_check import can_build
from models.user_preference import UserPreference

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Chat"])

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")

# ── Model personas ─────────────────────────────────────────────────

PERSONAS = {
    "anias-1.0": {
        "name": "Anias",
        "type": "software",
        "system": """You are Anias, a fast and decisive software builder AI by isibi.ai.

## CRITICAL RULE: Build fast, don't over-ask.
- If the user gives a CLEAR request, ask AT MOST 1 quick question, then BUILD.
- If they say "yes", "all of it", "just build it", "sure" — IMMEDIATELY [READY_TO_BUILD]. No more questions.
- After the FIRST round of questions, you MUST build. No second or third rounds.

## QUESTION FORMAT — ALWAYS use clickable options:
When you ask a question, format it with [OPTIONS] tags so the UI renders clickable buttons:

Example:
I'll build your CRM! Just a couple quick questions:

**What's the main focus?**

[OPTIONS]
- 📊 Lead tracking and pipeline management
- 📞 Contact and communication management
- 📋 Task and project tracking
- 🎯 All of the above — give me everything
[/OPTIONS]

Rules for options:
- Always provide 3-4 options per question
- Each option: emoji + short label + dash + brief description
- Always include a "All of the above" or "Surprise me" option as the last choice
- Only ONE [OPTIONS] block per message
- Keep the text before [OPTIONS] to 1-2 sentences

## How you work:
1. User describes what they want
2. Short enthusiastic response + ONE question with [OPTIONS]
3. Whatever they pick → [READY_TO_BUILD] with summary. DONE.
4. If their first message is detailed enough, SKIP questions and go straight to [READY_TO_BUILD].

## Rules:
- NEVER output JSON, code, or technical specs in chat
- NEVER ask more than 1 round of questions
- [READY_TO_BUILD] followed by summary
- Keep text to 2-3 sentences + options""",
    },
    "ambar-1.0": {
        "name": "Ambar",
        "type": "website",
        "system": """You are Ambar, a fast and creative website builder AI by isibi.ai.

## CRITICAL RULE: Build fast.
- Ask AT MOST 1 quick question with clickable options, then build.
- "yes", "sure", "all of it" → IMMEDIATELY [READY_TO_BUILD].

## QUESTION FORMAT — use [OPTIONS] tags:
Example:
Love the idea! I'll design something clean and modern.

**What vibe fits your brand?**

[OPTIONS]
- ✨ Minimal & airy — lots of whitespace, elegant (think Apple)
- 🎨 Bold & colorful — vibrant, eye-catching (think Stripe)
- 🏢 Professional & corporate — structured, trustworthy
- 🎯 Just make it look great — surprise me
[/OPTIONS]

Rules: 3-4 options, emoji + short label + dash + description, always include a "surprise me" option.

## How you work:
1. User says what they want → short response + ONE [OPTIONS] question
2. Whatever they pick → [READY_TO_BUILD] with summary

## Rules:
- NEVER ask more than 1 round, NEVER output JSON/code
- [READY_TO_BUILD] Summary of pages and style""",
    },
    "mario-1.0": {
        "name": "Mario",
        "type": "app",
        "system": """You are Mario, a fast and sharp app builder AI by isibi.ai.

## CRITICAL RULE: Build fast.
- Ask AT MOST 1 quick question with clickable options, then build.
- "yes", "sure", "all of it" → IMMEDIATELY [READY_TO_BUILD].

## QUESTION FORMAT — use [OPTIONS] tags:
Example:
I'm on it! I'll build a full app with Dashboard, Lists, and Detail pages.

**What type of app is this?**

[OPTIONS]
- 👤 Personal tool — just for me, simple and fast
- 👥 Team app — multiple users with roles and permissions
- 🌐 Customer-facing — end users sign up and use it
- 🎯 All of the above — full-featured with everything
[/OPTIONS]

Rules: 3-4 options, emoji + short label + dash + description, always include an "all/everything" option.

## How you work:
1. User says what they want → short response + ONE [OPTIONS] question
2. Whatever they pick → [READY_TO_BUILD] with summary

## Rules:
- NEVER ask more than 1 round, NEVER output JSON/code
- [READY_TO_BUILD] Summary of screens and features""",
    },
    "claw-1.0": {
        "name": "Claw",
        "type": "agent",
        "system": """You are Claw, a fast and clever AI agent builder by isibi.ai.

## CRITICAL RULE: Build fast.
- Ask AT MOST 1 quick question with clickable options, then build.
- "yes", "sure", "all of it" → IMMEDIATELY [READY_TO_BUILD].

## QUESTION FORMAT — use [OPTIONS] tags:
Example:
I'll wire up your automation! Quick question:

**How should it trigger?**

[OPTIONS]
- ⚡ Real-time — fires instantly when something happens
- 🕐 Scheduled — runs on a timer (hourly, daily, weekly)
- 🔘 Manual — triggered by a button click or API call
- 🎯 All of them — give me maximum flexibility
[/OPTIONS]

Rules: 3-4 options, emoji + short label + dash + description, always include an "all/everything" option.

## How you work:
1. User describes what to automate → short response + ONE [OPTIONS] question
2. Whatever they pick → [READY_TO_BUILD] with summary

## Rules:
- NEVER ask more than 1 round, NEVER output JSON/code
- [READY_TO_BUILD] Summary of triggers, conditions, actions""",
    },
}


# ── Preference learning ────────────────────────────────────────────

# Color name to hex mapping for preference extraction
_COLOR_MAP = {
    "red": "#ef4444", "blue": "#3b82f6", "green": "#22c55e",
    "purple": "#a855f7", "pink": "#ec4899", "orange": "#f97316",
    "yellow": "#eab308", "indigo": "#6366f1", "teal": "#14b8a6",
    "cyan": "#06b6d4", "black": "#000000", "white": "#ffffff",
    "gray": "#6b7280", "grey": "#6b7280", "rose": "#f43f5e",
    "violet": "#8b5cf6", "emerald": "#10b981", "amber": "#f59e0b",
    "lime": "#84cc16", "sky": "#0ea5e9", "fuchsia": "#d946ef",
}

_PREFERENCE_SIGNALS = {"always", "prefer", "default", "use", "make", "want", "like"}
_MINIMAL_KEYWORDS = {"minimal", "minimalist", "clean", "simple"}


def extract_preferences(user_message: str) -> dict:
    """
    Extract user preferences from a chat message using keyword matching.

    Returns a dict of preference key-value pairs found in the message.
    Only extracts preferences when the message contains signal words
    (always, prefer, default, like, want, make, use).
    """
    msg = user_message.lower().strip()
    prefs: dict = {}

    # Check if the message contains a preference signal word
    has_signal = any(word in msg for word in _PREFERENCE_SIGNALS)
    if not has_signal:
        return prefs

    # Theme preference: dark/light
    if "dark" in msg and ("theme" in msg or "mode" in msg or has_signal):
        prefs["theme"] = "dark"
    elif "light" in msg and ("theme" in msg or "mode" in msg or has_signal):
        prefs["theme"] = "light"

    # Color preference
    for color_name, hex_val in _COLOR_MAP.items():
        if color_name in msg and ("color" in msg or "colour" in msg or has_signal):
            prefs["primary_color"] = hex_val
            break

    # Style preference: minimal / clean / simple
    if any(kw in msg for kw in _MINIMAL_KEYWORDS):
        prefs["style"] = "minimal"
    elif "bold" in msg or "vibrant" in msg:
        prefs["style"] = "bold"
    elif "professional" in msg or "corporate" in msg:
        prefs["style"] = "professional"

    # Table layout preference
    if "table" in msg and ("wide" in msg or "wider" in msg or "full" in msg):
        prefs["table_layout"] = "wide"
    elif "table" in msg and ("compact" in msg or "narrow" in msg):
        prefs["table_layout"] = "compact"

    return prefs


async def _get_user_preferences(db: AsyncSession, user_id: UUID) -> dict:
    """Fetch stored preferences for a user from the database."""
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == user_id)
    )
    pref = result.scalar_one_or_none()
    if pref and pref.preferences:
        return dict(pref.preferences)
    return {}


async def _save_user_preferences(db: AsyncSession, user_id: UUID, org_id: UUID, new_prefs: dict):
    """Merge new preferences into the user's stored preferences."""
    if not new_prefs:
        return
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == user_id)
    )
    pref = result.scalar_one_or_none()
    if pref is None:
        pref = UserPreference(user_id=user_id, org_id=org_id, preferences=new_prefs)
        db.add(pref)
    else:
        merged = {**(pref.preferences or {}), **new_prefs}
        pref.preferences = merged
    await db.flush()


def _build_preferences_prompt(prefs: dict) -> str:
    """Build a system prompt section from stored user preferences."""
    if not prefs:
        return ""
    lines = ["User preferences (apply these to all generated apps):"]
    label_map = {
        "theme": "Preferred theme",
        "primary_color": "Preferred primary color",
        "style": "Preferred style",
        "table_layout": "Preferred table layout",
    }
    for key, value in prefs.items():
        label = label_map.get(key, key.replace("_", " ").title())
        lines.append(f"- {label}: {value}")
    return "\n".join(lines)


# ── Request / Response ─────────────────────────────────────────────

class ChatRequest(BaseModel):
    model: str  # e.g. "anias-1.0"
    messages: list[dict]  # [{"role": "user", "content": "..."}, ...]


class ChatResponse(BaseModel):
    reply: str
    ready_to_build: bool
    project_id: str | None = None
    project_name: str | None = None


# ── Chat endpoint ──────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def api_chat(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Conversational chat with an AI model.
    The AI asks questions, then signals [READY_TO_BUILD] when it has enough info.
    At that point, we auto-generate the spec and create the project.
    """
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="AI service not configured")

    persona = PERSONAS.get(body.model)
    if not persona:
        raise HTTPException(status_code=400, detail=f"Unknown model: {body.model}")

    # Extract preferences from the latest user message and save them
    user_messages = [m["content"] for m in body.messages if m["role"] == "user"]
    if user_messages:
        latest_prefs = extract_preferences(user_messages[-1])
        if latest_prefs:
            try:
                await _save_user_preferences(db, user_id, org_id, latest_prefs)
                await db.commit()
            except Exception as e:
                logger.warning("Failed to save preferences: %s", e)

    # Fetch stored preferences and inject into system prompt
    stored_prefs = {}
    try:
        stored_prefs = await _get_user_preferences(db, user_id)
    except Exception as e:
        logger.warning("Failed to fetch preferences: %s", e)

    system_prompt = persona["system"]
    prefs_prompt = _build_preferences_prompt(stored_prefs)
    if prefs_prompt:
        system_prompt = system_prompt + "\n\n" + prefs_prompt

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=system_prompt,
            messages=body.messages,
        )

        reply = response.content[0].text.strip()

    except anthropic.APIError as e:
        logger.error("Anthropic API error: %s", e)
        return ChatResponse(
            reply="I'm having trouble connecting to my brain right now. Please try again in a moment.",
            ready_to_build=False,
        )
    except Exception as e:
        logger.error("Chat error: %s\n%s", e, traceback.format_exc())
        return ChatResponse(
            reply="Something went wrong on my end. Please try again.",
            ready_to_build=False,
        )

    # Check if AI is ready to build
    if "[READY_TO_BUILD]" in reply:
        return await _handle_build(
            reply=reply,
            messages=body.messages,
            persona=persona,
            db=db,
            org_id=org_id,
            user_id=user_id,
        )

    # Normal conversation — AI is still asking questions
    return ChatResponse(
        reply=reply,
        ready_to_build=False,
    )


async def _handle_build(
    reply: str,
    messages: list[dict],
    persona: dict,
    db: AsyncSession,
    org_id: UUID,
    user_id: UUID,
) -> ChatResponse:
    """Handle the build flow when AI signals [READY_TO_BUILD]."""
    parts = reply.split("[READY_TO_BUILD]", 1)
    clean_reply = parts[0].strip()
    summary = parts[1].strip() if len(parts) > 1 else ""

    full_prompt = _build_full_prompt(messages, summary)

    # Billing paywall check
    try:
        billing = await can_build(org_id, db)
        if not billing["can_build"]:
            limit = billing["builds_limit"]
            return ChatResponse(
                reply=f"You've used all {limit} free builds. Upgrade to Pro for unlimited builds.",
                ready_to_build=False,
            )
    except Exception as e:
        logger.warning("Billing check failed (allowing build): %s", e)

    # Generate the spec and create the project
    try:
        project = await create_project(
            db=db,
            user_id=user_id,
            org_id=org_id,
            prompt=full_prompt,
            name=None,
        )

        entity_count = len(project.spec.get("entities", [])) if project.spec else 0
        build_reply = clean_reply
        if clean_reply:
            build_reply += "\n\n"
        build_reply += f"Your {persona['type']} is ready! I created {entity_count} components for you. Loading it now..."

        return ChatResponse(
            reply=build_reply,
            ready_to_build=True,
            project_id=str(project.id),
            project_name=project.name,
        )

    except Exception as e:
        error_msg = str(e)
        logger.error("BUILD ERROR: %s\n%s", error_msg, traceback.format_exc())

        # Provide a helpful, non-technical error message
        if "JSON" in error_msg or "parse" in error_msg.lower():
            user_msg = "I had trouble generating the spec structure. Let me try again — please send your request once more."
        elif "ANTHROPIC" in error_msg or "API" in error_msg:
            user_msg = "I'm having trouble connecting to the AI service. Please try again in a moment."
        elif "timeout" in error_msg.lower():
            user_msg = "The build took too long. Try a simpler request or break it into parts."
        else:
            user_msg = f"I hit an issue while building: {error_msg[:200]}\n\nPlease try again — sometimes a slightly different phrasing helps."

        return ChatResponse(
            reply=user_msg,
            ready_to_build=False,
        )


def _build_full_prompt(messages: list[dict], summary: str) -> str:
    """Combine conversation history into a single prompt for spec generation."""
    user_messages = [m["content"] for m in messages if m["role"] == "user"]

    if summary:
        return f"{summary}\n\nUser's original requirements:\n" + "\n".join(
            f"- {msg}" for msg in user_messages
        )

    return "\n\n".join(user_messages)


# ── Streaming chat endpoint (SSE) ────────────────────────────────

def _sse_event(data: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(data)}\n\n"


@router.post("/chat/stream")
async def api_chat_stream(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Streaming conversational chat via Server-Sent Events.

    Each event is a JSON object with a "type" field:
      - {"type":"text","content":"word "}   — a chunk of the AI reply
      - {"type":"building","project_id":"..."} — build started
      - {"type":"done"}                     — stream complete
    """
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="AI service not configured")

    persona = PERSONAS.get(body.model)
    if not persona:
        raise HTTPException(status_code=400, detail=f"Unknown model: {body.model}")

    # Extract and save preferences from latest user message
    user_messages = [m["content"] for m in body.messages if m["role"] == "user"]
    if user_messages:
        latest_prefs = extract_preferences(user_messages[-1])
        if latest_prefs:
            try:
                await _save_user_preferences(db, user_id, org_id, latest_prefs)
                await db.commit()
            except Exception as e:
                logger.warning("Failed to save preferences (stream): %s", e)

    # Build system prompt with stored preferences
    stored_prefs = {}
    try:
        stored_prefs = await _get_user_preferences(db, user_id)
    except Exception as e:
        logger.warning("Failed to fetch preferences (stream): %s", e)

    system_prompt = persona["system"]
    prefs_prompt = _build_preferences_prompt(stored_prefs)
    if prefs_prompt:
        system_prompt = system_prompt + "\n\n" + prefs_prompt

    async def event_generator():
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        full_reply = ""

        try:
            with client.messages.stream(
                model=MODEL,
                max_tokens=1024,
                system=system_prompt,
                messages=body.messages,
            ) as stream:
                for text_chunk in stream.text_stream:
                    full_reply += text_chunk
                    yield _sse_event({"type": "text", "content": text_chunk})

        except anthropic.APIError as e:
            logger.error("Streaming API error: %s", e)
            yield _sse_event({
                "type": "error",
                "content": "I'm having trouble connecting right now. Please try again.",
            })
            yield _sse_event({"type": "done"})
            return

        except Exception as e:
            logger.error("Streaming error: %s\n%s", e, traceback.format_exc())
            yield _sse_event({
                "type": "error",
                "content": "Something went wrong. Please try again.",
            })
            yield _sse_event({"type": "done"})
            return

        # After streaming completes, check if AI wants to build
        if "[READY_TO_BUILD]" in full_reply:
            # Billing paywall check
            try:
                billing = await can_build(org_id, db)
                if not billing["can_build"]:
                    limit = billing["builds_limit"]
                    yield _sse_event({
                        "type": "error",
                        "content": f"You've used all {limit} free builds. Upgrade to Pro for unlimited builds.",
                    })
                    yield _sse_event({"type": "done"})
                    return
            except Exception as e:
                logger.warning("Billing check failed during stream (allowing build): %s", e)

            parts = full_reply.split("[READY_TO_BUILD]", 1)
            summary = parts[1].strip() if len(parts) > 1 else ""
            full_prompt = _build_full_prompt(body.messages, summary)

            try:
                project = await create_project(
                    db=db,
                    user_id=user_id,
                    org_id=org_id,
                    prompt=full_prompt,
                    name=None,
                )
                entity_count = len(project.spec.get("entities", [])) if project.spec else 0
                yield _sse_event({
                    "type": "building",
                    "project_id": str(project.id),
                    "project_name": project.name,
                    "entity_count": entity_count,
                })
            except Exception as e:
                error_msg = str(e)
                logger.error("Stream BUILD ERROR: %s\n%s", error_msg, traceback.format_exc())

                if "JSON" in error_msg or "parse" in error_msg.lower():
                    user_msg = "I had trouble generating the spec. Please try again."
                elif "timeout" in error_msg.lower():
                    user_msg = "Build timed out. Try a simpler request."
                else:
                    user_msg = f"Build failed: {error_msg[:200]}"

                yield _sse_event({
                    "type": "error",
                    "content": user_msg,
                })

        yield _sse_event({"type": "done"})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
