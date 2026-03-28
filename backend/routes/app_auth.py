from __future__ import annotations
"""
App Auth API — authentication for generated app end-users.

These are separate from platform users. Each generated app (project) has
its own user pool. JWTs use a distinct claim structure with type="app_user".

Routes:
  POST /api/apps/{project_id}/auth/signup           — register a new app user
  POST /api/apps/{project_id}/auth/login             — login, returns JWT
  GET  /api/apps/{project_id}/auth/me                — get current app user profile
  POST /api/apps/{project_id}/auth/forgot-password   — request a reset code
  POST /api/apps/{project_id}/auth/reset-password    — verify code & set new password
"""

import os
import json
import uuid
import hashlib
import secrets
import logging
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
from models.user import User
from models.project import Project

_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Auth"])

# In-memory reset code store: key = "{project_id}:{email}" -> {"code": str, "expires": datetime}
# In production, this would be stored in the database and emailed to the user.
_reset_codes: dict[str, dict] = {}

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
APP_JWT_EXPIRE_HOURS = int(os.getenv("APP_JWT_EXPIRE_HOURS", "72"))

security = HTTPBearer()

SESSION_EXPIRY_SECONDS = 86400  # 24 hours


# ── Redis session helpers ────────────────────────────────────────────

async def _get_redis():
    """Get Redis client, returns None if unavailable."""
    try:
        from utils.redis_client import get_redis
        return await get_redis()
    except Exception:
        return None


async def _store_session(token: str, user_data: dict):
    """Store a session in Redis with 24h expiry."""
    redis_client = await _get_redis()
    if not redis_client:
        return
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        await redis_client.setex(
            f"session:{token_hash}",
            SESSION_EXPIRY_SECONDS,
            json.dumps(user_data),
        )
    except Exception as e:
        _logger.debug("Redis session store failed: %s", e)


async def _revoke_session(token: str):
    """Remove a session from Redis (instant revocation)."""
    redis_client = await _get_redis()
    if not redis_client:
        return
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        await redis_client.delete(f"session:{token_hash}")
    except Exception as e:
        _logger.debug("Redis session revoke failed: %s", e)


async def _check_session(token: str) -> dict | None:
    """Check if a session exists in Redis. Returns user data or None."""
    redis_client = await _get_redis()
    if not redis_client:
        return None  # No Redis = can't check, fall through to JWT validation
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        raw = await redis_client.get(f"session:{token_hash}")
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as e:
        _logger.debug("Redis session check failed: %s", e)
        return None


# ── Request / Response schemas ───────────────────────────────────────

class AppSignupRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: Optional[str] = None

class AppLoginRequest(BaseModel):
    email: EmailStr
    password: str

class AppForgotPasswordRequest(BaseModel):
    email: EmailStr

class AppResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str
    new_password: str

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
    """Register a new user for a generated app.

    If the email matches the project owner, auto-links them as owner
    instead of creating a separate account.
    """
    # Check for existing user with same email in this project
    result = await db.execute(
        select(AppUser).where(
            AppUser.project_id == project_id,
            AppUser.email == body.email,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    # Check if this email belongs to the project owner — auto-link instead of creating separate account
    platform_result = await db.execute(
        select(User).where(User.email == body.email)
    )
    platform_user = platform_result.scalar_one_or_none()

    owner_role = "user"
    password_hash = _hash_password(body.password)
    display_name = body.display_name

    if platform_user:
        project_result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == platform_user.id,
                Project.deleted_at.is_(None),
            )
        )
        if project_result.scalar_one_or_none():
            # This is the project owner — use their platform password hash and mark as owner
            owner_role = "owner"
            password_hash = platform_user.password_hash
            display_name = display_name or f"{platform_user.first_name} {platform_user.last_name}"

    app_user = AppUser(
        id=uuid.uuid4(),
        project_id=project_id,
        email=body.email,
        password_hash=password_hash,
        display_name=display_name,
        role=owner_role,
    )
    db.add(app_user)
    await db.commit()
    await db.refresh(app_user)

    token = _make_app_token(app_user, project_id)

    # Store session in Redis for instant revocation support
    await _store_session(token, {
        "user_id": str(app_user.id),
        "project_id": str(project_id),
        "email": app_user.email,
    })

    return AppTokenResponse(access_token=token, user=_app_user_response(app_user))


# ── Login ────────────────────────────────────────────────────────────

@router.post("/{project_id}/auth/login")
async def app_login(
    project_id: uuid.UUID,
    body: AppLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Login as an app user for a generated app.

    Checks platform users (project owner) first, then app_users table.
    This allows the developer who built the app to log in with their
    isibi.ai credentials without creating a separate account.
    """
    # 1. Check if this is the project owner logging in with isibi.ai credentials
    platform_result = await db.execute(
        select(User).where(User.email == body.email)
    )
    platform_user = platform_result.scalar_one_or_none()

    if platform_user:
        # Check if this user owns this project
        project_result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == platform_user.id,
                Project.deleted_at.is_(None),
            )
        )
        if project_result.scalar_one_or_none():
            # Verify password against platform user's password
            if _verify_password(body.password, platform_user.password_hash):
                # Ensure an app_user record exists for the owner (auto-create if missing)
                existing_app_user = await db.execute(
                    select(AppUser).where(
                        AppUser.project_id == project_id,
                        AppUser.email == platform_user.email,
                    )
                )
                app_user = existing_app_user.scalar_one_or_none()
                if not app_user:
                    app_user = AppUser(
                        id=uuid.uuid4(),
                        project_id=project_id,
                        email=platform_user.email,
                        password_hash=platform_user.password_hash,
                        display_name=f"{platform_user.first_name} {platform_user.last_name}",
                        role="owner",
                    )
                    db.add(app_user)
                    await db.commit()
                    await db.refresh(app_user)

                token = _make_app_token(app_user, project_id)

                # Store session in Redis
                await _store_session(token, {
                    "user_id": str(app_user.id),
                    "project_id": str(project_id),
                    "email": app_user.email,
                })

                return AppTokenResponse(access_token=token, user=_app_user_response(app_user))

    # 2. Then check app_users table (for marketplace buyers and other users)
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

    # Store session in Redis for instant revocation support
    await _store_session(token, {
        "user_id": str(app_user.id),
        "project_id": str(project_id),
        "email": app_user.email,
    })

    return AppTokenResponse(access_token=token, user=_app_user_response(app_user))


# ── Logout ────────────────────────────────────────────────────────

@router.post("/{project_id}/auth/logout")
async def app_logout(
    project_id: uuid.UUID,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Logout — revoke the current session token."""
    await _revoke_session(credentials.credentials)
    return {"message": "Logged out successfully."}


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


# ── Forgot Password ──────────────────────────────────────────────────

@router.post("/{project_id}/auth/forgot-password")
async def app_forgot_password(
    project_id: uuid.UUID,
    body: AppForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Request a password reset code for a generated app user.

    Generates a 6-digit code and stores it in memory. In production this
    would send an email. Returns success regardless of whether the email
    exists (to prevent user enumeration).
    """
    # Always return success to prevent email enumeration
    result = await db.execute(
        select(AppUser).where(
            AppUser.project_id == project_id,
            AppUser.email == body.email,
        )
    )
    app_user = result.scalar_one_or_none()

    if app_user and app_user.is_active:
        # Generate a 6-digit reset code
        code = f"{secrets.randbelow(900000) + 100000}"
        store_key = f"{project_id}:{body.email}"
        _reset_codes[store_key] = {
            "code": code,
            "expires": datetime.now(timezone.utc) + timedelta(minutes=15),
        }
        # In production: send email with the code
        # For now, we log it for testing purposes
        import logging
        logging.getLogger(__name__).info(
            "Reset code for %s in project %s: %s", body.email, project_id, code
        )

    return {"message": "If an account with that email exists, a reset code has been sent."}


# ── Reset Password ───────────────────────────────────────────────────

@router.post("/{project_id}/auth/reset-password")
async def app_reset_password(
    project_id: uuid.UUID,
    body: AppResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Reset password using the code from forgot-password.

    Verifies the code, updates the password, and invalidates the code.
    """
    store_key = f"{project_id}:{body.email}"
    stored = _reset_codes.get(store_key)

    if not stored:
        raise HTTPException(status_code=400, detail="Invalid or expired reset code.")

    # Check expiry
    if datetime.now(timezone.utc) > stored["expires"]:
        _reset_codes.pop(store_key, None)
        raise HTTPException(status_code=400, detail="Reset code has expired. Please request a new one.")

    # Check code
    if stored["code"] != body.code:
        raise HTTPException(status_code=400, detail="Invalid reset code.")

    # Validate new password
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    # Find the user and update password
    result = await db.execute(
        select(AppUser).where(
            AppUser.project_id == project_id,
            AppUser.email == body.email,
        )
    )
    app_user = result.scalar_one_or_none()

    if not app_user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset code.")

    app_user.password_hash = _hash_password(body.new_password)
    await db.commit()

    # Invalidate the code
    _reset_codes.pop(store_key, None)

    return {"message": "Password reset successfully. You can now log in with your new password."}
