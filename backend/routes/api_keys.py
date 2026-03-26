from __future__ import annotations

"""
API Keys per App — generate, list, and revoke API keys for projects.
"""

import hashlib
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.api_key import ApiKey

router = APIRouter(tags=["api-keys"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ApiKeyCreateBody(BaseModel):
    name: str
    permissions: dict | None = None


def _serialize(key: ApiKey) -> dict:
    return {
        "id": str(key.id),
        "project_id": str(key.project_id),
        "org_id": str(key.org_id),
        "name": key.name,
        "key_prefix": key.key_prefix,
        "permissions": key.permissions or {},
        "last_used_at": key.last_used_at.isoformat() if key.last_used_at else None,
        "is_active": key.is_active,
        "created_at": key.created_at.isoformat() if key.created_at else None,
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _generate_raw_key() -> str:
    return "isibi_" + secrets.token_hex(24)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/api-keys")
async def list_api_keys(
    project_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """List API keys for a project (prefix only, not the full key)."""
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.project_id == uuid.UUID(project_id),
            ApiKey.org_id == org_id,
        ).order_by(ApiKey.created_at.desc())
    )
    keys = result.scalars().all()
    return {"items": [_serialize(k) for k in keys]}


@router.post("/projects/{project_id}/api-keys", status_code=status.HTTP_201_CREATED)
async def create_api_key(
    project_id: str,
    body: ApiKeyCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new API key. Returns the full key ONCE — it is not stored.
    Only the hash is persisted.
    """
    raw_key = _generate_raw_key()
    prefix = raw_key[:10]

    api_key = ApiKey(
        project_id=uuid.UUID(project_id),
        org_id=org_id,
        name=body.name,
        key_hash=_hash_key(raw_key),
        key_prefix=prefix,
        permissions=body.permissions or {},
        is_active=True,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    result = _serialize(api_key)
    result["key"] = raw_key  # Return full key only on creation
    return result


@router.delete("/projects/{project_id}/api-keys/{key_id}")
async def revoke_api_key(
    project_id: str,
    key_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Revoke (deactivate) an API key."""
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == uuid.UUID(key_id),
            ApiKey.project_id == uuid.UUID(project_id),
            ApiKey.org_id == org_id,
        )
    )
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")

    api_key.is_active = False
    await db.commit()
    return {"detail": "API key revoked"}
