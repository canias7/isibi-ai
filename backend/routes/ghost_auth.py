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
from sqlalchemy import select, Column, String, Integer, Boolean, DateTime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import UUID

from db import get_db, Base
from services.email import send_verification_email, send_password_reset_email

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

# ── Schemas ───────────────────────────────────────────────────────────

class GhostSignupRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=6, max_length=128)

class GhostVerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)

class GhostLoginRequest(BaseModel):
    email: EmailStr
    password: str

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

@router.post("/signup")
async def ghost_signup(body: GhostSignupRequest, db: AsyncSession = Depends(get_db)):
    # Check if email exists
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    existing = result.scalar_one_or_none()
    if existing and existing.email_verified:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Generate verification code
    code = generate_code()
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()

    if existing and not existing.email_verified:
        # Update existing unverified account
        existing.name = body.name
        existing.password_hash = hashed
        existing.verification_code = code
        existing.verification_expires = expires
    else:
        # Create new user
        user = GhostUser(
            email=body.email, name=body.name, password_hash=hashed,
            verification_code=code, verification_expires=expires,
        )
        db.add(user)

    await db.commit()

    # Send verification email
    await send_verification_email(body.email, code)

    return {"message": "Verification code sent to " + body.email, "email": body.email}

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
async def ghost_login(body: GhostLoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not bcrypt.checkpw(body.password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.email_verified:
        # Resend verification code
        code = generate_code()
        user.verification_code = code
        user.verification_expires = datetime.now(timezone.utc) + timedelta(minutes=10)
        await db.commit()
        await send_verification_email(body.email, code)
        return GhostTokenResponse(token="needs_verification", email=user.email, name=user.name, credits=0, plan="unverified")

    token = create_ghost_token(str(user.id), user.email)
    return GhostTokenResponse(token=token, email=user.email, name=user.name, credits=user.credits, plan=user.plan)

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
