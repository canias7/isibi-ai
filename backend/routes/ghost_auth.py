"""
Ghost Mode Auth — standalone authentication for the desktop app.
Separate from the main isibi.ai auth system.

Routes:
  POST /api/ghost/signup  — create Ghost Mode account
  POST /api/ghost/login   — login and get JWT
  GET  /api/ghost/me      — get current user info
  POST /api/ghost/credits — add credits after Stripe payment
"""

from __future__ import annotations
import os
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt
from fastapi import APIRouter, HTTPException, status, Depends, Header
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, Column, String, Integer, Boolean, DateTime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import UUID

from db import get_db, Base

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

# ── Schemas ───────────────────────────────────────────────────────────

class GhostSignupRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=6, max_length=128)

class GhostLoginRequest(BaseModel):
    email: EmailStr
    password: str

class GhostTokenResponse(BaseModel):
    token: str
    email: str
    name: str
    credits: int
    plan: str

class GhostAddCreditsRequest(BaseModel):
    credits: int
    plan: str = "starter"

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
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Create user
    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user = GhostUser(email=body.email, name=body.name, password_hash=hashed)
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_ghost_token(str(user.id), user.email)
    return GhostTokenResponse(token=token, email=user.email, name=user.name, credits=user.credits, plan=user.plan)

@router.post("/login", response_model=GhostTokenResponse)
async def ghost_login(body: GhostLoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not bcrypt.checkpw(body.password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_ghost_token(str(user.id), user.email)
    return GhostTokenResponse(token=token, email=user.email, name=user.name, credits=user.credits, plan=user.plan)

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
