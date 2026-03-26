from __future__ import annotations
"""
Chat API — conversational AI endpoint.

The user chats with a model (Anias, Ambar, Mario, Claw).
The AI asks clarifying questions, then when it has enough info,
generates the spec and creates the project.
"""

import asyncio
import json
import os
import traceback
import anthropic
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id, get_current_user_id
from generator.rag import build_rag_context, get_full_spec_as_schema_reference
from generator.orchestrator import create_project
from routes.billing_check import can_build

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
Love it! I'll build you a real estate CRM with leads, properties, and deals. Quick question:

**Who's using this?**
[OPTIONS]
- Solo agent — just me tracking my leads and deals
- Small team — 2-5 agents sharing a pipeline
- Full brokerage — roles, permissions, team management
- Not sure — surprise me with smart defaults
[/OPTIONS]

Rules for options:
- Always provide 3-4 options per question
- Each option: short label + dash + brief description
- Always include a "Not sure" or "Surprise me" option as the last choice
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
Love the idea! I'll design something clean and modern. What vibe fits your brand?

[OPTIONS]
- Minimal & airy — lots of whitespace, elegant (think Apple)
- Bold & colorful — vibrant, eye-catching (think Stripe)
- Professional & corporate — structured, trustworthy
- Just make it look great — surprise me
[/OPTIONS]

Rules: 3-4 options, short label + dash + description, always include a "surprise me" option.

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
I'm on it! I'll build a full app with Dashboard, Lists, and Detail pages. What type of app is this?

[OPTIONS]
- Personal tool — just for me, simple and fast
- Team app — multiple users with roles and permissions
- Customer-facing — end users sign up and use it
- All of the above — full-featured with everything
[/OPTIONS]

Rules: 3-4 options, short label + dash + description, always include an "all/everything" option.

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
I'll wire up your automation! Quick question — how should it trigger?

[OPTIONS]
- Real-time — fires instantly when something happens
- Scheduled — runs on a timer (hourly, daily, weekly)
- Manual — triggered by a button click or API call
- All of them — give me maximum flexibility
[/OPTIONS]

Rules: 3-4 options, short label + dash + description, always include an "all/everything" option.

## How you work:
1. User describes what to automate → short response + ONE [OPTIONS] question
2. Whatever they pick → [READY_TO_BUILD] with summary

## Rules:
- NEVER ask more than 1 round, NEVER output JSON/code
- [READY_TO_BUILD] Summary of triggers, conditions, actions""",
    },
}


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

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Call Claude for the conversation
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=persona["system"],
        messages=body.messages,
    )

    reply = response.content[0].text.strip()

    # Check if AI is ready to build
    if "[READY_TO_BUILD]" in reply:
        # Extract the summary after [READY_TO_BUILD]
        parts = reply.split("[READY_TO_BUILD]", 1)
        clean_reply = parts[0].strip()
        summary = parts[1].strip() if len(parts) > 1 else ""

        # Build the full prompt from conversation history
        full_prompt = _build_full_prompt(body.messages, summary)

        # ── Billing paywall check ──
        billing = await can_build(org_id, db)
        if not billing["can_build"]:
            limit = billing["builds_limit"]
            return ChatResponse(
                reply=f"You've used all {limit} free builds. Upgrade to Pro for unlimited builds.",
                ready_to_build=False,
            )

        # Generate the spec and create the project
        try:
            project = await create_project(
                db=db,
                user_id=user_id,
                org_id=org_id,
                prompt=full_prompt,
                name=None,
            )

            # Craft a nice response
            entity_count = len(project.spec.get("entities", [])) if project.spec else 0
            build_reply = clean_reply
            if clean_reply:
                build_reply += "\n\n"
            build_reply += f"✅ **Your {persona['type']} is ready!** I created {entity_count} components for you. Loading it now..."

            return ChatResponse(
                reply=build_reply,
                ready_to_build=True,
                project_id=str(project.id),
                project_name=project.name,
            )

        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            print(f"BUILD ERROR: {e}\n{tb}", flush=True)
            return ChatResponse(
                reply=f"I had everything planned out, but hit an error while building: {str(e)}\n\nPlease try again.",
                ready_to_build=False,
            )

    # Normal conversation — AI is still asking questions
    return ChatResponse(
        reply=reply,
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

    async def event_generator():
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        full_reply = ""

        try:
            with client.messages.stream(
                model=MODEL,
                max_tokens=1024,
                system=persona["system"],
                messages=body.messages,
            ) as stream:
                for text_chunk in stream.text_stream:
                    full_reply += text_chunk
                    yield _sse_event({"type": "text", "content": text_chunk})

        except Exception as e:
            yield _sse_event({"type": "error", "content": str(e)})
            yield _sse_event({"type": "done"})
            return

        # After streaming completes, check if AI wants to build
        if "[READY_TO_BUILD]" in full_reply:
            # ── Billing paywall check ──
            billing = await can_build(org_id, db)
            if not billing["can_build"]:
                limit = billing["builds_limit"]
                yield _sse_event({
                    "type": "error",
                    "content": f"You've used all {limit} free builds. Upgrade to Pro for unlimited builds.",
                })
                yield _sse_event({"type": "done"})
                return

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
                tb = traceback.format_exc()
                print(f"BUILD ERROR: {e}\n{tb}", flush=True)
                yield _sse_event({
                    "type": "error",
                    "content": f"Build failed: {str(e)}",
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
