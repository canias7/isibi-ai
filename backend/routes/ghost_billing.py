"""
Ghost (mobile) subscription / billing routes.

Endpoints (all under /api/ghost/billing):
  GET  /plans                  — public plan list
  GET  /current                — current user's plan + usage snapshot
  POST /checkout               — start Stripe checkout for a plan
  POST /portal                 — Stripe customer portal URL
  POST /webhook                — Stripe webhook (no auth, verified by signature)
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from models.ghost_subscription import GhostSubscription, PLAN_LIMITS, plan_for
from worker.ghost_rate_limit import get_usage_snapshot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ghost/billing", tags=["ghost-billing"])

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET_GHOST", "")


def _auth(authorization: str) -> dict:
    from routes.ghost_auth import verify_ghost_token
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    return verify_ghost_token(token)


async def _get_sub(email: str, db: AsyncSession) -> GhostSubscription:
    result = await db.execute(
        select(GhostSubscription).where(GhostSubscription.user_email == email)
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        sub = GhostSubscription(user_email=email, plan="free")
        db.add(sub)
        await db.flush()
    return sub


# ── Public plan list ─────────────────────────────────────────────────────

@router.get("/plans")
async def list_plans():
    """Return the plan structure for the mobile subscription screen."""
    # Never expose the internal 'owner' plan to the UI
    return {
        "plans": [
            {
                "id": key,
                "name": p["name"],
                "price_cents": p["price_cents"],
                "is_custom": p["price_cents"] is None,
            }
            for key, p in PLAN_LIMITS.items()
            if key != "owner"
        ]
    }


# ── Current user's plan + usage ─────────────────────────────────────────

@router.get("/current")
async def get_current_plan(
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Return the authenticated user's current plan + usage percentages.

    Raw message counts are intentionally NOT exposed — usage is reported as
    a 0-100 percentage because real consumption varies with message length.
    """
    payload = _auth(authorization)
    email = payload.get("email", "")
    snapshot = await get_usage_snapshot(email, db)
    await db.commit()

    def _pct(used: int, limit: int) -> int:
        if limit < 0:
            return 0  # unlimited
        if limit == 0:
            return 100
        return max(0, min(100, round((used / limit) * 100)))

    return {
        "plan": snapshot["plan"],
        "plan_name": snapshot["plan_name"],
        "status": snapshot["status"],
        "current_period_end": snapshot.get("current_period_end"),
        "cancel_at_period_end": snapshot.get("cancel_at_period_end", False),
        "used_pct_5h": _pct(snapshot["used_5h"], snapshot["per_5h"]),
        "used_pct_week": _pct(snapshot["used_week"], snapshot["per_week"]),
        "unlimited_5h": snapshot["per_5h"] < 0,
        "unlimited_week": snapshot["per_week"] < 0,
        "resets_in_seconds_5h": snapshot["resets_in_seconds_5h"],
        "resets_in_seconds_week": snapshot["resets_in_seconds_week"],
    }


# ── Stripe checkout session ─────────────────────────────────────────────

class CheckoutBody(BaseModel):
    plan: str = Field(..., description="'pro' | 'business' | 'max'")
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


@router.post("/checkout")
async def create_checkout(
    body: CheckoutBody,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Create a Stripe Checkout session for a paid plan."""
    payload = _auth(authorization)
    email = payload.get("email", "")

    if not STRIPE_SECRET_KEY:
        raise HTTPException(500, "Stripe not configured on server")

    plan_def = PLAN_LIMITS.get(body.plan)
    if not plan_def or plan_def["stripe_price_id_env"] is None:
        raise HTTPException(400, f"Plan '{body.plan}' is not purchasable")

    price_id = os.getenv(plan_def["stripe_price_id_env"], "")
    if not price_id:
        raise HTTPException(500, f"{plan_def['stripe_price_id_env']} env var not set")

    stripe.api_key = STRIPE_SECRET_KEY

    sub = await _get_sub(email, db)

    # Create or reuse Stripe customer
    customer_id = sub.stripe_customer_id
    if not customer_id:
        customer = stripe.Customer.create(email=email, metadata={"ghost_user": email})
        customer_id = customer.id
        sub.stripe_customer_id = customer_id
        await db.flush()

    success_url = body.success_url or "gofurtherai://billing/success"
    cancel_url = body.cancel_url or "gofurtherai://billing/cancel"

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"ghost_user": email, "plan": body.plan},
            subscription_data={"metadata": {"ghost_user": email, "plan": body.plan}},
        )
    except stripe.error.StripeError as e:
        logger.error("Stripe checkout failed for %s: %s", email, e)
        raise HTTPException(502, f"Stripe error: {e}")

    await db.commit()
    return {"checkout_url": session.url, "session_id": session.id}


# ── Stripe customer portal ───────────────────────────────────────────────

class PortalBody(BaseModel):
    return_url: Optional[str] = None


@router.post("/portal")
async def create_portal_session(
    body: PortalBody,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Create a Stripe billing portal session so the user can manage/cancel."""
    payload = _auth(authorization)
    email = payload.get("email", "")

    if not STRIPE_SECRET_KEY:
        raise HTTPException(500, "Stripe not configured on server")

    stripe.api_key = STRIPE_SECRET_KEY

    sub = await _get_sub(email, db)
    if not sub.stripe_customer_id:
        raise HTTPException(400, "No Stripe customer on file. Subscribe first.")

    try:
        session = stripe.billing_portal.Session.create(
            customer=sub.stripe_customer_id,
            return_url=body.return_url or "gofurtherai://billing/portal-return",
        )
    except stripe.error.StripeError as e:
        raise HTTPException(502, f"Stripe error: {e}")

    return {"portal_url": session.url}


# ── Stripe webhook ───────────────────────────────────────────────────────

@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Handle Stripe events: subscription created, updated, invoice paid, canceled."""
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(500, "STRIPE_WEBHOOK_SECRET_GHOST not configured")

    payload_bytes = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload_bytes, sig_header, STRIPE_WEBHOOK_SECRET
        )
    except Exception as e:
        logger.warning("Stripe webhook signature verification failed: %s", e)
        raise HTTPException(400, "Invalid signature")

    event_type = event["type"]
    obj = event["data"]["object"]

    # Extract ghost_user email from metadata
    metadata = obj.get("metadata") or {}
    email = metadata.get("ghost_user")

    # For subscription events the email may be on the parent subscription
    if not email and obj.get("subscription"):
        try:
            stripe.api_key = STRIPE_SECRET_KEY
            parent = stripe.Subscription.retrieve(obj["subscription"])
            email = (parent.metadata or {}).get("ghost_user")
        except Exception:
            email = None

    if not email:
        # Try customer lookup as a last resort
        customer_id = obj.get("customer")
        if customer_id:
            result = await db.execute(
                select(GhostSubscription).where(
                    GhostSubscription.stripe_customer_id == customer_id
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                email = existing.user_email

    if not email:
        logger.info("Stripe webhook %s had no ghost_user — ignored", event_type)
        return {"received": True, "handled": False}

    sub = await _get_sub(email, db)

    if event_type in ("customer.subscription.created", "customer.subscription.updated"):
        plan_key = metadata.get("plan") or sub.plan
        sub.plan = plan_key
        sub.stripe_subscription_id = obj.get("id")
        sub.status = obj.get("status", "active")
        sub.cancel_at_period_end = bool(obj.get("cancel_at_period_end"))
        cpe = obj.get("current_period_end")
        if cpe:
            from datetime import datetime, timezone
            sub.current_period_end = datetime.fromtimestamp(cpe, tz=timezone.utc)
        logger.info("Ghost sub %s → %s (%s)", email, sub.plan, sub.status)

    elif event_type == "customer.subscription.deleted":
        sub.plan = "free"
        sub.status = "canceled"
        sub.stripe_subscription_id = None
        sub.cancel_at_period_end = False
        logger.info("Ghost sub %s canceled → free", email)

    elif event_type == "invoice.paid":
        # Monthly renewal — reset the weekly + 5h windows so the user gets
        # a fresh cycle. They would reset naturally too, but this makes the
        # renewal feel instant.
        sub.window_5h_count = 0
        sub.window_week_count = 0
        logger.info("Ghost sub %s invoice paid — counters reset", email)

    elif event_type == "invoice.payment_failed":
        sub.status = "past_due"
        logger.warning("Ghost sub %s payment failed → past_due", email)

    await db.commit()
    return {"received": True, "handled": True, "event": event_type}
