from __future__ import annotations
"""
Real-Time Collaborative Editing — WebSocket-based real-time sync.

WebSocket  /ws/projects/{project_id}   — real-time cursor / spec / chat / presence
GET        /api/collab/{project_id}/presence — who is currently online
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, List, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query
from jose import JWTError, jwt

from auth import get_current_org_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/collab", tags=["Collaborative Editing"])

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

# ── In-memory connection tracking ───────────────────────────────────

# project_id -> { user_id: { "ws": WebSocket, "name": str, "color": str } }
_rooms: Dict[str, Dict[str, dict]] = {}

# Palette for assigning cursor colours to users
_COLORS = [
    "#ec4899", "#8b5cf6", "#3b82f6", "#10b981", "#f59e0b",
    "#ef4444", "#06b6d4", "#6366f1", "#14b8a6", "#f97316",
]


def _pick_color(index: int) -> str:
    return _COLORS[index % len(_COLORS)]


def _presence_list(project_id: str) -> List[dict]:
    """Return a list of users currently in the project room."""
    room = _rooms.get(project_id, {})
    return [
        {"user_id": uid, "name": info["name"], "color": info["color"]}
        for uid, info in room.items()
    ]


# ── WebSocket endpoint (mounted on app directly, not via /api) ──────

ws_router = APIRouter()


@ws_router.websocket("/ws/projects/{project_id}")
async def collab_ws(websocket: WebSocket, project_id: str, token: str = Query(default="")):
    """
    WebSocket connection for real-time collaborative editing.

    Connect with ?token=<jwt> query param.  Messages are JSON with a "type" field:
      - cursor:      {"type":"cursor","position":{"line":5,"char":12}}
      - spec_update: {"type":"spec_update","path":"entities[0].name","value":"Lead"}
      - chat:        {"type":"chat","message":"Should we add a status field?"}
    Server broadcasts to all other users in the room, plus presence updates.
    """
    # ── Authenticate via token query param ──
    if not token:
        await websocket.close(code=4001, reason="Missing token query param")
        return

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        user_name = payload.get("name", payload.get("email", "Anonymous"))
        if not user_id:
            await websocket.close(code=4001, reason="Invalid token: missing sub")
            return
    except JWTError:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    await websocket.accept()

    # ── Add user to the project room ──
    if project_id not in _rooms:
        _rooms[project_id] = {}

    color = _pick_color(len(_rooms[project_id]))
    _rooms[project_id][user_id] = {
        "ws": websocket,
        "name": user_name,
        "color": color,
    }

    # Broadcast updated presence to everyone in the room
    presence_msg = {
        "type": "presence",
        "users": _presence_list(project_id),
    }
    await _broadcast(project_id, presence_msg, exclude=None)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "cursor":
                out = {
                    "type": "cursor",
                    "user": user_name,
                    "user_id": user_id,
                    "color": color,
                    "position": data.get("position", {}),
                }
                await _broadcast(project_id, out, exclude=user_id)

            elif msg_type == "spec_update":
                out = {
                    "type": "spec_update",
                    "user": user_name,
                    "user_id": user_id,
                    "path": data.get("path", ""),
                    "value": data.get("value"),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                await _broadcast(project_id, out, exclude=user_id)

            elif msg_type == "chat":
                out = {
                    "type": "chat",
                    "user": user_name,
                    "user_id": user_id,
                    "message": data.get("message", ""),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                await _broadcast(project_id, out, exclude=None)

            else:
                # Unknown message type — echo back as-is with user info
                data["user"] = user_name
                data["user_id"] = user_id
                await _broadcast(project_id, data, exclude=user_id)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("WebSocket error for user %s in project %s: %s", user_id, project_id, exc)
    finally:
        # ── Remove user from room ──
        room = _rooms.get(project_id, {})
        room.pop(user_id, None)
        if not room:
            _rooms.pop(project_id, None)
        else:
            # Broadcast updated presence
            presence_msg = {
                "type": "presence",
                "users": _presence_list(project_id),
            }
            await _broadcast(project_id, presence_msg, exclude=None)


async def _broadcast(project_id: str, message: dict, exclude: str | None):
    """Send a JSON message to all users in a project room, optionally excluding one."""
    room = _rooms.get(project_id, {})
    dead: List[str] = []
    for uid, info in room.items():
        if exclude and uid == exclude:
            continue
        try:
            await info["ws"].send_json(message)
        except Exception:
            dead.append(uid)
    # Clean up dead connections
    for uid in dead:
        room.pop(uid, None)


# ── REST presence endpoint ──────────────────────────────────────────

@router.get("/{project_id}/presence")
async def get_presence(project_id: str, org_id: uuid.UUID = Depends(get_current_org_id)):
    """Return a list of users currently viewing/editing this project."""
    return {
        "project_id": project_id,
        "users": _presence_list(project_id),
        "count": len(_presence_list(project_id)),
    }
