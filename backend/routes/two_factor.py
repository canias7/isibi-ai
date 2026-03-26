from __future__ import annotations
"""
Two-Factor Authentication — TOTP setup, verification, and disable.

Routes:
  POST /api/auth/2fa/setup   — generate a TOTP secret and return otpauth URI
  POST /api/auth/2fa/verify  — verify a code to enable 2FA
  POST /api/auth/2fa/disable — disable 2FA (requires valid code)

Requires columns on the users table:
  - totp_secret   VARCHAR(255) NULL
  - is_2fa_enabled BOOLEAN DEFAULT false

Run this SQL to add them (if not already present):
  ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN DEFAULT false;
"""

import logging
from uuid import UUID

import pyotp
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/2fa", tags=["Two-Factor Auth"])

APP_NAME = "isibi.ai"


class CodeBody(BaseModel):
    code: str


# ── Helpers ──────────────────────────────────────────────────────────

async def _ensure_2fa_columns(db: AsyncSession) -> None:
    """Add TOTP columns to the users table if they don't exist yet."""
    await db.execute(text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255)"
    ))
    await db.execute(text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN DEFAULT false"
    ))
    await db.commit()


async def _get_user_2fa_info(db: AsyncSession, user_id: UUID) -> dict:
    """Fetch 2FA-related fields for a user."""
    result = await db.execute(
        text("SELECT id, email, totp_secret, is_2fa_enabled FROM users WHERE id = :uid"),
        {"uid": user_id},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return dict(row)


# ── SETUP ────────────────────────────────────────────────────────────

@router.post("/setup")
async def setup_2fa(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Generate a new TOTP secret. Returns the secret and an otpauth:// URI."""
    await _ensure_2fa_columns(db)
    user = await _get_user_2fa_info(db, user_id)

    if user.get("is_2fa_enabled"):
        raise HTTPException(status_code=400, detail="2FA is already enabled")

    # Generate a new secret
    secret = pyotp.random_base32()

    # Save the secret (not yet enabled)
    await db.execute(
        text("UPDATE users SET totp_secret = :secret WHERE id = :uid"),
        {"secret": secret, "uid": user_id},
    )
    await db.commit()

    # Build the otpauth URI
    totp = pyotp.TOTP(secret)
    qr_url = totp.provisioning_uri(name=user["email"], issuer_name=APP_NAME)

    return {"secret": secret, "qr_url": qr_url}


# ── VERIFY (enable 2FA) ─────────────────────────────────────────────

@router.post("/verify")
async def verify_2fa(
    body: CodeBody,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Verify a TOTP code to enable 2FA on the account."""
    await _ensure_2fa_columns(db)
    user = await _get_user_2fa_info(db, user_id)

    if user.get("is_2fa_enabled"):
        raise HTTPException(status_code=400, detail="2FA is already enabled")

    secret = user.get("totp_secret")
    if not secret:
        raise HTTPException(status_code=400, detail="Call /setup first to generate a secret")

    totp = pyotp.TOTP(secret)
    if not totp.verify(body.code):
        raise HTTPException(status_code=400, detail="Invalid code")

    # Enable 2FA
    await db.execute(
        text("UPDATE users SET is_2fa_enabled = true WHERE id = :uid"),
        {"uid": user_id},
    )
    await db.commit()

    return {"message": "2FA has been enabled"}


# ── DISABLE ──────────────────────────────────────────────────────────

@router.post("/disable")
async def disable_2fa(
    body: CodeBody,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Disable 2FA. Requires a valid TOTP code for verification."""
    await _ensure_2fa_columns(db)
    user = await _get_user_2fa_info(db, user_id)

    if not user.get("is_2fa_enabled"):
        raise HTTPException(status_code=400, detail="2FA is not enabled")

    secret = user.get("totp_secret")
    if not secret:
        raise HTTPException(status_code=400, detail="No TOTP secret found")

    totp = pyotp.TOTP(secret)
    if not totp.verify(body.code):
        raise HTTPException(status_code=400, detail="Invalid code")

    # Disable 2FA and clear secret
    await db.execute(
        text("UPDATE users SET is_2fa_enabled = false, totp_secret = NULL WHERE id = :uid"),
        {"uid": user_id},
    )
    await db.commit()

    return {"message": "2FA has been disabled"}
