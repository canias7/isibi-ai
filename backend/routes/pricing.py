from __future__ import annotations

"""
Pricing & Subscription routes — manage org billing via Stripe.

Endpoints:
  GET  /api/billing/plan      — get current plan info
  POST /api/billing/checkout   — create Stripe checkout for upgrade
  POST /api/billing/portal     — create Stripe billing portal session
  POST /api/billing/webhook    — Stripe webhook for subscription events
  GET  /api/billing/usage      — get builds used / limit
"""

import json
import os
import uuid
from datetime import datetime
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.subscription import Subscription

router = APIRouter(prefix="/billing", tags=["billing"])

# ---------------------------------------------------------------------------
# Stripe config
# ---------------------------------------------------------------------------
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

stripe.api_key = STRIPE_SECRET_KEY

# ---------------------------------------------------------------------------
# Plan definitions
# ---------------------------------------------------------------------------
PLANS = {
    "free": {
        "name": "Free",
        "price": 0,
        "builds_limit": 3,
        "projects_limit": 1,
        "features": ["3 builds/month", "1 project"],
    },
    "pro": {
        "name": "Pro",
        "price": 2500,  # $25 in cents
        "builds_limit": -1,  # unlimited
        "projects_limit": 10,
        "stripe_price_id": os.getenv("STRIPE_PRO_PRICE_ID", ""),
        "features": ["Unlimited builds", "10 projects", "Custom domains"],
    },
    "teams": {
        "name": "Teams",
        "price": 5000,  # $50 in cents
        "builds_limit": -1,  # unlimited
        "projects_limit": -1,  # unlimited
        "stripe_price_id": os.getenv("STRIPE_TEAMS_PRICE_ID", ""),
        "features": [
            "Unlimited builds",
            "Unlimited projects",
            "20 team members",
            "Priority support",
        ],
    },
}


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------
class CheckoutRequest(BaseModel):
    plan: str  # "pro" | "teams"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _get_or_create_subscription(
    db: AsyncSession, org_id: uuid.UUID
) -> Subscription:
    result = await db.execute(
        select(Subscription).where(Subscription.org_id == org_id)
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        sub = Subscription(org_id=org_id, plan="free", status="active")
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
    return sub


def _serialize_subscription(sub: Subscription, include_plan_details: bool = True) -> dict:
    data = {
        "id": str(sub.id),
        "org_id": str(sub.org_id),
        "plan": sub.plan,
        "status": sub.status,
        "builds_used": sub.builds_used,
        "builds_limit": sub.builds_limit,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
        "updated_at": sub.updated_at.isoformat() if sub.updated_at else None,
    }
    if include_plan_details and sub.plan in PLANS:
        data["plan_details"] = PLANS[sub.plan]
    return data


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("/plan")
async def get_plan(
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get the current plan info for this org."""
    sub = await _get_or_create_subscription(db, org_id)
    result = _serialize_subscription(sub)
    result["available_plans"] = PLANS
    return result


@router.post("/checkout")
async def create_checkout(
    body: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Create a Stripe Checkout Session to upgrade to a paid plan."""
    if body.plan not in ("pro", "teams"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid plan. Must be 'pro' or 'teams'.",
        )

    plan_config = PLANS[body.plan]
    price_id = plan_config.get("stripe_price_id")
    if not price_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stripe price ID not configured for plan '{body.plan}'.",
        )

    sub = await _get_or_create_subscription(db, org_id)

    # Create or reuse Stripe customer
    if not sub.stripe_customer_id:
        customer = stripe.Customer.create(
            metadata={"org_id": str(org_id)},
        )
        sub.stripe_customer_id = customer.id
        await db.commit()
        await db.refresh(sub)

    session = stripe.checkout.Session.create(
        customer=sub.stripe_customer_id,
        client_reference_id=str(org_id),
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{FRONTEND_URL}/app/settings/billing?success=true",
        cancel_url=f"{FRONTEND_URL}/app/settings/billing?canceled=true",
        metadata={"org_id": str(org_id), "plan": body.plan},
    )

    return {"checkout_url": session.url, "session_id": session.id}


@router.post("/portal")
async def create_portal(
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Create a Stripe Billing Portal session for managing the subscription."""
    sub = await _get_or_create_subscription(db, org_id)

    if not sub.stripe_customer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Stripe customer found. Please upgrade first.",
        )

    session = stripe.billing_portal.Session.create(
        customer=sub.stripe_customer_id,
        return_url=f"{FRONTEND_URL}/app/settings/billing",
    )

    return {"portal_url": session.url}


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Handle Stripe webhook events for subscription lifecycle."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if STRIPE_WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            )
        except (ValueError, stripe.error.SignatureVerificationError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid webhook signature",
            )
    else:
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid payload",
            )

    event_type = event.get("type") if isinstance(event, dict) else event.type
    data_obj = (
        event.get("data", {}).get("object", {})
        if isinstance(event, dict)
        else event.data.object
    )

    if event_type == "checkout.session.completed":
        org_id_str = (
            data_obj.get("metadata", {}).get("org_id")
            if isinstance(data_obj, dict)
            else data_obj.metadata.get("org_id")
        )
        # Fallback: use client_reference_id if metadata doesn't have org_id
        if not org_id_str:
            org_id_str = (
                data_obj.get("client_reference_id")
                if isinstance(data_obj, dict)
                else getattr(data_obj, "client_reference_id", None)
            )
        plan = (
            data_obj.get("metadata", {}).get("plan")
            if isinstance(data_obj, dict)
            else data_obj.metadata.get("plan")
        )
        stripe_subscription_id = (
            data_obj.get("subscription")
            if isinstance(data_obj, dict)
            else data_obj.subscription
        )
        stripe_customer_id = (
            data_obj.get("customer")
            if isinstance(data_obj, dict)
            else getattr(data_obj, "customer", None)
        )

        if org_id_str and plan:
            org_id = uuid.UUID(org_id_str)
            sub = await _get_or_create_subscription(db, org_id)
            sub.plan = plan
            sub.stripe_subscription_id = stripe_subscription_id
            if stripe_customer_id:
                sub.stripe_customer_id = stripe_customer_id
            sub.status = "active"
            plan_config = PLANS.get(plan, {})
            sub.builds_limit = plan_config.get("builds_limit", -1)
            sub.builds_used = 0
            await db.commit()

    elif event_type == "customer.subscription.updated":
        stripe_sub_id = (
            data_obj.get("id") if isinstance(data_obj, dict) else data_obj.id
        )
        status_val = (
            data_obj.get("status") if isinstance(data_obj, dict) else data_obj.status
        )
        current_period_end = (
            data_obj.get("current_period_end")
            if isinstance(data_obj, dict)
            else data_obj.current_period_end
        )

        result = await db.execute(
            select(Subscription).where(
                Subscription.stripe_subscription_id == stripe_sub_id
            )
        )
        sub = result.scalar_one_or_none()
        if sub:
            sub.status = status_val
            if current_period_end:
                sub.current_period_end = datetime.fromtimestamp(current_period_end)
            await db.commit()

    elif event_type == "customer.subscription.deleted":
        stripe_sub_id = (
            data_obj.get("id") if isinstance(data_obj, dict) else data_obj.id
        )
        result = await db.execute(
            select(Subscription).where(
                Subscription.stripe_subscription_id == stripe_sub_id
            )
        )
        sub = result.scalar_one_or_none()
        if sub:
            sub.plan = "free"
            sub.status = "canceled"
            sub.builds_limit = 3
            sub.builds_used = 0
            sub.stripe_subscription_id = None
            await db.commit()

    elif event_type == "invoice.payment_failed":
        stripe_sub_id = (
            data_obj.get("subscription")
            if isinstance(data_obj, dict)
            else getattr(data_obj, "subscription", None)
        )
        if stripe_sub_id:
            result = await db.execute(
                select(Subscription).where(
                    Subscription.stripe_subscription_id == stripe_sub_id
                )
            )
            sub = result.scalar_one_or_none()
            if sub:
                sub.status = "past_due"
                await db.commit()

    return {"status": "ok", "event_type": event_type}


@router.get("/usage")
async def get_usage(
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get builds used / limit for the current org."""
    sub = await _get_or_create_subscription(db, org_id)
    return {
        "plan": sub.plan,
        "builds_used": sub.builds_used,
        "builds_limit": sub.builds_limit,
        "is_unlimited": sub.builds_limit == -1,
        "builds_remaining": (
            None if sub.builds_limit == -1
            else max(0, sub.builds_limit - sub.builds_used)
        ),
    }
