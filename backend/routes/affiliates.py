from __future__ import annotations

"""
Affiliate Program — apply, track conversions, request payouts.

Endpoints:
  POST /api/affiliates/apply        — apply to become an affiliate
  GET  /api/affiliates/dashboard    — stats (clicks, conversions, earnings)
  GET  /api/affiliates/conversions  — list conversions
  POST /api/affiliates/payout       — request payout (min $50)
"""

import secrets
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_id, get_current_org_id
from db import get_db
from models.affiliate import Affiliate, AffiliateConversion

router = APIRouter(prefix="/affiliates", tags=["affiliates"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class AffiliateApplyBody(BaseModel):
    stripe_connect_id: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _generate_affiliate_code() -> str:
    return "ISB-" + secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8].upper()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/apply")
async def apply_affiliate(
    body: AffiliateApplyBody = AffiliateApplyBody(),
    user_id: uuid.UUID = Depends(get_current_user_id),
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Apply to become an affiliate."""
    # Check if already applied
    result = await db.execute(
        select(Affiliate).where(Affiliate.user_id == user_id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Affiliate application already exists",
        )

    code = _generate_affiliate_code()
    # Ensure uniqueness
    for _ in range(5):
        dup = await db.execute(select(Affiliate).where(Affiliate.affiliate_code == code))
        if not dup.scalar_one_or_none():
            break
        code = _generate_affiliate_code()

    affiliate = Affiliate(
        user_id=user_id,
        org_id=org_id,
        affiliate_code=code,
        stripe_connect_id=body.stripe_connect_id,
    )
    db.add(affiliate)
    await db.commit()
    await db.refresh(affiliate)

    return {
        "id": str(affiliate.id),
        "affiliate_code": affiliate.affiliate_code,
        "commission_rate": affiliate.commission_rate,
        "is_approved": affiliate.is_approved,
        "created_at": affiliate.created_at.isoformat() if affiliate.created_at else None,
    }


@router.get("/dashboard")
async def affiliate_dashboard(
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Get affiliate dashboard stats."""
    result = await db.execute(
        select(Affiliate).where(Affiliate.user_id == user_id)
    )
    affiliate = result.scalar_one_or_none()
    if not affiliate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not an affiliate. Apply first.",
        )

    # Count conversions
    conv_count_result = await db.execute(
        select(func.count(AffiliateConversion.id)).where(
            AffiliateConversion.affiliate_id == affiliate.id
        )
    )
    total_conversions = conv_count_result.scalar() or 0

    # Pending earnings
    pending_result = await db.execute(
        select(func.coalesce(func.sum(AffiliateConversion.amount), 0)).where(
            AffiliateConversion.affiliate_id == affiliate.id,
            AffiliateConversion.status == "pending",
        )
    )
    pending_earnings = pending_result.scalar() or 0

    return {
        "affiliate_code": affiliate.affiliate_code,
        "commission_rate": affiliate.commission_rate,
        "is_approved": affiliate.is_approved,
        "total_earned": affiliate.total_earned,
        "total_paid": affiliate.total_paid,
        "pending_earnings": pending_earnings,
        "total_conversions": total_conversions,
    }


@router.get("/conversions")
async def list_conversions(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List affiliate conversions."""
    result = await db.execute(
        select(Affiliate).where(Affiliate.user_id == user_id)
    )
    affiliate = result.scalar_one_or_none()
    if not affiliate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not an affiliate. Apply first.",
        )

    base = select(AffiliateConversion).where(
        AffiliateConversion.affiliate_id == affiliate.id
    )

    count_result = await db.execute(
        select(func.count(AffiliateConversion.id)).where(
            AffiliateConversion.affiliate_id == affiliate.id
        )
    )
    total = count_result.scalar() or 0

    offset = (page - 1) * limit
    query = base.order_by(desc(AffiliateConversion.created_at)).offset(offset).limit(limit)
    rows = await db.execute(query)
    conversions = rows.scalars().all()

    return {
        "data": [
            {
                "id": str(c.id),
                "referred_user_id": str(c.referred_user_id),
                "subscription_id": str(c.subscription_id) if c.subscription_id else None,
                "amount": c.amount,
                "status": c.status,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in conversions
        ],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": max(1, (total + limit - 1) // limit),
        },
    }


@router.post("/payout")
async def request_payout(
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Request a payout. Minimum $50 (5000 cents)."""
    result = await db.execute(
        select(Affiliate).where(Affiliate.user_id == user_id)
    )
    affiliate = result.scalar_one_or_none()
    if not affiliate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not an affiliate. Apply first.",
        )

    if not affiliate.is_approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Affiliate account not yet approved",
        )

    # Calculate pending balance
    pending_result = await db.execute(
        select(func.coalesce(func.sum(AffiliateConversion.amount), 0)).where(
            AffiliateConversion.affiliate_id == affiliate.id,
            AffiliateConversion.status == "pending",
        )
    )
    pending_balance = pending_result.scalar() or 0

    if pending_balance < 5000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Minimum payout is $50. Current pending balance: ${pending_balance / 100:.2f}",
        )

    # Mark pending conversions as paid
    from sqlalchemy import update
    await db.execute(
        update(AffiliateConversion)
        .where(
            AffiliateConversion.affiliate_id == affiliate.id,
            AffiliateConversion.status == "pending",
        )
        .values(status="paid")
    )

    affiliate.total_paid += pending_balance
    await db.commit()
    await db.refresh(affiliate)

    return {
        "detail": "Payout requested successfully",
        "amount": pending_balance,
        "total_paid": affiliate.total_paid,
    }
