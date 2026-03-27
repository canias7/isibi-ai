from __future__ import annotations
import os
import uuid
import random
import string
from datetime import datetime, timedelta, timezone

import httpx
import bcrypt
from jose import jwt
from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from models.user import User
from schemas.auth import (
    SignupRequest,
    LoginRequest,
    VerifyEmailRequest,
    ResendCodeRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserResponse,
)
from services.email import send_verification_email, send_password_reset_email

router = APIRouter(prefix="/auth", tags=["auth"])

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "72"))
TURNSTILE_SECRET = os.getenv("TURNSTILE_SECRET_KEY", "")
CODE_EXPIRY_MINUTES = 10


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _generate_code() -> str:
    return "".join(random.choices(string.digits, k=6))


def _make_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "org_id": str(user.org_id),
        "account_type": user.account_type_col,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        account_type=user.account_type_col,
        email_verified=user.email_verified,
    )


async def _verify_turnstile(token: str) -> bool:
    if not TURNSTILE_SECRET:
        # Dev mode: skip verification
        return True

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data={"secret": TURNSTILE_SECRET, "response": token},
        )
        data = resp.json()
        return data.get("success", False)


# ─── Signup ───────────────────────────────────────────────

@router.post("/signup", response_model=TokenResponse, status_code=201)
async def signup(body: SignupRequest, db: AsyncSession = Depends(get_db)):
    # Verify Turnstile
    if not await _verify_turnstile(body.turnstile_token):
        raise HTTPException(status_code=400, detail="Bot verification failed. Please try again.")

    # Check existing email
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    code = _generate_code()
    org_id = uuid.uuid4()  # Each new signup gets their own org

    user = User(
        id=uuid.uuid4(),
        org_id=org_id,
        first_name=body.first_name,
        last_name=body.last_name,
        email=body.email,
        password_hash=_hash_password(body.password),
        account_type_col=body.account_type,
        email_verified=False,
        verification_code=code,
        verification_expires_at=datetime.now(timezone.utc) + timedelta(minutes=CODE_EXPIRY_MINUTES),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Send verification email
    await send_verification_email(user.email, code)

    token = _make_token(user)
    return TokenResponse(access_token=token, user=_user_response(user))


# ─── Verify Email ────────────────────────────────────────

@router.post("/verify-email")
async def verify_email(body: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="Account not found.")

    if user.email_verified:
        return {"message": "Email already verified."}

    if user.verification_code != body.code:
        raise HTTPException(status_code=400, detail="Invalid verification code.")

    if user.verification_expires_at and user.verification_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Verification code has expired. Request a new one.")

    user.email_verified = True
    user.verification_code = None
    user.verification_expires_at = None
    await db.commit()

    token = _make_token(user)
    return TokenResponse(access_token=token, user=_user_response(user))


# ─── Login ───────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    # Verify Turnstile
    if not await _verify_turnstile(body.turnstile_token):
        raise HTTPException(status_code=400, detail="Bot verification failed. Please try again.")

    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not _verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not user.email_verified:
        # Resend code automatically
        code = _generate_code()
        user.verification_code = code
        user.verification_expires_at = datetime.now(timezone.utc) + timedelta(minutes=CODE_EXPIRY_MINUTES)
        await db.commit()
        await send_verification_email(user.email, code)
        raise HTTPException(
            status_code=403,
            detail="Email not verified. A new verification code has been sent."
        )

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    token = _make_token(user)
    return TokenResponse(access_token=token, user=_user_response(user))


# ─── Resend Code ─────────────────────────────────────────

@router.post("/resend-code")
async def resend_code(body: ResendCodeRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user:
        # Don't reveal if email exists
        return {"message": "If an account exists, a new code has been sent."}

    if user.email_verified:
        return {"message": "Email already verified."}

    code = _generate_code()
    user.verification_code = code
    user.verification_expires_at = datetime.now(timezone.utc) + timedelta(minutes=CODE_EXPIRY_MINUTES)
    await db.commit()

    await send_verification_email(user.email, code)
    return {"message": "If an account exists, a new code has been sent."}


# ─── Forgot Password ────────────────────────────────────

@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user:
        code = _generate_code()
        user.verification_code = code
        user.verification_expires_at = datetime.now(timezone.utc) + timedelta(minutes=CODE_EXPIRY_MINUTES)
        await db.commit()
        await send_password_reset_email(user.email, code)

    # Always return success to prevent email enumeration
    return {"message": "If an account exists, a reset code has been sent."}


# ─── Reset Password ─────────────────────────────────────

@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=400, detail="Invalid request.")

    if user.verification_code != body.code:
        raise HTTPException(status_code=400, detail="Invalid reset code.")

    if user.verification_expires_at and user.verification_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Reset code has expired. Request a new one.")

    user.password_hash = _hash_password(body.new_password)
    user.verification_code = None
    user.verification_expires_at = None
    await db.commit()

    return {"message": "Password updated successfully."}


@router.post("/seed-test-account")
async def seed_test_account(db: AsyncSession = Depends(get_db)):
    """One-time endpoint to create a test account with unlimited builds. Remove after use."""
    from models.subscription import Subscription

    # Check if already exists
    result = await db.execute(select(User).where(User.email == "test@isibi.ai"))
    existing = result.scalar_one_or_none()
    if existing:
        return {"message": "Test account already exists", "email": "test@isibi.ai", "password": "TestPass123!"}

    org_id = uuid.uuid4()
    user_id = uuid.uuid4()

    user = User(
        id=user_id,
        org_id=org_id,
        first_name="Test",
        last_name="Admin",
        email="test@isibi.ai",
        password_hash=_hash_password("TestPass123!"),
        account_type_col="developer",
        email_verified=True,
        role="admin",
        status="active",
    )
    db.add(user)

    sub = Subscription(
        id=uuid.uuid4(),
        org_id=org_id,
        plan="teams",
        status="active",
        builds_used=0,
        builds_limit=99999,
    )
    db.add(sub)

    await db.commit()
    return {
        "message": "Test account created!",
        "email": "test@isibi.ai",
        "password": "TestPass123!",
        "account_type": "developer",
        "plan": "teams (unlimited)",
    }
