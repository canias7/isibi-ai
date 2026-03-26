from __future__ import annotations

"""
Credit Packs — check balance and purchase additional build credits.

Endpoints:
  GET  /api/credits/balance   — current credit balance
  POST /api/credits/purchase  — buy a credit pack via Stripe
"""

import os
import uuid

import stripe
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.subscription import Subscription

router = APIRouter(prefix="/credits", tags=["credits"])

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")

CREDIT_PACKS = {
    "10": {"credits": 10, "price_cents": 500, "name": "10 Credits"},
    "50": {"credits": 50, "price_cents": 2000, "name": "50 Credits"},
    "100": {"credits": 100, "price_cents": 3500, "name": "100 Credits"},
}


# ── Schemas ───────────────────────────────────────────────────────────────────

class PurchaseBody(BaseModel):
    pack: str  # "10", "50", or "100"
    success_url: str = ""
    cancel_url: str = ""


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/balance")
async def get_credit_balance(
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Get the current credit balance for the org."""
    result = await db.execute(
        select(Subscription).where(Subscription.org_id == org_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return {"builds_used": 0, "builds_limit": 3, "remaining": 3}

    remaining = sub.builds_limit - sub.builds_used if sub.builds_limit >= 0 else -1  # -1 = unlimited
    return {
        "builds_used": sub.builds_used,
        "builds_limit": sub.builds_limit,
        "remaining": remaining,
        "plan": sub.plan,
    }


@router.post("/purchase")
async def purchase_credits(
    body: PurchaseBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a Stripe checkout session for a credit pack."""
    pack = CREDIT_PACKS.get(body.pack)
    if not pack:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid pack. Choose from: {', '.join(CREDIT_PACKS.keys())}",
        )

    # Get or create Stripe customer
    result = await db.execute(
        select(Subscription).where(Subscription.org_id == org_id)
    )
    sub = result.scalar_one_or_none()

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    success_url = body.success_url or f"{frontend_url}/app/credits?success=true"
    cancel_url = body.cancel_url or f"{frontend_url}/app/credits?canceled=true"

    try:
        checkout_params: dict = {
            "mode": "payment",
            "line_items": [
                {
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": pack["price_cents"],
                        "product_data": {
                            "name": pack["name"],
                            "description": f"{pack['credits']} build credits for isibi.ai",
                        },
                    },
                    "quantity": 1,
                },
            ],
            "success_url": success_url,
            "cancel_url": cancel_url,
            "metadata": {
                "org_id": str(org_id),
                "pack": body.pack,
                "credits": str(pack["credits"]),
                "type": "credit_pack",
            },
        }

        if sub and sub.stripe_customer_id:
            checkout_params["customer"] = sub.stripe_customer_id

        session = stripe.checkout.Session.create(**checkout_params)

        return {
            "checkout_url": session.url,
            "session_id": session.id,
        }
    except stripe.error.StripeError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Stripe error: {str(e)}",
        )
