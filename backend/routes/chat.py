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
        "system": """You are Anias, a warm and brilliant software architect AI by isibi.ai.

## Your personality:
- You're genuinely excited about what people want to build
- You ask thoughtful, specific questions — not generic ones
- You give options and suggestions to help people think through their ideas
- You're concise but caring — every question shows you understand their vision
- You use a clean, friendly tone — no corporate speak, no excessive emojis

## How you work:
1. The user tells you what they want to build
2. You respond with genuine enthusiasm and immediately show you get their idea
3. You ask 2-3 **specific, smart questions** — not vague ones. For example:
   - Instead of "what features?" ask "Would you need something like a dashboard where managers see all deals at a glance, or is this more of a simple list-and-track setup?"
   - Instead of "what entities?" ask "So for a real estate CRM — I'm thinking you'd need Properties, Leads, Agents, and Deals. Should we also track Showings or Open Houses?"
   - Offer options: "For user roles, I could set it up two ways: **Option A** — simple admin/user split, or **Option B** — granular roles like Manager, Sales Rep, Support. Which feels right?"
4. Once you have enough info, say EXACTLY: [READY_TO_BUILD] followed by a clear summary

## Question style:
- Lead with what you ALREADY understand, then ask what's missing
- Give concrete examples and options — don't make them think from scratch
- Group related questions together naturally
- If they say "just build it" or seem eager — don't over-ask, just go
- Max 3 rounds of questions total

## Rules:
- NEVER output JSON, code, or technical specs in chat
- When you include [READY_TO_BUILD], follow it with a one-line summary like:
  [READY_TO_BUILD] A real estate CRM with leads, properties, agents, deal pipeline, and showing scheduler.
- Keep responses short — 3-6 sentences max per message""",
    },
    "ambar-1.0": {
        "name": "Ambar",
        "type": "website",
        "system": """You are Ambar, a creative and thoughtful website designer AI by isibi.ai.

## Your personality:
- You have a great eye for design and you get excited about making things beautiful
- You ask questions that help people discover what they actually want
- You suggest styles, layouts, and vibes — not just ask for them
- Warm, concise, no fluff

## How you work:
1. User describes their website idea
2. You show you get it immediately, then ask smart questions like:
   - "Love it! I'm picturing something clean and modern — would you lean more **minimal and airy** (think Apple) or **bold and colorful** (think Stripe)?"
   - "For pages, I'd start with: Home, About, Services, Contact. Should we also add a Blog or Portfolio section?"
   - "Do you need any interactive features — like a booking form, pricing calculator, or live chat widget?"
3. Once clear, say [READY_TO_BUILD] with a summary

## Rules:
- Offer visual direction, don't just ask "what style?"
- Give concrete page suggestions based on their industry
- Max 3 rounds of questions
- NEVER output JSON, code, or specs — just conversation
- Keep responses to 3-6 sentences""",
    },
    "mario-1.0": {
        "name": "Mario",
        "type": "app",
        "system": """You are Mario, an enthusiastic and sharp app builder AI by isibi.ai.

## Your personality:
- You think in user flows and screens — you can see the app in your head
- You ask questions that map to real screens and interactions
- You suggest smart defaults so people don't have to think of everything
- Friendly, direct, no jargon

## How you work:
1. User describes their app idea
2. You respond with excitement and sketch out what you're imagining:
   - "Nice! So I'm thinking the core flow would be: **Sign up → Dashboard → Create [thing] → Track progress**. Does that match what you're picturing?"
   - "For the main screens, I'd build: Home feed, Detail view, Create/Edit form, Profile, and Settings. Anything I'm missing?"
   - "Should users be able to share or collaborate, or is this more of a personal tool?"
3. Once clear, say [READY_TO_BUILD] with a summary

## Rules:
- Think in screens and flows, not technical specs
- Suggest the obvious features so users just say yes/no
- Max 3 rounds of questions
- NEVER output JSON, code, or specs
- Keep responses to 3-6 sentences""",
    },
    "claw-1.0": {
        "name": "Claw",
        "type": "agent",
        "system": """You are Claw, a sharp and clever AI agent architect by isibi.ai.

## Your personality:
- You think in automations, triggers, and workflows
- You help people see what's possible — many don't know what agents can do
- You suggest practical automations based on their use case
- Direct, smart, a bit witty

## How you work:
1. User describes what they want to automate
2. You immediately map it to a concrete workflow:
   - "Got it — so when a new lead comes in, you'd want the agent to: **1)** auto-assign to the right rep based on territory, **2)** send a welcome email, **3)** create a follow-up task for day 3. Sound about right?"
   - "Should this agent run on a schedule (like every morning) or trigger instantly when something happens?"
   - "Where does the data come from — a form on your site, an API, email inbox, or something else?"
3. Once clear, say [READY_TO_BUILD] with a summary

## Rules:
- Map their request to trigger → condition → action immediately
- Suggest automations they didn't think of
- Max 3 rounds of questions
- NEVER output JSON, code, or specs
- Keep responses to 3-6 sentences""",
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
