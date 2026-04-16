from __future__ import annotations

"""
App 2FA (Two-Factor Authentication) — TOTP-based 2FA for deployed app users.

Endpoints:
  POST /api/apps/{project_id}/auth/2fa/setup     — generate TOTP secret + QR URI
  POST /api/apps/{project_id}/auth/2fa/verify     — verify code and enable 2FA
  POST /api/apps/{project_id}/auth/2fa/validate   — validate TOTP code during login
"""

import uuid
import hmac
import hashlib
import struct
import time
import base64
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.app_user import AppUser

router = APIRouter(prefix="/apps", tags=["App 2FA"])


# ── TOTP Implementation ─────────────────────────────────────────────────────

def _generate_secret(length: int = 20) -> str:
    """Generate a random base32-encoded secret."""
    random_bytes = secrets.token_bytes(length)
    return base64.b32encode(random_bytes).decode("utf-8").rstrip("=")


def _get_totp_uri(secret: str, email: str, issuer: str = "IsibiApp") -> str:
    """Build an otpauth:// URI for QR code generation."""
    return f"otpauth://totp/{issuer}:{email}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30"


def _compute_totp(secret: str, time_step: int = 30, digits: int = 6, offset: int = 0) -> str:
    """Compute the current TOTP code from a base32 secret."""
    # Pad the secret back to valid base32
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)

    counter = int(time.time()) // time_step + offset
    counter_bytes = struct.pack(">Q", counter)

    hmac_hash = hmac.new(key, counter_bytes, hashlib.sha1).digest()
    offset_val = hmac_hash[-1] & 0x0F
    code = struct.unpack(">I", hmac_hash[offset_val:offset_val + 4])[0]
    code = (code & 0x7FFFFFFF) % (10 ** digits)

    return str(code).zfill(digits)


def _verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """Verify a TOTP code, allowing a window of +/- steps."""
    for offset in range(-window, window + 1):
        if _compute_totp(secret, offset=offset) == code:
            return True
    return False


# ── Schemas ──────────────────────────────────────────────────────────────────

class Setup2FABody(BaseModel):
    app_user_id: str


class Verify2FABody(BaseModel):
    app_user_id: str
    code: str


class Validate2FABody(BaseModel):
    app_user_id: str
    code: str


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_app_user(db: AsyncSession, project_id: str, app_user_id: str) -> AppUser:
    result = await db.execute(
        select(AppUser).where(
            AppUser.id == uuid.UUID(app_user_id),
            AppUser.project_id == uuid.UUID(project_id),
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="App user not found")
    return user


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/{project_id}/auth/2fa/setup")
async def setup_2fa(
    project_id: str,
    body: Setup2FABody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Generate a TOTP secret and provisioning URI for an app user."""
    user = await _get_app_user(db, project_id, body.app_user_id)

    secret = _generate_secret()
    email = getattr(user, "email", None) or str(user.id)
    uri = _get_totp_uri(secret, email)

    # Store secret temporarily (not yet enabled until verified)
    if not hasattr(user, "totp_secret"):
        # Store in extra_data or a dedicated column
        extra = dict(getattr(user, "extra_data", None) or {})
        extra["_totp_secret_pending"] = secret
        user.extra_data = extra
    else:
        user.totp_secret = secret

    await db.commit()

    return {
        "secret": secret,
        "otpauth_uri": uri,
        "message": "Scan the QR code with your authenticator app, then verify with a code.",
    }


@router.post("/{project_id}/auth/2fa/verify")
async def verify_2fa(
    project_id: str,
    body: Verify2FABody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Verify a TOTP code and enable 2FA for the user."""
    user = await _get_app_user(db, project_id, body.app_user_id)

    # Get the pending secret
    secret = None
    if hasattr(user, "totp_secret") and user.totp_secret:
        secret = user.totp_secret
    else:
        extra = getattr(user, "extra_data", None) or {}
        secret = extra.get("_totp_secret_pending")

    if not secret:
        raise HTTPException(status_code=400, detail="No 2FA setup in progress. Call /2fa/setup first.")

    if not _verify_totp(secret, body.code):
        raise HTTPException(status_code=400, detail="Invalid verification code")

    # Enable 2FA
    if hasattr(user, "totp_secret"):
        user.totp_secret = secret
    if hasattr(user, "is_2fa_enabled"):
        user.is_2fa_enabled = True

    # Also store in extra_data for safety
    extra = dict(getattr(user, "extra_data", None) or {})
    extra["_totp_secret"] = secret
    extra["_2fa_enabled"] = True
    extra.pop("_totp_secret_pending", None)
    user.extra_data = extra

    await db.commit()

    return {"enabled": True, "message": "Two-factor authentication has been enabled."}


@router.post("/{project_id}/auth/2fa/validate")
async def validate_2fa(
    project_id: str,
    body: Validate2FABody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Validate a TOTP code during login."""
    user = await _get_app_user(db, project_id, body.app_user_id)

    # Get the active secret
    secret = None
    if hasattr(user, "totp_secret") and user.totp_secret:
        secret = user.totp_secret
    else:
        extra = getattr(user, "extra_data", None) or {}
        secret = extra.get("_totp_secret")

    if not secret:
        raise HTTPException(status_code=400, detail="2FA is not enabled for this user")

    if not _verify_totp(secret, body.code):
        raise HTTPException(status_code=401, detail="Invalid 2FA code")

    return {"valid": True, "message": "2FA code validated successfully."}
