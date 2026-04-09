"""
Rolling-window rate limiter for ghost (mobile) users.

Uses two sliding windows per user stored directly on GhostSubscription:
  - 5-hour window: starts when the first message after a reset is sent
  - weekly window: 7 calendar days from first use

When a window expires (now - start > length), we reset start=now, count=0
on the next check. Hard-blocks via HTTPException(429) when the plan limit
is hit. Single source of truth for plan limits is PLAN_LIMITS in
models/ghost_subscription.py.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.ghost_subscription import GhostSubscription, plan_for

logger = logging.getLogger(__name__)

WINDOW_5H = timedelta(hours=5)
WINDOW_WEEK = timedelta(days=7)


def _owner_emails() -> set[str]:
    """Comma-separated list of emails that get the internal 'owner' plan (unlimited)."""
    raw = os.getenv("GHOST_OWNER_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


async def _get_or_create_sub(user_email: str, db: AsyncSession) -> GhostSubscription:
    result = await db.execute(
        select(GhostSubscription).where(GhostSubscription.user_email == user_email)
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        sub = GhostSubscription(user_email=user_email, plan="free")
        db.add(sub)
        await db.flush()
    # Auto-promote owner emails (idempotent)
    if user_email.lower() in _owner_emails() and sub.plan != "owner":
        sub.plan = "owner"
        sub.status = "active"
        await db.flush()
    return sub


def _maybe_reset_windows(sub: GhostSubscription, now: datetime) -> None:
    """Reset any window whose start is older than its length."""
    if sub.window_5h_start is None or (now - sub.window_5h_start) > WINDOW_5H:
        sub.window_5h_start = now
        sub.window_5h_count = 0
    if sub.window_week_start is None or (now - sub.window_week_start) > WINDOW_WEEK:
        sub.window_week_start = now
        sub.window_week_count = 0


def _seconds_until_reset(start: datetime, length: timedelta, now: datetime) -> int:
    remaining = (start + length) - now
    return max(0, int(remaining.total_seconds()))


async def check_and_consume_quota(
    user_email: str,
    db: AsyncSession,
    *,
    cost: int = 1,
    raise_on_block: bool = True,
) -> dict:
    """
    Check the user's rate limit and deduct `cost` from their window counters.

    Returns a dict with current usage. If blocked and raise_on_block=True,
    raises HTTPException(429) with a JSON body the mobile app can parse to
    show an upgrade CTA.

    Args:
        cost: Usually 1 per chat turn or scheduled task run.
    """
    now = datetime.now(timezone.utc)
    sub = await _get_or_create_sub(user_email, db)
    _maybe_reset_windows(sub, now)

    plan = plan_for(sub.plan)
    per_5h = plan["per_5h"]
    per_week = plan["per_week"]

    # -1 means unlimited
    blocked_5h = per_5h >= 0 and sub.window_5h_count + cost > per_5h
    blocked_week = per_week >= 0 and sub.window_week_count + cost > per_week

    if blocked_5h or blocked_week:
        if raise_on_block:
            detail = {
                "error": "rate_limit_exceeded",
                "plan": sub.plan,
                "plan_name": plan["name"],
                "blocked_on": "5h" if blocked_5h else "week",
                "per_5h": per_5h,
                "per_week": per_week,
                "used_5h": sub.window_5h_count,
                "used_week": sub.window_week_count,
                "resets_in_seconds": _seconds_until_reset(
                    sub.window_5h_start, WINDOW_5H, now
                ) if blocked_5h else _seconds_until_reset(
                    sub.window_week_start, WINDOW_WEEK, now
                ),
                "upgrade_hint": (
                    "You've hit your plan limit. Upgrade for more messages per window."
                    if sub.plan != "max"
                    else "You've hit the Max plan weekly cap. Contact us for Enterprise."
                ),
            }
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=detail,
            )
        return {"ok": False, "plan": sub.plan}

    # Deduct and persist
    sub.window_5h_count += cost
    sub.window_week_count += cost
    sub.updated_at = now
    await db.flush()

    return {
        "ok": True,
        "plan": sub.plan,
        "plan_name": plan["name"],
        "per_5h": per_5h,
        "per_week": per_week,
        "used_5h": sub.window_5h_count,
        "used_week": sub.window_week_count,
        "remaining_5h": max(0, per_5h - sub.window_5h_count) if per_5h >= 0 else -1,
        "remaining_week": max(0, per_week - sub.window_week_count) if per_week >= 0 else -1,
    }


async def get_usage_snapshot(user_email: str, db: AsyncSession) -> dict:
    """Return the user's current plan + usage without deducting anything."""
    now = datetime.now(timezone.utc)
    sub = await _get_or_create_sub(user_email, db)
    _maybe_reset_windows(sub, now)
    await db.flush()

    plan = plan_for(sub.plan)
    per_5h = plan["per_5h"]
    per_week = plan["per_week"]
    return {
        "plan": sub.plan,
        "plan_name": plan["name"],
        "status": sub.status,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        "cancel_at_period_end": sub.cancel_at_period_end,
        "per_5h": per_5h,
        "per_week": per_week,
        "used_5h": sub.window_5h_count,
        "used_week": sub.window_week_count,
        "remaining_5h": (max(0, per_5h - sub.window_5h_count) if per_5h >= 0 else -1),
        "remaining_week": (max(0, per_week - sub.window_week_count) if per_week >= 0 else -1),
        "resets_in_seconds_5h": (
            _seconds_until_reset(sub.window_5h_start, WINDOW_5H, now)
            if sub.window_5h_start else int(WINDOW_5H.total_seconds())
        ),
        "resets_in_seconds_week": (
            _seconds_until_reset(sub.window_week_start, WINDOW_WEEK, now)
            if sub.window_week_start else int(WINDOW_WEEK.total_seconds())
        ),
        "max_tasks": plan["max_tasks"],
    }


async def count_active_tasks(user_email: str, db: AsyncSession) -> int:
    """Count enabled scheduled tasks for the user (for task-quota check)."""
    from sqlalchemy import func
    from models.ghost_scheduled_task import GhostScheduledTask
    result = await db.execute(
        select(func.count(GhostScheduledTask.id)).where(
            GhostScheduledTask.user_email == user_email,
            GhostScheduledTask.enabled == True,  # noqa: E712
        )
    )
    return int(result.scalar() or 0)
