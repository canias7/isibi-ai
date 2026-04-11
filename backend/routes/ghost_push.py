"""Push notifications for the main GoFarther AI app — Expo Push Service.

This module is separate from routes/push_notifications.py (which belongs
to the deployed-apps system for generated projects). This one is for
the GoFarther AI assistant itself: users register their device, and
the backend fans out notifications when scheduled tasks complete, when
urgent emails arrive, or when scheduled digests fire.

What this module owns:
  1. Device token storage (one row per device; a user with iPad + iPhone
     gets two rows).
  2. Register / unregister endpoints called by the client on launch /
     logout.
  3. Notification preferences (on/off for urgent email, plan-done,
     digest; quiet hours with IANA timezone).
  4. `send_push_to_user(user_id, title, body, data)` helper that fans
     out to every registered device for that user via Expo Push API,
     respects the user's preferences, logs failures, and deactivates
     dead tokens.

What this module does NOT own:
  - The email polling worker that detects urgent inbound email —
    that lives in worker/push_email_poller.py so the web dyno isn't
    slowed down by mailbox polling.
  - The scheduled task push integration — worker/scheduler.py imports
    send_push_to_user and calls it after each task completes.

Why Expo Push Service (exp.host) instead of raw APNs:
  - expo-notifications on the client hands us an ExpoPushToken
    directly. Zero APNs key wrangling on our side.
  - Expo handles token lifecycle (rotation, invalidation).
  - One HTTP call with a simple JSON payload; retries/backoff built
    into their service.
  - When we want to move off Expo's relay later, the same client
    code works with getDevicePushTokenAsync for direct APNs. No
    client change needed, just backend swap.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from sqlalchemy import Column, String, DateTime, Boolean, Integer, select, and_, text as sql_text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession

from db import Base, get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ghost/push", tags=["ghost-push"])


# ── Expo Push Service config ─────────────────────────────────────────────
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_PUSH_RECEIPT_URL = "https://exp.host/--/api/v2/push/getReceipts"
# Optional: if you enable enhanced security in the Expo dashboard, set
# this env var and the header will be attached. Otherwise Expo accepts
# unauthenticated push requests (signed against the project id embedded
# in the token).
EXPO_ACCESS_TOKEN = os.getenv("EXPO_ACCESS_TOKEN", "")


# ── Models ──────────────────────────────────────────────────────────────


class GhostDevicePushToken(Base):
    """One row per (user, device). A user with two phones has two rows.
    The device_token is the ExpoPushToken string returned by
    Notifications.getExpoPushTokenAsync() on the client."""
    __tablename__ = "ghost_device_push_tokens"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    device_token = Column(String(255), nullable=False, unique=True, index=True)
    platform = Column(String(20), nullable=True)            # "ios" or "android"
    device_name = Column(String(200), nullable=True)         # e.g. "Cristian's iPhone"
    app_version = Column(String(40), nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_seen_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    # Failure counter — if Expo returns DeviceNotRegistered we bump this
    # and when it crosses a threshold we stop sending.
    failures = Column(Integer, nullable=False, default=0)


class GhostNotificationPref(Base):
    """Per-user notification preferences. One row per user — the
    urgent/digest/quiet settings apply to every device they own."""
    __tablename__ = "ghost_notification_prefs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, unique=True, index=True)
    # Master toggle — when False we skip every push.
    enabled = Column(Boolean, nullable=False, default=True)
    # Push me when a plan finishes in the background.
    plan_done = Column(Boolean, nullable=False, default=True)
    # Push me when an "urgent" email arrives — sender is a saved
    # relationship contact (my boss/my mom/etc), subject has urgency
    # keywords, or the provider flagged it as important.
    urgent_email = Column(Boolean, nullable=False, default=True)
    # Push me a morning digest from the scheduled tasks worker.
    digest = Column(Boolean, nullable=False, default=True)
    # Don't push between these hours (stored as minutes-from-midnight
    # so we don't care about the DB's time type). For example 1320/420
    # = 22:00 to 07:00.
    quiet_start_min = Column(Integer, nullable=True)
    quiet_end_min = Column(Integer, nullable=True)
    # IANA tz name used to compute "now is in quiet hours" correctly
    # (e.g. "America/New_York"). Falls back to UTC if empty.
    timezone_name = Column(String(64), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ── Idempotent schema ensure (runs once per process) ───────────────────

_schema_checked = False


async def _ensure_schema(db: AsyncSession) -> None:
    """Make sure both tables exist. Uses CREATE TABLE IF NOT EXISTS so
    we don't need an alembic migration step in the Docker image build."""
    global _schema_checked
    if _schema_checked:
        return
    try:
        await db.execute(sql_text("""
            CREATE TABLE IF NOT EXISTS ghost_device_push_tokens (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                device_token VARCHAR(255) NOT NULL UNIQUE,
                platform VARCHAR(20),
                device_name VARCHAR(200),
                app_version VARCHAR(40),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_seen_at TIMESTAMPTZ DEFAULT NOW(),
                failures INTEGER NOT NULL DEFAULT 0
            )
        """))
        await db.execute(sql_text(
            "CREATE INDEX IF NOT EXISTS ix_ghost_device_push_tokens_user "
            "ON ghost_device_push_tokens (user_id)"
        ))
        await db.execute(sql_text("""
            CREATE TABLE IF NOT EXISTS ghost_notification_prefs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL UNIQUE,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                plan_done BOOLEAN NOT NULL DEFAULT TRUE,
                urgent_email BOOLEAN NOT NULL DEFAULT TRUE,
                digest BOOLEAN NOT NULL DEFAULT TRUE,
                quiet_start_min INTEGER,
                quiet_end_min INTEGER,
                timezone_name VARCHAR(64),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await db.commit()
        _schema_checked = True
        logger.info("ghost_push: tables ensured")
    except Exception as e:
        logger.warning(f"ghost_push: schema ensure failed: {e}")
        _schema_checked = True  # don't keep retrying a failing DDL


# ── Auth helper ────────────────────────────────────────────────────────


def _verify_auth(authorization: str) -> dict:
    from routes.ghost_auth import verify_ghost_token
    token = authorization.replace("Bearer ", "")
    return verify_ghost_token(token)


# ── Preferences helpers ────────────────────────────────────────────────

DEFAULT_PREFS = {
    "enabled": True,
    "plan_done": True,
    "urgent_email": True,
    "digest": True,
    "quiet_start_min": None,
    "quiet_end_min": None,
    "timezone_name": "UTC",
}


async def get_user_prefs(user_id, db: AsyncSession) -> dict:
    """Load preferences, returning defaults if the user has no row yet.
    Does NOT create the row — only POST /prefs persists changes."""
    await _ensure_schema(db)
    result = await db.execute(
        select(GhostNotificationPref).where(GhostNotificationPref.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    if row:
        return {
            "enabled": row.enabled,
            "plan_done": row.plan_done,
            "urgent_email": row.urgent_email,
            "digest": row.digest,
            "quiet_start_min": row.quiet_start_min,
            "quiet_end_min": row.quiet_end_min,
            "timezone_name": row.timezone_name or "UTC",
        }
    return dict(DEFAULT_PREFS)


def _in_quiet_hours(prefs: dict) -> bool:
    """Is 'now' inside the user's configured quiet-hours window?
    Returns False when quiet hours aren't configured."""
    start = prefs.get("quiet_start_min")
    end = prefs.get("quiet_end_min")
    if start is None or end is None:
        return False
    try:
        tz_name = prefs.get("timezone_name") or "UTC"
        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = timezone.utc
        now = datetime.now(tz)
        minute_of_day = now.hour * 60 + now.minute
        if start <= end:
            return start <= minute_of_day < end
        # Wraps midnight — e.g. 22:00 to 07:00
        return minute_of_day >= start or minute_of_day < end
    except Exception:
        return False


def _kind_allowed(prefs: dict, kind: str) -> bool:
    """Is this type of push enabled for the user?"""
    if not prefs.get("enabled", True):
        return False
    if kind == "plan_done":
        return bool(prefs.get("plan_done", True))
    if kind == "urgent_email":
        return bool(prefs.get("urgent_email", True))
    if kind == "digest":
        return bool(prefs.get("digest", True))
    # Unknown kinds default to allowed so new notification types don't
    # silently disappear until users update their preferences.
    return True


# ── Core: send a push to every device for a user ───────────────────────


async def send_push_to_user(
    user_id,
    db: AsyncSession,
    *,
    title: str,
    body: str,
    kind: str = "plan_done",
    data: dict | None = None,
    urgent: bool = False,
) -> dict:
    """Fan out a push notification to every active device for a user.

    Respects the user's preferences: if the master toggle is off, or
    the specific kind is muted, or we're in quiet hours (unless
    urgent=True), no push is sent and we return {sent: 0}.

    Returns {sent: int, failed: int, tokens_tried: int}.
    """
    await _ensure_schema(db)

    prefs = await get_user_prefs(user_id, db)
    if not _kind_allowed(prefs, kind):
        return {"sent": 0, "failed": 0, "tokens_tried": 0, "skipped": "muted"}
    if not urgent and _in_quiet_hours(prefs):
        return {"sent": 0, "failed": 0, "tokens_tried": 0, "skipped": "quiet_hours"}

    # Load active device tokens for this user
    result = await db.execute(
        select(GhostDevicePushToken).where(and_(
            GhostDevicePushToken.user_id == user_id,
            GhostDevicePushToken.active == True,  # noqa: E712
        ))
    )
    devices = result.scalars().all()
    if not devices:
        return {"sent": 0, "failed": 0, "tokens_tried": 0, "skipped": "no_devices"}

    # Expo Push Service accepts an array of up to 100 messages per call.
    # Each message has {to, title, body, sound, data, priority}. When
    # urgent=True we set priority=high so iOS treats it as time-sensitive.
    payload = []
    for d in devices:
        payload.append({
            "to": d.device_token,
            "title": title[:200],
            "body": body[:500],
            "sound": "default",
            "priority": "high" if urgent else "normal",
            "data": {"kind": kind, **(data or {})},
        })

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
    }
    if EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {EXPO_ACCESS_TOKEN}"

    sent = 0
    failed = 0
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(EXPO_PUSH_URL, json=payload, headers=headers)
            if r.status_code != 200:
                logger.warning(f"Expo push HTTP {r.status_code}: {r.text[:300]}")
                return {"sent": 0, "failed": len(payload), "tokens_tried": len(payload), "error": r.text[:200]}
            body_json = r.json()
            # Expo returns {data: [{status: 'ok', id: ...}, ...]}. When
            # a token is invalid (DeviceNotRegistered) we deactivate it
            # on the spot. Other errors count toward a failure threshold
            # that also triggers deactivation after 3 strikes.
            results = body_json.get("data", []) if isinstance(body_json, dict) else []
            for i, res in enumerate(results):
                if i >= len(devices):
                    break
                dev = devices[i]
                if isinstance(res, dict) and res.get("status") == "ok":
                    sent += 1
                    dev.failures = 0
                    dev.last_seen_at = datetime.now(timezone.utc)
                else:
                    failed += 1
                    err = (res.get("details") or {}).get("error") if isinstance(res, dict) else None
                    if err == "DeviceNotRegistered":
                        dev.active = False
                    else:
                        dev.failures = (dev.failures or 0) + 1
                        if dev.failures >= 3:
                            dev.active = False
            await db.commit()
    except Exception as e:
        logger.exception("Expo push call failed")
        return {"sent": 0, "failed": len(payload), "tokens_tried": len(payload), "error": str(e)}

    return {"sent": sent, "failed": failed, "tokens_tried": len(payload)}


# ── Endpoints ──────────────────────────────────────────────────────────


class RegisterDeviceRequest(BaseModel):
    device_token: str
    platform: Optional[str] = None
    device_name: Optional[str] = None
    app_version: Optional[str] = None


@router.post("/register-device")
async def register_device(
    body: RegisterDeviceRequest,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Client calls this on app launch after getting a fresh ExpoPushToken.
    Upserts the device row so the same physical device doesn't create
    duplicate entries if the token rotates. The token is globally unique
    per device, so we key on it."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    if not body.device_token:
        raise HTTPException(400, "device_token is required")

    await _ensure_schema(db)

    # Find any existing row for this token (regardless of user — tokens
    # are unique per device, so if the same device signs into two
    # accounts we move the row to the new user).
    result = await db.execute(
        select(GhostDevicePushToken).where(GhostDevicePushToken.device_token == body.device_token)
    )
    row = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row:
        row.user_id = user_id
        row.platform = body.platform or row.platform
        row.device_name = body.device_name or row.device_name
        row.app_version = body.app_version or row.app_version
        row.active = True
        row.failures = 0
        row.last_seen_at = now
    else:
        db.add(GhostDevicePushToken(
            user_id=user_id,
            device_token=body.device_token,
            platform=body.platform,
            device_name=body.device_name,
            app_version=body.app_version,
            active=True,
            created_at=now,
            last_seen_at=now,
        ))
    await db.commit()
    return {"status": "registered"}


@router.post("/unregister-device")
async def unregister_device(
    body: RegisterDeviceRequest,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Client calls this on logout so pushes stop going to this device.
    Marks the row inactive instead of deleting so we keep a historical
    record for debugging."""
    _verify_auth(authorization)
    if not body.device_token:
        raise HTTPException(400, "device_token is required")
    await _ensure_schema(db)
    result = await db.execute(
        select(GhostDevicePushToken).where(GhostDevicePushToken.device_token == body.device_token)
    )
    row = result.scalar_one_or_none()
    if row:
        row.active = False
        await db.commit()
    return {"status": "unregistered"}


class PrefsRequest(BaseModel):
    enabled: Optional[bool] = None
    plan_done: Optional[bool] = None
    urgent_email: Optional[bool] = None
    digest: Optional[bool] = None
    quiet_start_min: Optional[int] = None
    quiet_end_min: Optional[int] = None
    timezone_name: Optional[str] = None


@router.get("/prefs")
async def get_prefs_endpoint(
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Return the current user's notification preferences."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    return await get_user_prefs(user_id, db)


@router.post("/prefs")
async def update_prefs(
    body: PrefsRequest,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Partially update the current user's notification preferences.
    Any field omitted from the request is left unchanged."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    await _ensure_schema(db)
    result = await db.execute(
        select(GhostNotificationPref).where(GhostNotificationPref.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if not row:
        row = GhostNotificationPref(
            user_id=user_id,
            enabled=DEFAULT_PREFS["enabled"],
            plan_done=DEFAULT_PREFS["plan_done"],
            urgent_email=DEFAULT_PREFS["urgent_email"],
            digest=DEFAULT_PREFS["digest"],
            quiet_start_min=DEFAULT_PREFS["quiet_start_min"],
            quiet_end_min=DEFAULT_PREFS["quiet_end_min"],
            timezone_name=DEFAULT_PREFS["timezone_name"],
            updated_at=now,
        )
        db.add(row)
    for field in ("enabled", "plan_done", "urgent_email", "digest", "quiet_start_min", "quiet_end_min", "timezone_name"):
        v = getattr(body, field, None)
        if v is not None:
            setattr(row, field, v)
    row.updated_at = now
    await db.commit()
    return await get_user_prefs(user_id, db)


@router.post("/test")
async def test_push(
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Send a test notification to the current user's devices. Useful
    for debugging permission/registration flows from the Settings UI."""
    payload = _verify_auth(authorization)
    user_id = payload.get("sub")
    result = await send_push_to_user(
        user_id,
        db,
        title="GoFarther AI",
        body="Push notifications are working 🎉",
        kind="plan_done",
        data={"source": "test"},
    )
    return result
