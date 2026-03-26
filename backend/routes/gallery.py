from __future__ import annotations

"""
Public App Gallery — browse, publish, and like community apps.
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.gallery_entry import GalleryEntry

router = APIRouter(prefix="/gallery", tags=["gallery"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class GalleryCreateBody(BaseModel):
    project_id: str
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    preview_image_url: Optional[str] = None
    demo_url: Optional[str] = None


class GalleryEntryOut(BaseModel):
    id: str
    project_id: str
    org_id: str
    title: str
    description: Optional[str]
    category: Optional[str]
    preview_image_url: Optional[str]
    demo_url: Optional[str]
    is_featured: bool
    likes: int
    is_published: bool
    published_at: Optional[str]
    created_at: str


def _serialize(entry: GalleryEntry) -> dict:
    return {
        "id": str(entry.id),
        "project_id": str(entry.project_id),
        "org_id": str(entry.org_id),
        "title": entry.title,
        "description": entry.description,
        "category": entry.category,
        "preview_image_url": entry.preview_image_url,
        "demo_url": entry.demo_url,
        "is_featured": entry.is_featured,
        "likes": entry.likes,
        "is_published": entry.is_published,
        "published_at": entry.published_at.isoformat() if entry.published_at else None,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("")
async def list_gallery(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort: str = Query("recent", regex="^(popular|recent)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List public gallery entries (no auth required)."""
    query = select(GalleryEntry).where(GalleryEntry.is_published.is_(True))

    if category:
        query = query.where(GalleryEntry.category == category)
    if search:
        term = f"%{search}%"
        query = query.where(
            or_(
                GalleryEntry.title.ilike(term),
                GalleryEntry.description.ilike(term),
            )
        )

    # Count
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Sort
    if sort == "popular":
        query = query.order_by(GalleryEntry.likes.desc())
    else:
        query = query.order_by(GalleryEntry.created_at.desc())

    # Paginate
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    entries = result.scalars().all()

    return {
        "items": [_serialize(e) for e in entries],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{entry_id}")
async def get_gallery_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single gallery entry detail."""
    result = await db.execute(
        select(GalleryEntry).where(GalleryEntry.id == uuid.UUID(entry_id))
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery entry not found")
    return _serialize(entry)


@router.post("", status_code=status.HTTP_201_CREATED)
async def publish_to_gallery(
    body: GalleryCreateBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Publish a project to the gallery."""
    entry = GalleryEntry(
        project_id=uuid.UUID(body.project_id),
        org_id=org_id,
        title=body.title,
        description=body.description,
        category=body.category,
        preview_image_url=body.preview_image_url,
        demo_url=body.demo_url,
        is_published=True,
        published_at=datetime.utcnow(),
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return _serialize(entry)


@router.delete("/{entry_id}", status_code=status.HTTP_200_OK)
async def unpublish_from_gallery(
    entry_id: str,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Unpublish (remove) a gallery entry."""
    result = await db.execute(
        select(GalleryEntry).where(
            GalleryEntry.id == uuid.UUID(entry_id),
            GalleryEntry.org_id == org_id,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery entry not found")

    await db.delete(entry)
    await db.commit()
    return {"detail": "Unpublished successfully"}


@router.post("/{entry_id}/like")
async def like_gallery_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Increment likes for a gallery entry."""
    result = await db.execute(
        select(GalleryEntry).where(GalleryEntry.id == uuid.UUID(entry_id))
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery entry not found")

    entry.likes = (entry.likes or 0) + 1
    await db.commit()
    await db.refresh(entry)
    return {"likes": entry.likes}
