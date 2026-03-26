from __future__ import annotations
"""
App Auth API — authentication for generated app end-users.

These are separate from platform users. Each generated app (project) has
its own user pool. JWTs use a distinct claim structure with type="app_user".

Routes:
  POST /api/apps/{project_id}/auth/signup  — register a new app user
  POST /api/apps/{project_id}/auth/login   — login, returns JWT
  GET  /api/apps/{project_id}/auth/me      — get current app user profile
"""

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import jwt, JWTError
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from models.app_user import AppUser

router = APIRouter(prefix="/apps", tags=["App Auth"])

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
APP_JWT_EXPIRE_HOURS = int(os.getenv("APP_JWT_EXPIRE_HOURS", "72"))

security = HTTPBearer()


# ── Request / Response schemas ───────────────────────────────────────

class AppSignupRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: Optional[str] = None

class AppLoginRequest(BaseModel):
    email: EmailStr
    password: str

class AppUserResponse(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None
    role: str
    is_active: bool
    created_at: Optional[str] = None

class AppTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AppUserResponse


# ── Helpers ──────────────────────────────────────────────────────────

def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _make_app_token(app_user: AppUser, project_id: uuid.UUID) -> str:
    """Create a JWT for an app user with a distinct claim structure."""
    payload = {
        "sub": str(app_user.id),
        "project_id": str(project_id),
        "type": "app_user",
        "exp": datetime.now(timezone.utc) + timedelta(hours=APP_JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _app_user_response(user: AppUser) -> AppUserResponse:
    return AppUserResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat() if user.created_at else None,
    )


async def get_current_app_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """Decode and validate an app-user JWT. Returns the payload dict."""
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "app_user":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type — expected app_user token",
            )
        user_id = payload.get("sub")
        project_id = payload.get("project_id")
        if not user_id or not project_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing claims in token",
            )
        return {"user_id": uuid.UUID(user_id), "project_id": uuid.UUID(project_id)}
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


# ── Signup ───────────────────────────────────────────────────────────

@router.post("/{project_id}/auth/signup", status_code=201)
async def app_signup(
    project_id: uuid.UUID,
    body: AppSignupRequest,
    db: AsyncSession = Depends(get_db),
):
    """Register a new user for a generated app."""
    # Check for existing user with same email in this project
    result = await db.execute(
        select(AppUser).where(
            AppUser.project_id == project_id,
            AppUser.email == body.email,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    app_user = AppUser(
        id=uuid.uuid4(),
        project_id=project_id,
        email=body.email,
        password_hash=_hash_password(body.password),
        display_name=body.display_name,
    )
    db.add(app_user)
    await db.commit()
    await db.refresh(app_user)

    token = _make_app_token(app_user, project_id)
    return AppTokenResponse(access_token=token, user=_app_user_response(app_user))


# ── Login ────────────────────────────────────────────────────────────

@router.post("/{project_id}/auth/login")
async def app_login(
    project_id: uuid.UUID,
    body: AppLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Login as an app user for a generated app."""
    result = await db.execute(
        select(AppUser).where(
            AppUser.project_id == project_id,
            AppUser.email == body.email,
        )
    )
    app_user = result.scalar_one_or_none()

    if not app_user or not _verify_password(body.password, app_user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not app_user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated.")

    token = _make_app_token(app_user, project_id)
    return AppTokenResponse(access_token=token, user=_app_user_response(app_user))


# ── Me ───────────────────────────────────────────────────────────────

@router.get("/{project_id}/auth/me")
async def app_me(
    project_id: uuid.UUID,
    claims: dict = Depends(get_current_app_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the current app user's profile."""
    # Verify the token's project_id matches the URL
    if claims["project_id"] != project_id:
        raise HTTPException(status_code=403, detail="Token does not match this app.")

    result = await db.execute(
        select(AppUser).where(AppUser.id == claims["user_id"])
    )
    app_user = result.scalar_one_or_none()

    if not app_user:
        raise HTTPException(status_code=404, detail="User not found.")

    if not app_user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated.")

    return _app_user_response(app_user)
