from __future__ import annotations

"""
White-label configuration routes — manage org branding & custom domains.

Endpoints:
  GET    /api/whitelabel — get current whitelabel config
  PUT    /api/whitelabel — update whitelabel config
  DELETE /api/whitelabel — remove whitelabel config
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.whitelabel_config import WhitelabelConfig

router = APIRouter(prefix="/whitelabel", tags=["whitelabel"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------
class WhitelabelUpdate(BaseModel):
    brand_name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    custom_domain: Optional[str] = None
    hide_isibi_branding: Optional[bool] = None
    is_active: Optional[bool] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _serialize_config(config: WhitelabelConfig) -> dict:
    return {
        "id": str(config.id),
        "org_id": str(config.org_id),
        "brand_name": config.brand_name,
        "logo_url": config.logo_url,
        "primary_color": config.primary_color,
        "custom_domain": config.custom_domain,
        "hide_isibi_branding": config.hide_isibi_branding,
        "is_active": config.is_active,
        "created_at": config.created_at.isoformat() if config.created_at else None,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("")
async def get_whitelabel(
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get the current whitelabel config for this org."""
    result = await db.execute(
        select(WhitelabelConfig).where(WhitelabelConfig.org_id == org_id)
    )
    config = result.scalar_one_or_none()

    if not config:
        return {
            "configured": False,
            "config": None,
        }

    return {
        "configured": True,
        "config": _serialize_config(config),
    }


@router.put("")
async def update_whitelabel(
    body: WhitelabelUpdate,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Create or update the whitelabel config for this org."""
    result = await db.execute(
        select(WhitelabelConfig).where(WhitelabelConfig.org_id == org_id)
    )
    config = result.scalar_one_or_none()

    if config is None:
        # Create new config — brand_name is required for first creation
        if not body.brand_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="brand_name is required when creating a new whitelabel config.",
            )
        config = WhitelabelConfig(
            org_id=org_id,
            brand_name=body.brand_name,
            logo_url=body.logo_url,
            primary_color=body.primary_color or "#000000",
            custom_domain=body.custom_domain,
            hide_isibi_branding=body.hide_isibi_branding or False,
            is_active=body.is_active if body.is_active is not None else False,
        )
        db.add(config)
    else:
        # Update existing config — only set provided fields
        if body.brand_name is not None:
            config.brand_name = body.brand_name
        if body.logo_url is not None:
            config.logo_url = body.logo_url
        if body.primary_color is not None:
            config.primary_color = body.primary_color
        if body.custom_domain is not None:
            config.custom_domain = body.custom_domain
        if body.hide_isibi_branding is not None:
            config.hide_isibi_branding = body.hide_isibi_branding
        if body.is_active is not None:
            config.is_active = body.is_active

    await db.commit()
    await db.refresh(config)

    return _serialize_config(config)


@router.delete("", status_code=204)
async def delete_whitelabel(
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Remove the whitelabel config for this org."""
    result = await db.execute(
        select(WhitelabelConfig).where(WhitelabelConfig.org_id == org_id)
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No whitelabel config found for this org.",
        )

    await db.delete(config)
    await db.commit()
