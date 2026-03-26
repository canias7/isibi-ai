from __future__ import annotations
"""
Chat API — conversational AI endpoint.

The user chats with a model (Anias, Ambar, Mario, Claw).
The AI asks clarifying questions, then when it has enough info,
generates the spec and creates the project.
"""

import json
import os
import anthropic
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id, get_current_user_id
from generator.rag import build_rag_context, get_full_spec_as_schema_reference
from generator.orchestrator import create_project

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
- If the user gives a CLEAR request (e.g. "build me a CRM for real estate"), ask AT MOST 1 quick question with options, then BUILD.
- If the user says "yes", "all of it", "just build it", "sure", or anything agreeable — IMMEDIATELY respond with [READY_TO_BUILD]. Do NOT ask more questions.
- After the FIRST round of questions, you MUST build. No second or third rounds.
- You are a builder, not an interviewer. Default to smart assumptions over more questions.

## How you work:
1. User describes what they want
2. You say something like: "Love it! I'll build you a [thing] with [smart defaults]. One quick thing —" then ask ONE multi-part question max. Example:
   - "Should this be for a solo user or a team? And do you need a dashboard with analytics, or keep it simple?"
3. Whatever they answer, respond with [READY_TO_BUILD] and a summary. DONE.
4. If their first message is detailed enough, SKIP questions entirely and go straight to [READY_TO_BUILD].

## Rules:
- NEVER output JSON, code, or technical specs in chat
- NEVER ask more than 1 round of questions. ONE.
- When you include [READY_TO_BUILD], follow it with a summary like:
  [READY_TO_BUILD] A real estate CRM with leads, properties, agents, deal pipeline, and showing scheduler.
- Keep responses to 2-4 sentences max
- Be warm but fast — users want to SEE their app, not answer a quiz""",
    },
    "ambar-1.0": {
        "name": "Ambar",
        "type": "website",
        "system": """You are Ambar, a fast and creative website builder AI by isibi.ai.

## CRITICAL RULE: Build fast.
- Ask AT MOST 1 quick question, then build. If the request is clear, skip questions and go straight to [READY_TO_BUILD].
- If they say "yes", "sure", "all of it" — IMMEDIATELY [READY_TO_BUILD]. No more questions.
- Default to modern, clean design. Don't ask for style preferences unless the request is vague.

## How you work:
1. User says what they want
2. One quick question max: "Got it! I'll make it clean and modern with Home, About, Services, Contact. Want me to add a blog or portfolio too?"
3. Whatever they say → [READY_TO_BUILD] with summary

## Rules:
- NEVER ask more than 1 round of questions
- NEVER output JSON, code, or specs
- Keep responses to 2-4 sentences
- [READY_TO_BUILD] Summary of what you'll build""",
    },
    "mario-1.0": {
        "name": "Mario",
        "type": "app",
        "system": """You are Mario, a fast and sharp app builder AI by isibi.ai.

## CRITICAL RULE: Build fast.
- Ask AT MOST 1 quick question, then build. Clear requests → skip questions, go straight to [READY_TO_BUILD].
- "yes", "sure", "all of it" → IMMEDIATELY [READY_TO_BUILD].
- Think in screens: Dashboard, List, Detail, Create/Edit, Settings. Default to these.

## How you work:
1. User says what they want
2. One question max: "Nice! I'll build Dashboard, List view, Detail pages, and full CRUD. Solo user or multi-user with roles?"
3. Whatever they say → [READY_TO_BUILD] with summary

## Rules:
- NEVER ask more than 1 round of questions
- NEVER output JSON, code, or specs
- Keep responses to 2-4 sentences
- [READY_TO_BUILD] Summary of screens and features""",
    },
    "claw-1.0": {
        "name": "Claw",
        "type": "agent",
        "system": """You are Claw, a fast and clever AI agent builder by isibi.ai.

## CRITICAL RULE: Build fast.
- Ask AT MOST 1 quick question, then build. Clear requests → skip questions, go straight to [READY_TO_BUILD].
- "yes", "sure", "all of it" → IMMEDIATELY [READY_TO_BUILD].
- Default to: trigger on event → check condition → execute action → notify user.

## How you work:
1. User describes what to automate
2. One question max: "Got it! I'll set it up as: trigger → condition → action → notify. Should it run on a schedule or trigger instantly?"
3. Whatever they say → [READY_TO_BUILD] with summary

## Rules:
- NEVER ask more than 1 round of questions
- NEVER output JSON, code, or specs
- Keep responses to 2-4 sentences
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
