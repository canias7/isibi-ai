"""
Microsoft Teams Bot Integration for GoFarther AI.
Route: POST /api/teams/messages
"""

from __future__ import annotations
import os
import io
import re
import sys
import json
import base64
import uuid
import traceback
from datetime import datetime, timedelta
from dataclasses import dataclass, field

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from botbuilder.core import (
    BotFrameworkAdapter,
    BotFrameworkAdapterSettings,
    TurnContext,
    ActivityHandler,
)
from botbuilder.schema import Activity, ActivityTypes, Attachment

from lib.claude_client import call_claude
from routes.ghost_ai import CLAUDE_TOOLS

router = APIRouter(prefix="/teams", tags=["teams-bot"])

# ─── Config ───────────────────────────────────────────────────────────────

TEAMS_APP_ID = os.getenv("TEAMS_APP_ID", "")
TEAMS_APP_PASSWORD = os.getenv("TEAMS_APP_PASSWORD", "")
TEAMS_TENANT_ID = os.getenv("TEAMS_TENANT_ID", "")

ADAPTER_SETTINGS = BotFrameworkAdapterSettings(
    app_id=TEAMS_APP_ID,
    app_password=TEAMS_APP_PASSWORD,
    channel_auth_tenant=TEAMS_TENANT_ID or None,
)
ADAPTER = BotFrameworkAdapter(ADAPTER_SETTINGS)

print(f"[TEAMS CONFIG] App ID set: {bool(TEAMS_APP_ID)}, Password set: {bool(TEAMS_APP_PASSWORD)}", flush=True)

# ─── Conversation State ──────────────────────────────────────────────────

SESSION_TTL_MINUTES = 30
TEAMS_TOOLS = [t for t in CLAUDE_TOOLS if t["name"] not in ("call", "sms", "maps", "remember")]

TEAMS_SYSTEM_PROMPT = """You are GoFarther AI, an assistant in Microsoft Teams. Be conversational, concise, helpful.
If someone says hey, just say hey back. Keep it short. Sound human. Use contractions.
For file creation, ask 2-3 quick questions first."""


@dataclass
class ConversationSession:
    messages: list = field(default_factory=list)
    last_activity: datetime = field(default_factory=datetime.utcnow)


_sessions: dict[str, ConversationSession] = {}


def _get_session(conversation_id: str, user_id: str) -> ConversationSession:
    key = f"{conversation_id}:{user_id}"
    now = datetime.utcnow()
    session = _sessions.get(key)
    if session and (now - session.last_activity) > timedelta(minutes=SESSION_TTL_MINUTES):
        session = None
    if not session:
        session = ConversationSession()
        _sessions[key] = session
    session.last_activity = now
    return session


# ─── Bot Handler ──────────────────────────────────────────────────────────

class GoFartherBot(ActivityHandler):
    async def on_message_activity(self, turn_context: TurnContext):
        text = turn_context.activity.text or ""
        print(f"[TEAMS BOT] on_message_activity: {text[:50]}", flush=True)

        # Strip @mention
        if turn_context.activity.entities:
            for entity in turn_context.activity.entities:
                if entity.type == "mention":
                    mentioned = getattr(entity, 'text', '') or entity.additional_properties.get("text", "")
                    text = text.replace(mentioned, "").strip()
        text = re.sub(r"<[^>]+>", "", text).strip()

        if not text:
            return

        conv_id = turn_context.activity.conversation.id if turn_context.activity.conversation else "unknown"
        user_id = turn_context.activity.from_property.id if turn_context.activity.from_property else "unknown"
        session = _get_session(conv_id, user_id)
        session.messages.append({"role": "user", "content": text})

        try:
            print("[TEAMS BOT] Calling Claude...", flush=True)
            response = await call_claude(
                messages=session.messages[-20:],
                system=TEAMS_SYSTEM_PROMPT,
                tools=TEAMS_TOOLS,
                max_tokens=4096,
            )

            response_text = response["text"]
            print(f"[TEAMS BOT] Claude: {response_text[:80]}", flush=True)

            # Send text reply
            print("[TEAMS BOT] Sending reply...", flush=True)
            await turn_context.send_activity(response_text or "I'm not sure what to say.")
            print("[TEAMS BOT] Reply sent!", flush=True)

            session.messages.append({"role": "assistant", "content": response_text})

        except Exception as e:
            print(f"[TEAMS BOT ERROR] {e}", flush=True)
            traceback.print_exc()
            sys.stdout.flush()
            try:
                await turn_context.send_activity("Sorry, something went wrong. Please try again.")
            except Exception:
                pass


BOT = GoFartherBot()


# ─── FastAPI Route ────────────────────────────────────────────────────────

@router.post("/messages")
async def teams_messages(request: Request):
    """Receive messages from Microsoft Teams."""
    body = await request.json()
    auth_header = request.headers.get("Authorization", "")
    activity_type = body.get("type", "")

    print(f"[TEAMS] Activity={activity_type} text={body.get('text', '')[:50]}", flush=True)

    activity = Activity().deserialize(body)

    async def _callback(turn_context: TurnContext):
        await BOT.on_turn(turn_context)

    try:
        await ADAPTER.process_activity(activity, auth_header, _callback)
    except Exception as e:
        print(f"[TEAMS ERROR] {e}", flush=True)
        traceback.print_exc()
        sys.stdout.flush()

    return JSONResponse(content={}, status_code=200)
