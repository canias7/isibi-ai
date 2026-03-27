from __future__ import annotations
"""
Real-Time Collaborative Editing — WebSocket-based real-time sync.

WebSocket  /ws/projects/{project_id}   — real-time cursor / spec / chat / presence
GET        /api/collab/{project_id}/presence — who is currently online

Presence is tracked in Redis (SADD/SREM) when available, with in-memory fallback.
"""

import os
import json
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

_PRESENCE_TTL = 300  # 5 minutes


def _pick_color(index: int) -> str:
    return _COLORS[index % len(_COLORS)]


def _presence_list(project_id: str) -> List[dict]:
    """Return a list of users currently in the project room (in-memory)."""
    room = _rooms.get(project_id, {})
    return [
        {"user_id": uid, "name": info["name"], "color": info["color"]}
        for uid, info in room.items()
    ]


# ── Redis presence helpers ───────────────────────────────────────────

async def _get_redis():
    """Get Redis client, returns None if unavailable."""
    try:
        from utils.redis_client import get_redis
        return await get_redis()
    except Exception:
        return None


async def _redis_presence_add(project_id: str, user_id: str, name: str, color: str):
    """Add user to Redis presence set."""
    redis_client = await _get_redis()
    if not redis_client:
        return
    try:
        user_json = json.dumps({"user_id": user_id, "name": name, "color": color})
        key = f"presence:{project_id}"
        await redis_client.sadd(key, user_json)
        await redis_client.expire(key, _PRESENCE_TTL)
    except Exception as e:
        logger.debug("Redis presence add failed: %s", e)


async def _redis_presence_remove(project_id: str, user_id: str, name: str, color: str):
    """Remove user from Redis presence set."""
    redis_client = await _get_redis()
    if not redis_client:
        return
    try:
        user_json = json.dumps({"user_id": user_id, "name": name, "color": color})
        key = f"presence:{project_id}"
        await redis_client.srem(key, user_json)
    except Exception as e:
        logger.debug("Redis presence remove failed: %s", e)


async def _redis_presence_list(project_id: str) -> List[dict] | None:
    """Get presence list from Redis. Returns None if Redis unavailable."""
    redis_client = await _get_redis()
    if not redis_client:
        return None
    try:
        key = f"presence:{project_id}"
        members = await redis_client.smembers(key)
        return [json.loads(m) for m in members]
    except Exception as e:
        logger.debug("Redis presence list failed: %s", e)
        return None


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

    # Add to Redis presence
    await _redis_presence_add(project_id, user_id, user_name, color)

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

        # Remove from Redis presence
        await _redis_presence_remove(project_id, user_id, user_name, color)


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
    # Try Redis first for cross-instance presence
    redis_users = await _redis_presence_list(project_id)
    if redis_users is not None:
        return {
            "project_id": project_id,
            "users": redis_users,
            "count": len(redis_users),
        }

    # Fall back to in-memory
    users = _presence_list(project_id)
    return {
        "project_id": project_id,
        "users": users,
        "count": len(users),
    }
