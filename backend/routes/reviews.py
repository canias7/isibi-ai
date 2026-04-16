from __future__ import annotations

"""
Review System — rate and review templates, plugins, components, and gallery apps.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id, get_current_user_id
from db import get_db
from models.review import Review

router = APIRouter(prefix="/reviews", tags=["reviews"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ReviewCreateBody(BaseModel):
    target_type: str  # "template"|"plugin"|"component"|"gallery"
    target_id: str
    rating: int = Field(..., ge=1, le=5)
    title: Optional[str] = None
    body: Optional[str] = None


class ReviewUpdateBody(BaseModel):
    rating: Optional[int] = Field(None, ge=1, le=5)
    title: Optional[str] = None
    body: Optional[str] = None


def _serialize(r: Review) -> dict:
    return {
        "id": str(r.id),
        "target_type": r.target_type,
        "target_id": str(r.target_id),
        "user_id": str(r.user_id),
        "org_id": str(r.org_id),
        "rating": r.rating,
        "title": r.title,
        "body": r.body,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_reviews(
    target_type: Optional[str] = Query(None),
    target_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List reviews with optional filtering."""
    query = select(Review)

    if target_type:
        query = query.where(Review.target_type == target_type)
    if target_id:
        query = query.where(Review.target_id == uuid.UUID(target_id))

    # Count
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.order_by(Review.created_at.desc())
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    reviews = result.scalars().all()

    return {
        "items": [_serialize(r) for r in reviews],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("", status_code=201)
async def create_review(
    body: ReviewCreateBody,
    user_id: uuid.UUID = Depends(get_current_user_id),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a review."""
    # Check for existing review by same user on same target
    existing = await db.execute(
        select(Review).where(
            Review.target_type == body.target_type,
            Review.target_id == uuid.UUID(body.target_id),
            Review.user_id == user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reviewed this item",
        )

    review = Review(
        target_type=body.target_type,
        target_id=uuid.UUID(body.target_id),
        user_id=user_id,
        org_id=org_id,
        rating=body.rating,
        title=body.title,
        body=body.body,
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)
    return _serialize(review)


@router.patch("/{review_id}")
async def update_review(
    review_id: str,
    body: ReviewUpdateBody,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Update a review (owner only)."""
    result = await db.execute(
        select(Review).where(Review.id == uuid.UUID(review_id))
    )
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    if review.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the author can update this review")

    if body.rating is not None:
        review.rating = body.rating
    if body.title is not None:
        review.title = body.title
    if body.body is not None:
        review.body = body.body

    await db.commit()
    await db.refresh(review)
    return _serialize(review)


@router.delete("/{review_id}")
async def delete_review(
    review_id: str,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a review (owner only)."""
    result = await db.execute(
        select(Review).where(Review.id == uuid.UUID(review_id))
    )
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    if review.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the author can delete this review")

    await db.delete(review)
    await db.commit()
    return {"detail": "Review deleted"}


@router.get("/summary/{target_type}/{target_id}")
async def get_review_summary(
    target_type: str,
    target_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get review summary with average rating, total, and distribution."""
    tid = uuid.UUID(target_id)

    # Average and total
    stats_q = select(
        func.avg(Review.rating).label("avg_rating"),
        func.count(Review.id).label("total"),
    ).where(
        Review.target_type == target_type,
        Review.target_id == tid,
    )
    stats_result = await db.execute(stats_q)
    stats = stats_result.one()

    # Distribution
    dist_q = select(
        Review.rating,
        func.count(Review.id).label("count"),
    ).where(
        Review.target_type == target_type,
        Review.target_id == tid,
    ).group_by(Review.rating)
    dist_result = await db.execute(dist_q)
    dist_rows = dist_result.all()

    distribution = {i: 0 for i in range(1, 6)}
    for row in dist_rows:
        distribution[row.rating] = row.count

    return {
        "average_rating": round(float(stats.avg_rating), 2) if stats.avg_rating else 0,
        "total_reviews": stats.total or 0,
        "distribution": distribution,
    }
