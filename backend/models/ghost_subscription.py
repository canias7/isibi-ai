"""
Ghost (mobile) user subscriptions + rolling-window rate limits.

Separate from the org-keyed Subscription model used by the white-label
builder product. Each GhostSubscription row is one mobile user, keyed by
their email. Rate limits use sliding-window counters that reset when the
window expires — no event log, just two (start, count) pairs per user.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID

from db import Base


class GhostSubscription(Base):
    """One row per mobile user. Plan + Stripe state + rolling counters."""

    __tablename__ = "ghost_subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_email = Column(String, nullable=False, unique=True, index=True)

    # Plan: 'free' | 'pro' | 'business' | 'max' | 'enterprise'
    plan = Column(String(32), nullable=False, default="free", server_default=text("'free'"))

    # Stripe linkage
    stripe_customer_id = Column(String(255), nullable=True, index=True)
    stripe_subscription_id = Column(String(255), nullable=True, index=True)
    # Stripe status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete'
    status = Column(String(32), nullable=False, default="active", server_default=text("'active'"))
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end = Column(Boolean, nullable=False, default=False, server_default=text("false"))

    # ── Rolling window rate limit counters ─────────────────────────────
    # Each window has a (start, count) pair. When now - start > window_len,
    # we reset start=now, count=0 on the next check.

    window_5h_start = Column(DateTime(timezone=True), nullable=True)
    window_5h_count = Column(Integer, nullable=False, default=0, server_default=text("0"))

    window_week_start = Column(DateTime(timezone=True), nullable=True)
    window_week_count = Column(Integer, nullable=False, default=0, server_default=text("0"))

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.utcnow(),
        server_default=text("NOW()"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.utcnow(),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.utcnow(),
    )


# ── Plan definitions (single source of truth) ───────────────────────────

PLAN_LIMITS: dict[str, dict] = {
    "free": {
        "name": "Free",
        "price_cents": 0,
        "per_5h": 10,
        "per_week": 40,
        "max_tasks": 0,
        "stripe_price_id_env": None,
    },
    "pro": {
        "name": "Pro",
        "price_cents": 2000,
        "per_5h": 50,
        "per_week": 200,
        "max_tasks": 5,
        "stripe_price_id_env": "STRIPE_PRICE_PRO",
    },
    "business": {
        "name": "Business",
        "price_cents": 10000,
        "per_5h": 200,
        "per_week": 800,
        "max_tasks": 50,
        "stripe_price_id_env": "STRIPE_PRICE_BUSINESS",
    },
    "max": {
        "name": "Max",
        "price_cents": 20000,
        "per_5h": 500,
        "per_week": 2000,
        "max_tasks": -1,  # unlimited
        "stripe_price_id_env": "STRIPE_PRICE_MAX",
    },
    "enterprise": {
        "name": "Enterprise",
        "price_cents": None,  # custom
        "per_5h": -1,
        "per_week": -1,
        "max_tasks": -1,
        "stripe_price_id_env": None,
    },
}


def plan_for(key: str) -> dict:
    """Return plan definition, falling back to free if unknown."""
    return PLAN_LIMITS.get(key, PLAN_LIMITS["free"])
