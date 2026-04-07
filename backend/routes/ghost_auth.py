"""
Ghost Mode Auth — standalone authentication for the desktop app.
Separate from the main isibi.ai auth system.

Routes:
  POST /api/ghost/signup       — create account, send verification code
  POST /api/ghost/verify       — verify email with 6-digit code
  POST /api/ghost/login        — login and get JWT
  POST /api/ghost/forgot       — send password reset code
  POST /api/ghost/reset        — reset password with code
  GET  /api/ghost/me           — get current user info
  POST /api/ghost/credits      — add credits after Stripe payment
"""

from __future__ import annotations
import os
import uuid
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt
from fastapi import APIRouter, HTTPException, status, Depends, Header
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from sqlalchemy import select, Column, String, Integer, Boolean, DateTime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import UUID

from db import get_db, Base
from services.email import send_verification_email, send_password_reset_email
import time
import hashlib

# ── Ghost User Model ──────────────────────────────────────────────────

class GhostUser(Base):
    __tablename__ = "ghost_users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    credits = Column(Integer, default=1000)
    plan = Column(String, default="free")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    is_active = Column(Boolean, default=True)
    email_verified = Column(Boolean, default=False)
    verification_code = Column(String, nullable=True)
    verification_expires = Column(DateTime(timezone=True), nullable=True)
    reset_code = Column(String, nullable=True)
    reset_expires = Column(DateTime(timezone=True), nullable=True)
    # SMTP settings for sending emails from user's own address
    smtp_host = Column(String, nullable=True)
    smtp_port = Column(Integer, nullable=True)
    smtp_user = Column(String, nullable=True)
    smtp_pass = Column(String, nullable=True)
    smtp_from = Column(String, nullable=True)  # "From Name"

# ── Login Logs & Trusted Devices ──────────────────────────────────────

class GhostLoginLog(Base):
    __tablename__ = "ghost_login_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_email = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=True)
    device_id = Column(String, nullable=True)
    success = Column(Boolean, default=False)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class GhostTrustedDevice(Base):
    __tablename__ = "ghost_trusted_devices"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_email = Column(String, nullable=False, index=True)
    device_id = Column(String, nullable=False)
    device_name = Column(String, nullable=True)
    trusted_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

# ── Login Attempt Lockout ─────────────────────────────────────────────

MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
_login_attempts: dict[str, list[float]] = {}

def _check_lockout(email: str) -> bool:
    attempts = _login_attempts.get(email, [])
    cutoff = time.time() - (LOCKOUT_MINUTES * 60)
    recent = [t for t in attempts if t > cutoff]
    _login_attempts[email] = recent
    return len(recent) >= MAX_LOGIN_ATTEMPTS

def _record_failed_login(email: str):
    if email not in _login_attempts:
        _login_attempts[email] = []
    _login_attempts[email].append(time.time())

def _clear_login_attempts(email: str):
    _login_attempts.pop(email, None)

def _get_device_id(hostname: str, username: str) -> str:
    return hashlib.sha256(f"{hostname}:{username}".encode()).hexdigest()[:16]

# ── Schemas ───────────────────────────────────────────────────────────

class GhostSignupRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=6, max_length=128)

class GhostSocialLoginRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    provider: str  # 'apple' or 'google'
    social_token: str

class GhostVerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)

class GhostLoginRequest(BaseModel):
    email: EmailStr
    password: str
    device_id: str = ""
    device_name: str = ""
    trust_device: bool = False

class GhostForgotRequest(BaseModel):
    email: EmailStr

class GhostResetRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)
    new_password: str = Field(min_length=6, max_length=128)

class GhostTokenResponse(BaseModel):
    token: str
    email: str
    name: str
    credits: int
    plan: str

class GhostAddCreditsRequest(BaseModel):
    credits: int
    plan: str = "starter"

# ── Helpers ───────────────────────────────────────────────────────────

def generate_code() -> str:
    return "".join([str(secrets.randbelow(10)) for _ in range(6)])

# ── JWT Config ────────────────────────────────────────────────────────

GHOST_JWT_SECRET = os.getenv("JWT_SECRET", "ghost-mode-secret-key")
GHOST_JWT_ALGORITHM = "HS256"
GHOST_JWT_EXPIRE_HOURS = 720  # 30 days

def create_ghost_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": "ghost",
        "exp": datetime.now(timezone.utc) + timedelta(hours=GHOST_JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, GHOST_JWT_SECRET, algorithm=GHOST_JWT_ALGORITHM)

def verify_ghost_token(token: str) -> dict:
    try:
        return jwt.decode(token, GHOST_JWT_SECRET, algorithms=[GHOST_JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

# ── Router ────────────────────────────────────────────────────────────

router = APIRouter(prefix="/ghost", tags=["Ghost Mode Auth"])

@router.post("/signup", response_model=GhostTokenResponse)
async def ghost_signup(body: GhostSignupRequest, db: AsyncSession = Depends(get_db)):
    # Check if email exists
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Create user — auto-verified for now (no email verification required)
    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user = GhostUser(
        email=body.email, name=body.name, password_hash=hashed,
        email_verified=True,  # Auto-verify
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_ghost_token(str(user.id), user.email)
    return GhostTokenResponse(token=token, email=user.email, name=user.name, credits=user.credits, plan=user.plan)

@router.post("/verify", response_model=GhostTokenResponse)
async def ghost_verify(body: GhostVerifyRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    if user.email_verified:
        raise HTTPException(status_code=400, detail="Email already verified")
    if not user.verification_code or user.verification_code != body.code:
        raise HTTPException(status_code=400, detail="Invalid verification code")
    if user.verification_expires and user.verification_expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Verification code expired")

    user.email_verified = True
    user.verification_code = None
    user.verification_expires = None
    await db.commit()

    token = create_ghost_token(str(user.id), user.email)
    return GhostTokenResponse(token=token, email=user.email, name=user.name, credits=user.credits, plan=user.plan)

@router.post("/social-login", response_model=GhostTokenResponse)
async def ghost_social_login(body: GhostSocialLoginRequest, db: AsyncSession = Depends(get_db)):
    """Login or signup via Apple/Google. Creates account if doesn't exist."""
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()

    if not user:
        # Auto-create account for social login (no password needed)
        random_pw = secrets.token_hex(16)
        hashed = bcrypt.hashpw(random_pw.encode(), bcrypt.gensalt()).decode()
        user = GhostUser(
            email=body.email, name=body.name, password_hash=hashed,
            email_verified=True,  # Social login = verified
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    token = create_ghost_token(str(user.id), user.email)
    return GhostTokenResponse(token=token, email=user.email, name=user.name, credits=user.credits, plan=user.plan)

@router.post("/resend")
async def ghost_resend(body: GhostForgotRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")

    code = generate_code()
    user.verification_code = code
    user.verification_expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    await db.commit()
    await send_verification_email(body.email, code)
    return {"message": "New code sent"}

@router.post("/login", response_model=GhostTokenResponse)
async def ghost_login(body: GhostLoginRequest, request=None, db: AsyncSession = Depends(get_db)):
    # Get IP address
    ip = "unknown"
    try:
        from fastapi import Request
        # IP will be passed via header in production
    except:
        pass

    # Check lockout
    if _check_lockout(body.email):
        remaining = LOCKOUT_MINUTES - int((time.time() - min(_login_attempts.get(body.email, [time.time()]))) / 60)
        raise HTTPException(status_code=429, detail=f"Account locked. Too many failed attempts. Try again in {remaining} minutes.")

    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        _record_failed_login(body.email)
        # Log failed attempt
        db.add(GhostLoginLog(user_email=body.email, ip_address=ip, device_id=body.device_id, success=False))
        await db.commit()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not bcrypt.checkpw(body.password.encode(), user.password_hash.encode()):
        _record_failed_login(body.email)
        db.add(GhostLoginLog(user_email=body.email, ip_address=ip, device_id=body.device_id, success=False))
        await db.commit()
        attempts_left = MAX_LOGIN_ATTEMPTS - len([t for t in _login_attempts.get(body.email, []) if t > time.time() - LOCKOUT_MINUTES * 60])
        raise HTTPException(status_code=401, detail=f"Invalid email or password. {attempts_left} attempts remaining.")

    # Email verification disabled for now — auto-verified on signup

    # Success — clear lockout, log success
    _clear_login_attempts(body.email)
    db.add(GhostLoginLog(user_email=body.email, ip_address=ip, device_id=body.device_id, success=True))

    # Trust device if requested
    if body.trust_device and body.device_id:
        existing_device = await db.execute(
            select(GhostTrustedDevice).where(
                GhostTrustedDevice.user_email == body.email,
                GhostTrustedDevice.device_id == body.device_id,
            )
        )
        if not existing_device.scalar_one_or_none():
            db.add(GhostTrustedDevice(user_email=body.email, device_id=body.device_id, device_name=body.device_name))

    await db.commit()

    token = create_ghost_token(str(user.id), user.email)
    return GhostTokenResponse(token=token, email=user.email, name=user.name, credits=user.credits, plan=user.plan)

@router.get("/login-logs")
async def ghost_login_logs(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(
        select(GhostLoginLog).where(GhostLoginLog.user_email == payload["email"]).order_by(GhostLoginLog.timestamp.desc()).limit(20)
    )
    logs = result.scalars().all()
    return [{"ip": l.ip_address, "device": l.device_id, "success": l.success, "time": str(l.timestamp)} for l in logs]

@router.get("/trusted-devices")
async def ghost_trusted_devices(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(
        select(GhostTrustedDevice).where(GhostTrustedDevice.user_email == payload["email"])
    )
    devices = result.scalars().all()
    return [{"id": str(d.id), "device_id": d.device_id, "name": d.device_name, "trusted_at": str(d.trusted_at)} for d in devices]

@router.delete("/trusted-devices/{device_db_id}")
async def ghost_remove_device(device_db_id: str, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(
        select(GhostTrustedDevice).where(GhostTrustedDevice.id == uuid.UUID(device_db_id), GhostTrustedDevice.user_email == payload["email"])
    )
    device = result.scalar_one_or_none()
    if device:
        await db.delete(device)
        await db.commit()
    return {"ok": True}

@router.post("/forgot")
async def ghost_forgot(body: GhostForgotRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        # Don't reveal if email exists
        return {"message": "If that email is registered, a reset code has been sent"}

    code = generate_code()
    user.reset_code = code
    user.reset_expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    await db.commit()
    await send_password_reset_email(body.email, code)
    return {"message": "If that email is registered, a reset code has been sent"}

@router.post("/reset")
async def ghost_reset(body: GhostResetRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not user.reset_code or user.reset_code != body.code:
        raise HTTPException(status_code=400, detail="Invalid reset code")
    if user.reset_expires and user.reset_expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Reset code expired")

    user.password_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    user.reset_code = None
    user.reset_expires = None
    await db.commit()
    return {"message": "Password reset successfully"}

@router.get("/me")
async def ghost_me(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"email": user.email, "name": user.name, "credits": user.credits, "plan": user.plan, "created_at": str(user.created_at)}

@router.post("/credits")
async def ghost_add_credits(body: GhostAddCreditsRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.credits += body.credits
    user.plan = body.plan
    await db.commit()
    return {"credits": user.credits, "plan": user.plan}


class SmtpSettingsRequest(BaseModel):
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = 587
    smtp_user: Optional[str] = None
    smtp_pass: Optional[str] = None
    smtp_from: Optional[str] = None


@router.post("/smtp")
async def save_smtp_settings(body: SmtpSettingsRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Save user's SMTP settings for sending emails from their own address."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.smtp_host = body.smtp_host
    user.smtp_port = body.smtp_port or 587
    user.smtp_user = body.smtp_user
    user.smtp_pass = body.smtp_pass
    user.smtp_from = body.smtp_from
    await db.commit()
    return {"status": "saved"}


@router.get("/smtp")
async def get_smtp_settings(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Get user's SMTP settings (password masked)."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "smtp_host": user.smtp_host,
        "smtp_port": user.smtp_port,
        "smtp_user": user.smtp_user,
        "smtp_pass": "••••••••" if user.smtp_pass else None,
        "smtp_from": user.smtp_from,
        "configured": bool(user.smtp_host and user.smtp_user and user.smtp_pass),
    }
