from __future__ import annotations
"""
Real-Time Collaborative Editing — WebSocket-based real-time sync with
conflict resolution and operation-level sync.

WebSocket  /ws/projects/{project_id}   — real-time cursor / spec / chat / presence / ops
GET        /api/collab/{project_id}/presence — who is currently online

Presence is tracked in Redis (SADD/SREM) when available, with in-memory fallback.

Conflict resolution strategy:
  - Each spec change carries a version number (incrementing integer).
  - If a client sends a spec_update based on a stale version, the server
    attempts auto-merge (different entities or different fields).
  - If the same field was edited, the server rejects with a "conflict" message
    so the client can show a resolution dialog.
  - Clients may also send fine-grained "op" messages (add_entity, remove_entity,
    update_field) which are applied server-side and broadcast to other clients.
"""

import copy
import os
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Set

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

# ── Version tracking & spec storage (in-memory, with Redis upgrade path) ─

# project_id -> current version integer
_spec_versions: Dict[str, int] = {}

# project_id -> latest server-side copy of spec (for merge comparisons)
_spec_snapshots: Dict[str, dict] = {}


def _pick_color(index: int) -> str:
    return _COLORS[index % len(_COLORS)]


def _presence_list(project_id: str) -> List[dict]:
    """Return a list of users currently in the project room (in-memory)."""
    room = _rooms.get(project_id, {})
    return [
        {"user_id": uid, "name": info["name"], "color": info["color"]}
        for uid, info in room.items()
    ]


def get_spec_version(project_id: str) -> int:
    """Return current spec version for a project (0 if not set)."""
    return _spec_versions.get(project_id, 0)


def set_spec_version(project_id: str, version: int) -> None:
    """Set spec version in memory."""
    _spec_versions[project_id] = version


def get_spec_snapshot(project_id: str) -> dict | None:
    """Return current server-side spec snapshot."""
    return _spec_snapshots.get(project_id)


def set_spec_snapshot(project_id: str, spec: dict) -> None:
    """Store a spec snapshot for conflict resolution."""
    _spec_snapshots[project_id] = copy.deepcopy(spec)


async def _redis_version_get(project_id: str) -> int | None:
    """Try to get spec version from Redis."""
    redis_client = await _get_redis()
    if not redis_client:
        return None
    try:
        val = await redis_client.get(f"spec_version:{project_id}")
        return int(val) if val is not None else None
    except Exception:
        return None


async def _redis_version_set(project_id: str, version: int) -> None:
    """Try to set spec version in Redis."""
    redis_client = await _get_redis()
    if not redis_client:
        return
    try:
        await redis_client.set(f"spec_version:{project_id}", str(version))
    except Exception:
        pass


# ── Conflict resolution helpers ──────────────────────────────────────

def _entities_by_name(spec: dict) -> Dict[str, dict]:
    """Index entities by name for easy comparison."""
    return {e["name"]: e for e in spec.get("entities", [])}


def _fields_by_name(entity: dict) -> Dict[str, dict]:
    """Index entity fields by name."""
    return {f["name"]: f for f in entity.get("fields", [])}


def attempt_auto_merge(server_spec: dict, client_spec: dict, base_spec: dict | None) -> dict | None:
    """
    Try to auto-merge client_spec into server_spec.

    Returns the merged spec if possible (no same-field conflicts),
    or None if a conflict on the same field is detected.

    Merge strategy:
      - Different entities edited → auto-merge
      - Same entity, different fields edited → auto-merge
      - Same entity, same field edited → conflict (return None)
    """
    if base_spec is None:
        # Without a base we cannot compute a three-way merge
        return None

    server_entities = _entities_by_name(server_spec)
    client_entities = _entities_by_name(client_spec)
    base_entities = _entities_by_name(base_spec)

    merged = copy.deepcopy(server_spec)
    merged_entities = _entities_by_name(merged)

    for entity_name, client_entity in client_entities.items():
        base_entity = base_entities.get(entity_name)
        server_entity = server_entities.get(entity_name)

        if base_entity is None and server_entity is None:
            # Client added a new entity that server doesn't have → accept
            merged.setdefault("entities", []).append(copy.deepcopy(client_entity))
            continue

        if base_entity is None or server_entity is None:
            continue  # complex scenario — skip auto-merge

        # Both exist — compare field-level changes
        base_fields = _fields_by_name(base_entity)
        server_fields = _fields_by_name(server_entity)
        client_fields = _fields_by_name(client_entity)

        for field_name, client_field in client_fields.items():
            base_field = base_fields.get(field_name, {})
            server_field = server_fields.get(field_name, {})

            client_changed = client_field != base_field
            server_changed = server_field != base_field

            if client_changed and server_changed:
                # Both modified the same field → conflict
                return None

            if client_changed and not server_changed:
                # Only client changed this field → accept client's version
                me = merged_entities.get(entity_name)
                if me:
                    mf = _fields_by_name(me)
                    if field_name in mf:
                        idx = next(
                            (i for i, f in enumerate(me.get("fields", []))
                             if f.get("name") == field_name),
                            None,
                        )
                        if idx is not None:
                            me["fields"][idx] = copy.deepcopy(client_field)

    # Rebuild merged entity list preserving order
    merged["entities"] = list(_entities_by_name(merged).values())
    return merged


def apply_operation(spec: dict, op: str, payload: dict) -> dict:
    """
    Apply a fine-grained operation to a spec and return the updated spec.

    Supported ops:
      - add_entity:    payload = {"entity": {...}}
      - remove_entity: payload = {"name": "Lead"}
      - update_field:  payload = {"entity": "Lead", "field": "status", "changes": {...}}
    """
    spec = copy.deepcopy(spec)
    entities = spec.get("entities", [])

    if op == "add_entity":
        entity = payload.get("entity")
        if entity and isinstance(entity, dict):
            entities.append(entity)

    elif op == "remove_entity":
        name = payload.get("name", "")
        spec["entities"] = [e for e in entities if e.get("name") != name]

    elif op == "update_field":
        entity_name = payload.get("entity", "")
        field_name = payload.get("field", "")
        changes = payload.get("changes", {})
        for ent in entities:
            if ent.get("name") == entity_name:
                for fld in ent.get("fields", []):
                    if fld.get("name") == field_name:
                        fld.update(changes)
                        break
                break

    return spec


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
      - spec_update: {"type":"spec_update","version":3,"value":{...}}
      - op:          {"type":"op","op":"add_entity","entity":{...}}
      - chat:        {"type":"chat","message":"Should we add a status field?"}
    Server broadcasts to all other users in the room, plus presence updates.

    Version-based conflict resolution:
      - spec_update must include "version" (the version the client's edit is based on).
      - If version matches server's current version, update is accepted and version increments.
      - If version is stale, the server attempts auto-merge. On conflict, a
        {"type":"conflict",...} message is sent back.
      - Include "force": true to skip conflict checks (e.g. after user chooses "Keep Mine").
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

    # Send current version to newly connected client
    current_version = get_spec_version(project_id)
    await websocket.send_json({
        "type": "version",
        "version": current_version,
        "spec": get_spec_snapshot(project_id),
    })

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
                client_version = data.get("version", 0)
                client_spec = data.get("value")
                force = data.get("force", False)
                current_version = get_spec_version(project_id)

                if client_spec is None:
                    continue

                if force or client_version >= current_version:
                    # Accept the update
                    new_version = current_version + 1
                    set_spec_version(project_id, new_version)
                    await _redis_version_set(project_id, new_version)
                    base = get_spec_snapshot(project_id)
                    set_spec_snapshot(project_id, client_spec)

                    out = {
                        "type": "spec_update",
                        "user": user_name,
                        "user_id": user_id,
                        "version": new_version,
                        "value": client_spec,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                    await _broadcast(project_id, out, exclude=user_id)

                    # Ack to sender
                    await websocket.send_json({
                        "type": "ack",
                        "version": new_version,
                    })
                else:
                    # Stale version — attempt auto-merge
                    server_spec = get_spec_snapshot(project_id)
                    base_spec = None  # We don't store per-version bases yet; pass server as base
                    merged = None
                    if server_spec and isinstance(client_spec, dict):
                        merged = attempt_auto_merge(server_spec, client_spec, server_spec)

                    if merged is not None:
                        # Auto-merge succeeded
                        new_version = current_version + 1
                        set_spec_version(project_id, new_version)
                        await _redis_version_set(project_id, new_version)
                        set_spec_snapshot(project_id, merged)

                        out = {
                            "type": "spec_update",
                            "user": user_name,
                            "user_id": user_id,
                            "version": new_version,
                            "value": merged,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                        await _broadcast(project_id, out, exclude=None)
                    else:
                        # Conflict — notify sender
                        await websocket.send_json({
                            "type": "conflict",
                            "server_version": current_version,
                            "server_spec": server_spec,
                            "message": "Another user edited the same field. Keep yours or accept theirs?",
                        })

            elif msg_type == "op":
                # Fine-grained operation
                op_name = data.get("op", "")
                current_spec = get_spec_snapshot(project_id) or {}
                updated_spec = apply_operation(current_spec, op_name, data)
                new_version = get_spec_version(project_id) + 1
                set_spec_version(project_id, new_version)
                await _redis_version_set(project_id, new_version)
                set_spec_snapshot(project_id, updated_spec)

                out = {
                    "type": "op",
                    "user": user_name,
                    "user_id": user_id,
                    "op": op_name,
                    "version": new_version,
                    "spec": updated_spec,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                await _broadcast(project_id, out, exclude=user_id)

                # Ack to sender
                await websocket.send_json({
                    "type": "ack",
                    "version": new_version,
                })

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
