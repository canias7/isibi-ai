from __future__ import annotations

"""
User Preferences & AI Chat Memory API.

GET    /api/preferences                  — get current preferences + memory
PUT    /api/preferences                  — update preferences
POST   /api/preferences/memory           — add a memory item
DELETE /api/preferences/memory/{index}   — remove memory item by index
"""

from datetime import datetime, timezone
from typing import Optional

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_user_id, get_current_org_id
from models.user_preference import UserPreference

router = APIRouter(prefix="/preferences", tags=["Preferences"])


# ── Schemas ────────────────────────────────────────────────────────

class PreferencesRead(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    user_id: UUID
    org_id: UUID
    preferences: dict
    memory: list
    created_at: datetime
    updated_at: datetime


class PreferencesUpdate(BaseModel):
    preferences: Optional[dict] = None


class MemoryAdd(BaseModel):
    fact: str


class MemoryRemoveResponse(BaseModel):
    message: str
    memory: list


# ── Helpers ────────────────────────────────────────────────────────

async def _get_or_create_prefs(
    db: AsyncSession, user_id: UUID, org_id: UUID
) -> UserPreference:
    """Get existing preferences or create a new record."""
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == user_id)
    )
    pref = result.scalar_one_or_none()
    if pref is None:
        pref = UserPreference(user_id=user_id, org_id=org_id)
        db.add(pref)
        await db.flush()
    return pref


# ── Endpoints ──────────────────────────────────────────────────────

@router.get("", response_model=PreferencesRead)
async def get_preferences(
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
    org_id: UUID = Depends(get_current_org_id),
):
    """Get current user preferences and memory."""
    pref = await _get_or_create_prefs(db, user_id, org_id)
    await db.commit()
    return pref


@router.put("", response_model=PreferencesRead)
async def update_preferences(
    body: PreferencesUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
    org_id: UUID = Depends(get_current_org_id),
):
    """Update user preferences (merge with existing)."""
    pref = await _get_or_create_prefs(db, user_id, org_id)
    if body.preferences is not None:
        merged = {**(pref.preferences or {}), **body.preferences}
        pref.preferences = merged
    pref.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(pref)
    return pref


@router.post("/memory", response_model=PreferencesRead)
async def add_memory(
    body: MemoryAdd,
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
    org_id: UUID = Depends(get_current_org_id),
):
    """Add a memory item (remembered fact)."""
    pref = await _get_or_create_prefs(db, user_id, org_id)
    current_memory = list(pref.memory or [])
    current_memory.append(body.fact)
    pref.memory = current_memory
    pref.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(pref)
    return pref


@router.delete("/memory/{index}", response_model=MemoryRemoveResponse)
async def remove_memory(
    index: int,
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
    org_id: UUID = Depends(get_current_org_id),
):
    """Remove a memory item by index."""
    pref = await _get_or_create_prefs(db, user_id, org_id)
    current_memory = list(pref.memory or [])
    if index < 0 or index >= len(current_memory):
        raise HTTPException(status_code=404, detail="Memory index out of range")
    removed = current_memory.pop(index)
    pref.memory = current_memory
    pref.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(pref)
    return MemoryRemoveResponse(
        message=f"Removed memory: {removed}",
        memory=pref.memory,
    )
