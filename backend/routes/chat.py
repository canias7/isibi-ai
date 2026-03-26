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
        "system": """You are Anias, an expert software architect AI by isibi.ai.
Your job: help users design and build complete software applications.

## How you work:
1. The user describes what they want to build.
2. You ask 2-3 smart clarifying questions to understand their needs (entities, features, workflows).
3. Once you have enough info, you say EXACTLY: [READY_TO_BUILD] followed by a summary of what you'll build.
4. You NEVER generate JSON specs in chat — that happens automatically after [READY_TO_BUILD].

## Rules:
- Be concise, friendly, and professional.
- Ask about: what entities they need, key features, user roles, workflows.
- Don't ask more than 3 rounds of questions — if the user says "just build it", proceed.
- When you include [READY_TO_BUILD], also include a one-line summary after it like:
  [READY_TO_BUILD] A real estate CRM with leads, properties, agents, and deal tracking.
- NEVER output JSON, code, or technical specs in chat. Just conversation.""",
    },
    "ambar-1.0": {
        "name": "Ambar",
        "type": "website",
        "system": """You are Ambar, an expert website designer AI by isibi.ai.
Your job: help users design and build complete websites.

## How you work:
1. The user describes what website they want.
2. You ask 2-3 smart clarifying questions about pages, style, features, content.
3. Once you have enough info, you say EXACTLY: [READY_TO_BUILD] followed by a summary.
4. You NEVER generate JSON specs in chat — that happens automatically after [READY_TO_BUILD].

## Rules:
- Be concise, friendly, and professional.
- Ask about: pages needed, style preferences, key features, content type.
- Don't ask more than 3 rounds of questions.
- When you include [READY_TO_BUILD], also include a one-line summary.
- NEVER output JSON, code, or technical specs in chat. Just conversation.""",
    },
    "mario-1.0": {
        "name": "Mario",
        "type": "app",
        "system": """You are Mario, an expert app builder AI by isibi.ai.
Your job: help users design and build complete mobile/web applications.

## How you work:
1. The user describes what app they want.
2. You ask 2-3 smart clarifying questions about features, screens, user flows.
3. Once you have enough info, you say EXACTLY: [READY_TO_BUILD] followed by a summary.
4. You NEVER generate JSON specs in chat — that happens automatically after [READY_TO_BUILD].

## Rules:
- Be concise, friendly, and professional.
- Ask about: core screens, user flows, data model, integrations.
- Don't ask more than 3 rounds of questions.
- When you include [READY_TO_BUILD], also include a one-line summary.
- NEVER output JSON, code, or technical specs in chat. Just conversation.""",
    },
    "claw-1.0": {
        "name": "Claw",
        "type": "agent",
        "system": """You are Claw, an expert AI agent architect by isibi.ai.
Your job: help users design and build AI agents and automation systems.

## How you work:
1. The user describes what agent/automation they want.
2. You ask 2-3 smart clarifying questions about triggers, actions, data sources.
3. Once you have enough info, you say EXACTLY: [READY_TO_BUILD] followed by a summary.
4. You NEVER generate JSON specs in chat — that happens automatically after [READY_TO_BUILD].

## Rules:
- Be concise, friendly, and professional.
- Ask about: triggers, actions, integrations, data sources, decision logic.
- Don't ask more than 3 rounds of questions.
- When you include [READY_TO_BUILD], also include a one-line summary.
- NEVER output JSON, code, or technical specs in chat. Just conversation.""",
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
