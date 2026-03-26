from __future__ import annotations

"""
Referral System — generate codes, track invites, apply rewards.
"""

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_id
from db import get_db
from models.referral import Referral

router = APIRouter(prefix="/referrals", tags=["referrals"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ApplyCodeBody(BaseModel):
    code: str


# ── Helpers ──────────────────────────────────────────────────────────────────

def _generate_code() -> str:
    """Generate a short, URL-safe referral code."""
    return secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:10].upper()


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/code")
async def get_or_create_referral_code(
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Get the current user's referral code, creating one if it doesn't exist."""
    # Look for an existing referral row created by this user
    result = await db.execute(
        select(Referral).where(Referral.referrer_id == user_id).limit(1)
    )
    existing = result.scalar_one_or_none()

    if existing:
        return {"referral_code": existing.referral_code}

    # Generate a new unique code
    code = _generate_code()
    # Ensure uniqueness
    for _ in range(5):
        dup = await db.execute(select(Referral).where(Referral.referral_code == code))
        if not dup.scalar_one_or_none():
            break
        code = _generate_code()

    referral = Referral(
        referrer_id=user_id,
        referred_email="",  # placeholder until someone uses the code
        referral_code=code,
        status="pending",
    )
    db.add(referral)
    await db.commit()
    await db.refresh(referral)
    return {"referral_code": referral.referral_code}


@router.get("/stats")
async def get_referral_stats(
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Get referral statistics for the current user."""
    base = select(Referral).where(
        Referral.referrer_id == user_id,
        Referral.referred_email != "",
    )

    total_result = await db.execute(
        select(func.count()).select_from(base.subquery())
    )
    total_invited = total_result.scalar() or 0

    completed_result = await db.execute(
        select(func.count()).select_from(
            base.where(Referral.status.in_(["completed", "rewarded"])).subquery()
        )
    )
    total_completed = completed_result.scalar() or 0

    rewarded_result = await db.execute(
        select(func.coalesce(func.sum(Referral.reward_builds), 0)).where(
            Referral.referrer_id == user_id,
            Referral.status == "rewarded",
        )
    )
    rewards_earned = rewarded_result.scalar() or 0

    return {
        "total_invited": total_invited,
        "total_completed": total_completed,
        "rewards_earned": rewards_earned,
    }


@router.post("/apply")
async def apply_referral_code(
    body: ApplyCodeBody,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Apply a referral code during signup."""
    # Find the referral code
    result = await db.execute(
        select(Referral).where(Referral.referral_code == body.code.strip().upper())
    )
    referral = result.scalar_one_or_none()
    if not referral:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid referral code",
        )

    # Don't let users refer themselves
    if referral.referrer_id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot use your own referral code",
        )

    # Check if this user already applied a referral
    already = await db.execute(
        select(Referral).where(Referral.referred_user_id == user_id)
    )
    if already.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Referral code already applied",
        )

    # Create a new referral entry for this referred user
    new_ref = Referral(
        referrer_id=referral.referrer_id,
        referred_email="",
        referred_user_id=user_id,
        referral_code=referral.referral_code + "_" + secrets.token_hex(4),
        status="completed",
    )
    db.add(new_ref)
    await db.commit()

    return {"detail": "Referral code applied successfully", "reward_builds": new_ref.reward_builds}
