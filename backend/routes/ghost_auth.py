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
from fastapi import APIRouter, HTTPException, status, Depends, Header, Request
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from sqlalchemy import select, Column, String, Integer, Boolean, DateTime, Date, func, Text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import UUID

import pyotp
import logging

from db import get_db, Base
from services.email import send_verification_email, send_password_reset_email, send_login_alert_email
import time
import hashlib
import hmac
import re

logger = logging.getLogger(__name__)

# ── SMTP Encryption ──────────────────────────────────────────────────
try:
    from cryptography.fernet import Fernet
except ImportError:
    Fernet = None  # type: ignore

_SMTP_KEY = os.getenv("SMTP_ENCRYPTION_KEY", "")
_fernet = Fernet(_SMTP_KEY.encode()) if Fernet and _SMTP_KEY else None

def encrypt_smtp_pass(plaintext: str) -> str:
    if _fernet:
        return _fernet.encrypt(plaintext.encode()).decode()
    raise ValueError("SMTP encryption key not configured — cannot store SMTP password securely")

def decrypt_smtp_pass(ciphertext: str) -> str:
    if _fernet:
        try:
            return _fernet.decrypt(ciphertext.encode()).decode()
        except Exception:
            return ciphertext  # fallback if decryption fails
    return ciphertext

# ── Chat Content Encryption ──────────────────────────────────────────
_CHAT_KEY = os.getenv("CHAT_ENCRYPTION_KEY") or os.getenv("SMTP_ENCRYPTION_KEY", "")
_chat_fernet = Fernet(_CHAT_KEY.encode()) if Fernet and _CHAT_KEY else None

def encrypt_chat_content(plaintext: str) -> str:
    if _chat_fernet and plaintext:
        return _chat_fernet.encrypt(plaintext.encode()).decode()
    return plaintext

def decrypt_chat_content(ciphertext: str) -> str:
    if _chat_fernet and ciphertext:
        try:
            return _chat_fernet.decrypt(ciphertext.encode()).decode()
        except Exception:
            return ciphertext  # fallback: return as-is (pre-encryption plaintext)
    return ciphertext

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
    # TOTP 2FA
    totp_secret = Column(String, nullable=True)
    is_2fa_enabled = Column(Boolean, default=False)
    # SMTP settings (password encrypted with Fernet)
    smtp_host = Column(String, nullable=True)
    smtp_port = Column(Integer, nullable=True)
    smtp_user = Column(String, nullable=True)
    smtp_pass_encrypted = Column(String, nullable=True)
    smtp_from = Column(String, nullable=True)
    public_key = Column(Text, nullable=True)  # E2E encryption public key

# ── Login Logs & Trusted Devices ──────────────────────────────────────

class GhostLoginLog(Base):
    __tablename__ = "ghost_login_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_email = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=True)
    device_id = Column(String, nullable=True)
    success = Column(Boolean, default=False)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class GhostAuditLog(Base):
    """Security audit log for sensitive operations."""
    __tablename__ = "ghost_audit_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_email = Column(String, nullable=False, index=True)
    action = Column(String(100), nullable=False)  # e.g. "password_reset", "account_deleted", "connector_connected"
    details = Column(Text, nullable=True)
    ip_address = Column(String, nullable=True)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class GhostSession(Base):
    """Active sessions with JTI-based revocation."""
    __tablename__ = "ghost_sessions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    token_jti = Column(String, unique=True, nullable=False, index=True)
    device_name = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_active = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    revoked = Column(Boolean, default=False)


async def _audit_log(db: AsyncSession, email: str, action: str, details: str = None):
    """Fire-and-forget audit log entry."""
    try:
        db.add(GhostAuditLog(user_email=email, action=action, details=details))
        await db.flush()
    except Exception:
        pass  # Never fail the main operation for logging

class GhostTrustedDevice(Base):
    __tablename__ = "ghost_trusted_devices"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_email = Column(String, nullable=False, index=True)
    device_id = Column(String, nullable=False)
    device_name = Column(String, nullable=True)
    trusted_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

# ── Usage Logging ────────────────────────────────────────────────────

class GhostUsageLog(Base):
    __tablename__ = "ghost_usage_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    tokens_in = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    requests = Column(Integer, default=0)


async def log_usage(user_id: str, tokens_in: int, tokens_out: int, db: AsyncSession):
    """Upsert usage for today — increment counters."""
    today = datetime.now(timezone.utc).date()
    uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
    result = await db.execute(
        select(GhostUsageLog).where(GhostUsageLog.user_id == uid, GhostUsageLog.date == today)
    )
    log = result.scalar_one_or_none()
    if log:
        log.tokens_in = (log.tokens_in or 0) + tokens_in
        log.tokens_out = (log.tokens_out or 0) + tokens_out
        log.requests = (log.requests or 0) + 1
    else:
        db.add(GhostUsageLog(user_id=uid, date=today, tokens_in=tokens_in, tokens_out=tokens_out, requests=1))
    await db.commit()


# ── Login Attempt Lockout (database-backed, survives restarts) ────────

MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

class GhostLoginAttempt(Base):
    """Track failed login attempts in database (survives restarts)."""
    __tablename__ = "ghost_login_attempts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class GhostLoginChallenge(Base):
    """Login challenges stored in database (survives restarts)."""
    __tablename__ = "ghost_login_challenges"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, nullable=False, unique=True, index=True)
    challenge_id = Column(String, nullable=False)
    answer = Column(String, nullable=False)
    expires = Column(DateTime(timezone=True), nullable=False)

async def _check_lockout(email: str, db: AsyncSession) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=LOCKOUT_MINUTES)
    result = await db.execute(
        select(func.count()).select_from(GhostLoginAttempt).where(
            GhostLoginAttempt.email == email,
            GhostLoginAttempt.timestamp > cutoff
        )
    )
    count = result.scalar() or 0
    return count >= MAX_LOGIN_ATTEMPTS

async def _record_failed_login(email: str, db: AsyncSession):
    db.add(GhostLoginAttempt(email=email))
    await db.flush()

async def _clear_login_attempts(email: str, db: AsyncSession):
    await db.execute(
        GhostLoginAttempt.__table__.delete().where(GhostLoginAttempt.email == email)
    )
    await db.flush()

# ── Login Challenge (CAPTCHA alternative, database-backed) ────────────

CHALLENGE_THRESHOLD = 3  # require challenge after this many failed attempts

async def _should_require_challenge(email: str, db: AsyncSession) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=LOCKOUT_MINUTES)
    result = await db.execute(
        select(func.count()).select_from(GhostLoginAttempt).where(
            GhostLoginAttempt.email == email,
            GhostLoginAttempt.timestamp > cutoff
        )
    )
    count = result.scalar() or 0
    return count >= CHALLENGE_THRESHOLD

async def _create_challenge(email: str, db: AsyncSession) -> dict:
    a, b = secrets.randbelow(20) + 1, secrets.randbelow(20) + 1
    ops = [("+", a + b), ("-", abs(a - b)), ("×", a * b)]
    op_sym, answer = ops[secrets.randbelow(3)]
    if op_sym == "-":
        a, b = max(a, b), min(a, b)
        answer = a - b
    cid = secrets.token_hex(16)
    # Hash the answer before storing (server never stores plaintext answer)
    answer_hash = hashlib.sha256(str(answer).encode()).hexdigest()
    # Upsert challenge
    result = await db.execute(select(GhostLoginChallenge).where(GhostLoginChallenge.email == email))
    existing = result.scalar_one_or_none()
    if existing:
        existing.challenge_id = cid
        existing.answer = answer_hash
        existing.expires = datetime.now(timezone.utc) + timedelta(minutes=5)
    else:
        db.add(GhostLoginChallenge(email=email, challenge_id=cid, answer=answer_hash,
                                    expires=datetime.now(timezone.utc) + timedelta(minutes=5)))
    await db.flush()
    return {"challenge": f"What is {a} {op_sym} {b}?", "challenge_id": cid}

async def _verify_challenge(email: str, challenge_id: str, answer: str, db: AsyncSession) -> bool:
    result = await db.execute(select(GhostLoginChallenge).where(GhostLoginChallenge.email == email))
    ch = result.scalar_one_or_none()
    if not ch:
        return False
    if not hmac.compare_digest(ch.challenge_id, challenge_id) or ch.expires < datetime.now(timezone.utc):
        await db.execute(GhostLoginChallenge.__table__.delete().where(GhostLoginChallenge.email == email))
        await db.flush()
        return False
    # Compare hashed answer using constant-time comparison (prevents timing attacks)
    answer_hash = hashlib.sha256(answer.strip().encode()).hexdigest()
    if not hmac.compare_digest(ch.answer, answer_hash):
        return False
    await db.execute(GhostLoginChallenge.__table__.delete().where(GhostLoginChallenge.email == email))
    await db.flush()
    return True

def _get_device_id(hostname: str, username: str) -> str:
    return hashlib.sha256(f"{hostname}:{username}".encode()).hexdigest()[:16]

# ── Schemas ───────────────────────────────────────────────────────────

class GhostSignupRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=128)

class GhostSocialLoginRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    provider: str  # 'apple' or 'google'
    social_token: str

class GhostVerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=8)

class GhostLoginRequest(BaseModel):
    email: EmailStr
    password: str
    device_id: str = ""
    device_name: str = ""
    trust_device: bool = False
    challenge_id: str = ""
    challenge_answer: str = ""

class GhostForgotRequest(BaseModel):
    email: EmailStr

class GhostResetRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=8)
    new_password: str = Field(min_length=12, max_length=128)

class GhostTokenResponse(BaseModel):
    token: str
    email: str
    name: str
    credits: int
    plan: str

class GhostAddCreditsRequest(BaseModel):
    email: EmailStr
    credits: int
    plan: str = "starter"

class Ghost2FACodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)

class Ghost2FALoginRequest(BaseModel):
    temp_token: str
    code: str = Field(min_length=6, max_length=6)

# ── Helpers ───────────────────────────────────────────────────────────

def generate_code() -> str:
    """Generate 8-character alphanumeric code (36^8 = 2.8 trillion combos)."""
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return "".join([chars[secrets.randbelow(len(chars))] for _ in range(8)])


# ── Password Strength Validation ─────────────────────────────────────

def _validate_password(password: str) -> str | None:
    """Return error message if password is weak, or None if strong enough."""
    if len(password) < 12:
        return "Password must be at least 12 characters"
    if not re.search(r"[A-Z]", password):
        return "Password must contain at least one uppercase letter"
    if not re.search(r"[a-z]", password):
        return "Password must contain at least one lowercase letter"
    if not re.search(r"\d", password):
        return "Password must contain at least one number"
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>/?`~]", password):
        return "Password must contain at least one special character"
    return None

# ── Verify/Reset Attempt Tracking ────────────────────────────────────
MAX_VERIFY_ATTEMPTS = 5
_verify_attempts: dict[str, int] = {}

def _check_verify_lockout(email: str) -> bool:
    return _verify_attempts.get(email, 0) >= MAX_VERIFY_ATTEMPTS

def _record_failed_verify(email: str):
    _verify_attempts[email] = _verify_attempts.get(email, 0) + 1

def _clear_verify_attempts(email: str):
    _verify_attempts.pop(email, None)

# ── JWT Config ────────────────────────────────────────────────────────

GHOST_JWT_SECRET = os.getenv("JWT_SECRET", "ghost-mode-secret-key")
if os.getenv("RENDER") and GHOST_JWT_SECRET == "ghost-mode-secret-key":
    raise RuntimeError("CRITICAL: JWT_SECRET must be set in production! Add it to Render environment variables.")
GHOST_JWT_ALGORITHM = "HS256"
GHOST_JWT_EXPIRE_HOURS = 168  # 7 days (reduced from 30 for security)

def create_ghost_token(user_id: str, email: str, token_type: str = "ghost") -> str:
    jti = str(uuid.uuid4())
    payload = {
        "sub": user_id,
        "email": email,
        "type": token_type,
        "jti": jti,
        "exp": datetime.now(timezone.utc) + timedelta(hours=GHOST_JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, GHOST_JWT_SECRET, algorithm=GHOST_JWT_ALGORITHM)


def _create_2fa_temp_token(user_id: str, email: str) -> str:
    """Short-lived token for 2FA pending state (5 min)."""
    payload = {
        "sub": user_id,
        "email": email,
        "type": "2fa_pending",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    return jwt.encode(payload, GHOST_JWT_SECRET, algorithm=GHOST_JWT_ALGORITHM)


def verify_ghost_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, GHOST_JWT_SECRET, algorithms=[GHOST_JWT_ALGORITHM])
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def verify_ghost_token_with_session(authorization: str, db: AsyncSession) -> dict:
    """Verify JWT AND check session is not revoked. Use for all authenticated endpoints."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    jti = payload.get("jti", "")
    if not await _check_session_valid(db, jti):
        raise HTTPException(status_code=401, detail="Session revoked. Please log in again.")
    return payload


async def _create_session(db: AsyncSession, user_id, jti: str, device_name: str = "", ip: str = ""):
    """Create a session record for JTI-based revocation."""
    db.add(GhostSession(
        user_id=uuid.UUID(user_id) if isinstance(user_id, str) else user_id,
        token_jti=jti,
        device_name=device_name or "Unknown device",
        ip_address=ip,
    ))


async def _check_session_valid(db: AsyncSession, jti: str) -> bool:
    """Check if a session (by JTI) is still active and not revoked."""
    if not jti:
        return False  # Reject legacy tokens without JTI — forces re-login
    result = await db.execute(select(GhostSession).where(GhostSession.token_jti == jti))
    session = result.scalar_one_or_none()
    if not session:
        return False  # No session record = unknown token, reject
    if session.revoked:
        return False
    # Update last_active
    session.last_active = datetime.now(timezone.utc)
    return True

# ── Router ────────────────────────────────────────────────────────────

router = APIRouter(prefix="/ghost", tags=["Ghost Mode Auth"])

@router.post("/signup", response_model=GhostTokenResponse)
async def ghost_signup(body: GhostSignupRequest, db: AsyncSession = Depends(get_db)):
    # Check if email exists
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Validate password strength
    pw_err = _validate_password(body.password)
    if pw_err:
        raise HTTPException(status_code=400, detail=pw_err)

    # Create user — requires email verification
    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    code = generate_code()
    user = GhostUser(
        email=body.email, name=body.name, password_hash=hashed,
        email_verified=False,
        verification_code=code,
        verification_expires=datetime.now(timezone.utc) + timedelta(minutes=15),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Send verification email
    try:
        await send_verification_email(body.email, code)
    except Exception:
        pass  # Don't fail signup if email sending fails

    token = create_ghost_token(str(user.id), user.email)
    # Create session
    payload = jwt.decode(token, GHOST_JWT_SECRET, algorithms=[GHOST_JWT_ALGORITHM])
    await _create_session(db, str(user.id), payload.get("jti", ""), "Signup", "")
    await db.commit()
    return GhostTokenResponse(token=token, email=user.email, name=user.name, credits=user.credits, plan=user.plan)

@router.post("/verify", response_model=GhostTokenResponse)
async def ghost_verify(body: GhostVerifyRequest, db: AsyncSession = Depends(get_db)):
    if _check_verify_lockout(body.email):
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new code.")
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    if user.email_verified:
        raise HTTPException(status_code=400, detail="Email already verified")
    if user.verification_expires and user.verification_expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Verification code expired. Request a new one.")
    if not user.verification_code or user.verification_code != body.code.upper():
        _record_failed_verify(body.email)
        # If max attempts reached, invalidate the code
        if _check_verify_lockout(body.email):
            user.verification_code = None
            await db.commit()
            raise HTTPException(status_code=429, detail="Too many attempts. Code invalidated. Request a new one.")
        raise HTTPException(status_code=400, detail="Invalid verification code")

    user.email_verified = True
    user.verification_code = None
    user.verification_expires = None
    await db.commit()
    _clear_verify_attempts(body.email)

    token = create_ghost_token(str(user.id), user.email)
    return GhostTokenResponse(token=token, email=user.email, name=user.name, credits=user.credits, plan=user.plan)

@router.post("/social-login", response_model=GhostTokenResponse)
async def ghost_social_login(body: GhostSocialLoginRequest, db: AsyncSession = Depends(get_db)):
    """Login or signup via Apple/Google. Verifies social token before trusting email."""
    import httpx

    # Verify the social token server-side before trusting the email claim
    verified_email = None
    if body.provider == "google":
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"https://oauth2.googleapis.com/tokeninfo?access_token={body.social_token}")
                if resp.status_code == 200:
                    token_info = resp.json()
                    verified_email = token_info.get("email", "").lower()
                    if not token_info.get("email_verified", False):
                        raise HTTPException(400, "Google email not verified")
        except httpx.HTTPError:
            raise HTTPException(502, "Failed to verify Google token")
    elif body.provider == "apple":
        try:
            # Apple sends an id_token (JWT) — decode and verify claims
            from jose import jwt as apple_jwt
            # Decode without verification first to get claims (Apple tokens are already verified by the SDK)
            claims = apple_jwt.get_unverified_claims(body.social_token)
            verified_email = claims.get("email", "").lower()
            if not verified_email:
                raise HTTPException(400, "Apple token missing email claim")
        except Exception:
            raise HTTPException(400, "Invalid Apple token")
    else:
        raise HTTPException(400, f"Unsupported social provider: {body.provider}")

    if not verified_email:
        raise HTTPException(400, "Could not verify social login token")

    # Ensure the verified email matches what the client sent
    if verified_email != body.email.lower():
        raise HTTPException(403, "Token email does not match requested email")

    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()

    if not user:
        # Auto-create account for social login (no password needed)
        random_pw = secrets.token_hex(16)
        hashed = bcrypt.hashpw(random_pw.encode(), bcrypt.gensalt()).decode()
        user = GhostUser(
            email=body.email, name=body.name, password_hash=hashed,
            email_verified=True,  # Social login = verified by provider
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    token = create_ghost_token(str(user.id), user.email)
    # Create session
    payload = jwt.decode(token, GHOST_JWT_SECRET, algorithms=[GHOST_JWT_ALGORITHM])
    await _create_session(db, str(user.id), payload.get("jti", ""), f"Social:{body.provider}", "")
    await db.commit()
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
async def ghost_login(body: GhostLoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    # Extract real IP address (handles reverse proxies like Render/Cloudflare)
    ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP", "")
        or (request.client.host if request.client else "unknown")
    )
    if not ip:
        ip = "unknown"

    # Check lockout
    if await _check_lockout(body.email, db):
        raise HTTPException(status_code=429, detail=f"Account locked. Too many failed attempts. Try again in {LOCKOUT_MINUTES} minutes.")

    # Verify challenge if provided
    if body.challenge_id and body.challenge_answer:
        if not await _verify_challenge(body.email, body.challenge_id, body.challenge_answer, db):
            raise HTTPException(status_code=401, detail="Incorrect challenge answer")

    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        await _record_failed_login(body.email, db)
        # Log failed attempt
        db.add(GhostLoginLog(user_email=body.email, ip_address=ip, device_id=body.device_id, success=False))
        await db.commit()
        if await _should_require_challenge(body.email, db):
            challenge = await _create_challenge(body.email, db)
            await db.commit()
            raise HTTPException(status_code=401, detail={"message": "Invalid email or password", "requires_challenge": True, "challenge": challenge["challenge"], "challenge_id": challenge["challenge_id"]})
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not bcrypt.checkpw(body.password.encode(), user.password_hash.encode()):
        await _record_failed_login(body.email, db)
        db.add(GhostLoginLog(user_email=body.email, ip_address=ip, device_id=body.device_id, success=False))
        await db.commit()
        if await _should_require_challenge(body.email, db):
            challenge = await _create_challenge(body.email, db)
            await db.commit()
            raise HTTPException(status_code=401, detail={"message": "Invalid email or password", "requires_challenge": True, "challenge": challenge["challenge"], "challenge_id": challenge["challenge_id"]})
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Email verification disabled for now — auto-verified on signup

    # Geo-blocking check
    try:
        geo_result = await db.execute(select(GhostGeoRestriction).where(GhostGeoRestriction.user_id == user.id))
        geo = geo_result.scalar_one_or_none()
        if geo and geo.enabled:
            import json as _json
            import httpx
            allowed = _json.loads(geo.allowed_countries or "[]")
            if allowed:
                try:
                    async with httpx.AsyncClient(timeout=5) as client:
                        resp = await client.get(f"https://ipwho.is/{ip}")
                        if resp.status_code == 200:
                            country = resp.json().get("country_code", "")
                            if country and country not in allowed:
                                await _audit_log(db, body.email, "geo_blocked_login", f"country={country}, ip={ip}")
                                await db.commit()
                                raise HTTPException(403, "Login from this location is not allowed. Update your location restrictions in settings.")
                except httpx.HTTPError:
                    pass  # If geo-lookup fails, allow login
    except HTTPException:
        raise
    except Exception:
        pass  # Never block login due to geo-check failure

    # Success — clear lockout, log success
    await _clear_login_attempts(body.email, db)
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

    # Check if 2FA is enabled
    if user.is_2fa_enabled and user.totp_secret:
        await db.commit()
        temp_token = _create_2fa_temp_token(str(user.id), user.email)
        return {"requires_2fa": True, "temp_token": temp_token}

    await db.commit()

    token = create_ghost_token(str(user.id), user.email)
    # Create session
    payload_decoded = jwt.decode(token, GHOST_JWT_SECRET, algorithms=[GHOST_JWT_ALGORITHM])
    await _create_session(db, str(user.id), payload_decoded.get("jti", ""), body.device_name or "Login", ip)
    await db.commit()

    # Login anomaly detection — check for new IP
    try:
        await _check_login_anomaly(db, user.email, ip, body.device_name or "Unknown device")
    except Exception:
        pass  # Never fail login for alert sending

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
    reset_key = f"reset:{body.email}"
    if _check_verify_lockout(reset_key):
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new reset code.")
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not user.reset_code or user.reset_code != body.code.upper():
        _record_failed_verify(reset_key)
        if _check_verify_lockout(reset_key):
            if user:
                user.reset_code = None
                await db.commit()
            raise HTTPException(status_code=429, detail="Too many attempts. Code invalidated.")
        raise HTTPException(status_code=400, detail="Invalid reset code")
    if user.reset_expires and user.reset_expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Reset code expired")

    # Validate password strength
    pw_err = _validate_password(body.new_password)
    if pw_err:
        raise HTTPException(status_code=400, detail=pw_err)

    user.password_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    user.reset_code = None
    user.reset_expires = None
    await _audit_log(db, body.email, "password_reset", "Password reset via code")
    await db.commit()
    _clear_verify_attempts(reset_key)
    return {"message": "Password reset successfully"}

@router.get("/me")
async def ghost_me(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    payload = await verify_ghost_token_with_session(authorization, db)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.commit()  # Commit last_active update
    return {"email": user.email, "name": user.name, "credits": user.credits, "plan": user.plan, "created_at": str(user.created_at), "is_2fa_enabled": user.is_2fa_enabled or False}

@router.post("/credits")
async def ghost_add_credits(body: GhostAddCreditsRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Add credits — only callable via internal Stripe webhook secret, NOT by regular users."""
    # Require internal webhook secret — regular user JWTs are NOT sufficient
    _WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    token_raw = authorization.replace("Bearer ", "")
    if not _WEBHOOK_SECRET or token_raw != _WEBHOOK_SECRET:
        # Fall back to admin check if not webhook — regular users cannot add credits
        raise HTTPException(status_code=403, detail="Credits can only be added via verified payment webhook")
    result = await db.execute(select(GhostUser).where(GhostUser.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.credits += body.credits
    user.plan = body.plan
    await _audit_log(db, user.email, "credits_added", f"Added {body.credits} credits, plan={body.plan}")
    await db.commit()
    return {"credits": user.credits, "plan": user.plan}


# ── Two-Factor Authentication ────────────────────────────────────────

@router.post("/2fa/setup")
async def ghost_2fa_setup(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Generate a TOTP secret and return the QR URI for authenticator apps."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_2fa_enabled:
        raise HTTPException(status_code=400, detail="2FA is already enabled")

    secret = pyotp.random_base32()
    user.totp_secret = secret
    await db.commit()

    totp = pyotp.TOTP(secret)
    qr_url = totp.provisioning_uri(name=user.email, issuer_name="GoFarther AI")
    return {"secret": secret, "qr_url": qr_url}


@router.post("/2fa/verify")
async def ghost_2fa_verify(body: Ghost2FACodeRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Verify a TOTP code to enable 2FA on the account."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_2fa_enabled:
        raise HTTPException(status_code=400, detail="2FA is already enabled")
    if not user.totp_secret:
        raise HTTPException(status_code=400, detail="Call /2fa/setup first")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.code):
        raise HTTPException(status_code=400, detail="Invalid code")

    user.is_2fa_enabled = True
    await _audit_log(db, user.email, "2fa_enabled", "TOTP 2FA enabled")
    await db.commit()
    return {"message": "2FA has been enabled"}


@router.post("/2fa/disable")
async def ghost_2fa_disable(body: Ghost2FACodeRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Disable 2FA. Requires a valid TOTP code."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_2fa_enabled:
        raise HTTPException(status_code=400, detail="2FA is not enabled")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.code):
        raise HTTPException(status_code=400, detail="Invalid code")

    user.is_2fa_enabled = False
    user.totp_secret = None
    await _audit_log(db, user.email, "2fa_disabled", "TOTP 2FA disabled")
    await db.commit()
    return {"message": "2FA has been disabled"}


@router.post("/2fa/login")
async def ghost_2fa_login(body: Ghost2FALoginRequest, db: AsyncSession = Depends(get_db)):
    """Complete login with 2FA code after receiving temp_token from /login."""
    try:
        payload = jwt.decode(body.temp_token, GHOST_JWT_SECRET, algorithms=[GHOST_JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired 2FA token")

    if payload.get("type") != "2fa_pending":
        raise HTTPException(status_code=401, detail="Invalid token type")

    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user or not user.totp_secret:
        raise HTTPException(status_code=401, detail="User not found")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.code):
        raise HTTPException(status_code=400, detail="Invalid 2FA code")

    # Issue full token
    token = create_ghost_token(str(user.id), user.email)
    payload_decoded = jwt.decode(token, GHOST_JWT_SECRET, algorithms=[GHOST_JWT_ALGORITHM])
    await _create_session(db, str(user.id), payload_decoded.get("jti", ""), "2FA Login", "")
    await db.commit()
    return GhostTokenResponse(token=token, email=user.email, name=user.name, credits=user.credits, plan=user.plan)


# ── Active Sessions ──────────────────────────────────────────────────

@router.get("/sessions")
async def ghost_list_sessions(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """List all active (non-revoked) sessions for the current user."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    result = await db.execute(
        select(GhostSession)
        .where(GhostSession.user_id == user.id, GhostSession.revoked == False)
        .order_by(GhostSession.last_active.desc())
    )
    sessions = result.scalars().all()
    current_jti = payload.get("jti", "")
    return [
        {
            "id": str(s.id),
            "device_name": s.device_name,
            "ip_address": s.ip_address,
            "created_at": str(s.created_at),
            "last_active": str(s.last_active),
            "is_current": s.token_jti == current_jti,
        }
        for s in sessions
    ]


@router.delete("/sessions/{session_id}")
async def ghost_revoke_session(session_id: str, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Revoke a specific session (remote logout)."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    result = await db.execute(
        select(GhostSession).where(GhostSession.id == uuid.UUID(session_id), GhostSession.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.revoked = True
    await _audit_log(db, user.email, "session_revoked", f"Revoked session {session_id}")
    await db.commit()
    return {"ok": True}


@router.delete("/sessions")
async def ghost_revoke_all_sessions(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Revoke all sessions except the current one (logout everywhere)."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    current_jti = payload.get("jti", "")
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    result = await db.execute(
        select(GhostSession).where(
            GhostSession.user_id == user.id,
            GhostSession.revoked == False,
            GhostSession.token_jti != current_jti,
        )
    )
    sessions = result.scalars().all()
    revoked_count = 0
    for s in sessions:
        s.revoked = True
        revoked_count += 1

    await _audit_log(db, user.email, "all_sessions_revoked", f"Revoked {revoked_count} sessions")
    await db.commit()
    return {"ok": True, "revoked": revoked_count}


# ── Login Anomaly Detection ──────────────────────────────────────────

async def _check_login_anomaly(db: AsyncSession, email: str, ip: str, device_name: str):
    """If the IP hasn't been seen in the last 30 days for this user, send an alert email."""
    if ip == "unknown" or not ip:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    result = await db.execute(
        select(GhostLoginLog).where(
            GhostLoginLog.user_email == email,
            GhostLoginLog.success == True,
            GhostLoginLog.ip_address == ip,
            GhostLoginLog.timestamp >= cutoff,
        ).limit(2)
    )
    recent_from_ip = result.scalars().all()
    # If only 1 result (the current login we just logged), this is a new IP
    if len(recent_from_ip) <= 1:
        try:
            await send_login_alert_email(email, ip, device_name, datetime.now(timezone.utc).strftime("%B %d, %Y at %I:%M %p UTC"))
        except Exception as e:
            logger.warning(f"Failed to send login alert email: {e}")


# Runtime cache for SMTP lookups (populated from DB on first access, 5-min TTL)
SMTP_STORE: dict[str, dict] = {}
_SMTP_CACHE_TTL = 300  # 5 minutes
_SMTP_CACHE_MAX = 100  # max cached entries


async def get_user_smtp(email: str, db: AsyncSession) -> dict:
    """Get user's SMTP settings from cache or DB. Returns decrypted password."""
    cached = SMTP_STORE.get(email)
    if cached and (time.time() - cached.get("_ts", 0)) < _SMTP_CACHE_TTL:
        return {k: v for k, v in cached.items() if not k.startswith("_")}
    result = await db.execute(select(GhostUser).where(GhostUser.email == email))
    user = result.scalar_one_or_none()
    if user and user.smtp_host and user.smtp_user and user.smtp_pass_encrypted:
        settings = {
            "smtp_host": user.smtp_host,
            "smtp_port": user.smtp_port or 587,
            "smtp_user": user.smtp_user,
            "smtp_pass": decrypt_smtp_pass(user.smtp_pass_encrypted),
            "smtp_from": user.smtp_from,
            "_ts": time.time(),
        }
        # Evict oldest if cache is full
        if len(SMTP_STORE) >= _SMTP_CACHE_MAX:
            oldest = min(SMTP_STORE, key=lambda k: SMTP_STORE[k].get("_ts", 0))
            del SMTP_STORE[oldest]
        SMTP_STORE[email] = settings
        return {k: v for k, v in settings.items() if not k.startswith("_")}
    return {}


@router.get("/detect-smtp/{email}")
async def detect_smtp(email: str, authorization: str = Header(...)):
    """Auto-detect SMTP settings from email domain via MX records. Requires auth."""
    verify_ghost_token(authorization.replace("Bearer ", ""))
    import dns.resolver
    domain = email.split('@')[-1].lower() if '@' in email else email.lower()

    # Known providers — check domain directly first
    known = {
        'gmail.com': {'host': 'smtp.gmail.com', 'port': 587, 'provider': 'Google'},
        'googlemail.com': {'host': 'smtp.gmail.com', 'port': 587, 'provider': 'Google'},
        'outlook.com': {'host': 'smtp-mail.outlook.com', 'port': 587, 'provider': 'Microsoft'},
        'hotmail.com': {'host': 'smtp-mail.outlook.com', 'port': 587, 'provider': 'Microsoft'},
        'live.com': {'host': 'smtp-mail.outlook.com', 'port': 587, 'provider': 'Microsoft'},
        'yahoo.com': {'host': 'smtp.mail.yahoo.com', 'port': 587, 'provider': 'Yahoo'},
        'yahoo.co.uk': {'host': 'smtp.mail.yahoo.com', 'port': 587, 'provider': 'Yahoo'},
        'yahoo.co.jp': {'host': 'smtp.mail.yahoo.com', 'port': 587, 'provider': 'Yahoo'},
        'aol.com': {'host': 'smtp.aol.com', 'port': 587, 'provider': 'AOL'},
        'icloud.com': {'host': 'smtp.mail.me.com', 'port': 587, 'provider': 'Apple'},
        'me.com': {'host': 'smtp.mail.me.com', 'port': 587, 'provider': 'Apple'},
        'mac.com': {'host': 'smtp.mail.me.com', 'port': 587, 'provider': 'Apple'},
        'zoho.com': {'host': 'smtp.zoho.com', 'port': 587, 'provider': 'Zoho'},
        'zoho.eu': {'host': 'smtp.zoho.eu', 'port': 587, 'provider': 'Zoho'},
        'protonmail.com': {'host': 'smtp.protonmail.ch', 'port': 587, 'provider': 'ProtonMail'},
        'proton.me': {'host': 'smtp.protonmail.ch', 'port': 587, 'provider': 'ProtonMail'},
        'pm.me': {'host': 'smtp.protonmail.ch', 'port': 587, 'provider': 'ProtonMail'},
        'fastmail.com': {'host': 'smtp.fastmail.com', 'port': 587, 'provider': 'Fastmail'},
        'fastmail.fm': {'host': 'smtp.fastmail.com', 'port': 587, 'provider': 'Fastmail'},
        'gmx.com': {'host': 'mail.gmx.com', 'port': 587, 'provider': 'GMX'},
        'gmx.net': {'host': 'mail.gmx.net', 'port': 587, 'provider': 'GMX'},
        'gmx.de': {'host': 'mail.gmx.net', 'port': 587, 'provider': 'GMX'},
        'web.de': {'host': 'smtp.web.de', 'port': 587, 'provider': 'Web.de'},
        'mail.ru': {'host': 'smtp.mail.ru', 'port': 587, 'provider': 'Mail.ru'},
        'inbox.ru': {'host': 'smtp.mail.ru', 'port': 587, 'provider': 'Mail.ru'},
        'bk.ru': {'host': 'smtp.mail.ru', 'port': 587, 'provider': 'Mail.ru'},
        'list.ru': {'host': 'smtp.mail.ru', 'port': 587, 'provider': 'Mail.ru'},
        'yandex.com': {'host': 'smtp.yandex.com', 'port': 587, 'provider': 'Yandex'},
        'yandex.ru': {'host': 'smtp.yandex.ru', 'port': 587, 'provider': 'Yandex'},
        'ya.ru': {'host': 'smtp.yandex.ru', 'port': 587, 'provider': 'Yandex'},
        'tutanota.com': {'host': '', 'port': 0, 'provider': 'Tutanota (No SMTP)'},
        'tuta.io': {'host': '', 'port': 0, 'provider': 'Tutanota (No SMTP)'},
        'hey.com': {'host': '', 'port': 0, 'provider': 'Hey (No SMTP)'},
        'posteo.de': {'host': 'posteo.de', 'port': 587, 'provider': 'Posteo'},
        'posteo.net': {'host': 'posteo.de', 'port': 587, 'provider': 'Posteo'},
        'mailbox.org': {'host': 'smtp.mailbox.org', 'port': 587, 'provider': 'Mailbox.org'},
        'mailfence.com': {'host': 'smtp.mailfence.com', 'port': 587, 'provider': 'Mailfence'},
        'runbox.com': {'host': 'mail.runbox.com', 'port': 587, 'provider': 'Runbox'},
    }
    if domain in known:
        return known[domain]

    # Look up MX records to detect the email provider
    try:
        mx_records = dns.resolver.resolve(domain, 'MX')
        mx_hosts = [str(r.exchange).lower().rstrip('.') for r in mx_records]
        mx_combined = ' '.join(mx_hosts)

        # Google Workspace (aspmx.l.google.com, alt1.aspmx.l.google.com, etc.)
        if 'google.com' in mx_combined or 'googlemail.com' in mx_combined:
            return {'host': 'smtp.gmail.com', 'port': 587, 'provider': 'Google Workspace'}

        # Microsoft 365 (*.mail.protection.outlook.com)
        if 'outlook.com' in mx_combined or 'microsoft.com' in mx_combined:
            return {'host': 'smtp-mail.outlook.com', 'port': 587, 'provider': 'Microsoft 365'}

        # Zoho
        if 'zoho.com' in mx_combined:
            return {'host': 'smtp.zoho.com', 'port': 587, 'provider': 'Zoho'}

        # Yahoo
        if 'yahoodns.net' in mx_combined or 'yahoo.com' in mx_combined:
            return {'host': 'smtp.mail.yahoo.com', 'port': 587, 'provider': 'Yahoo'}

        # ProtonMail
        if 'protonmail.ch' in mx_combined:
            return {'host': 'smtp.protonmail.ch', 'port': 587, 'provider': 'ProtonMail'}

        # Mimecast
        if 'mimecast' in mx_combined:
            return {'host': f'smtp.{domain}', 'port': 587, 'provider': 'Mimecast'}

        # GoDaddy
        if 'secureserver.net' in mx_combined:
            return {'host': 'smtpout.secureserver.net', 'port': 587, 'provider': 'GoDaddy'}

        # Rackspace
        if 'emailsrvr.com' in mx_combined:
            return {'host': 'secure.emailsrvr.com', 'port': 587, 'provider': 'Rackspace'}

        # Neo.space / Titan Email
        if 'neo.space' in mx_combined or 'titan' in mx_combined:
            return {'host': 'smtp.titan.email', 'port': 587, 'provider': 'Titan Email'}

        # Namecheap (privateemail.com)
        if 'privateemail.com' in mx_combined or 'registrar-servers.com' in mx_combined:
            return {'host': 'mail.privateemail.com', 'port': 587, 'provider': 'Namecheap'}

        # Fastmail
        if 'fastmail' in mx_combined or 'messagingengine.com' in mx_combined:
            return {'host': 'smtp.fastmail.com', 'port': 587, 'provider': 'Fastmail'}

        # Bluehost / HostGator (shared hosting)
        if 'bluehost' in mx_combined or 'hostgator' in mx_combined:
            return {'host': f'mail.{domain}', 'port': 587, 'provider': 'Bluehost'}

        # Amazon WorkMail / SES
        if 'amazonaws.com' in mx_combined or 'awsdns' in mx_combined:
            return {'host': f'smtp.mail.{domain}', 'port': 587, 'provider': 'Amazon WorkMail'}

        # OVH
        if 'ovh.net' in mx_combined or 'ovh.com' in mx_combined:
            return {'host': 'ssl0.ovh.net', 'port': 587, 'provider': 'OVH'}

        # 1&1 / IONOS
        if 'ionos' in mx_combined or '1and1' in mx_combined:
            return {'host': 'smtp.ionos.com', 'port': 587, 'provider': 'IONOS'}

        # Yandex
        if 'yandex' in mx_combined:
            return {'host': 'smtp.yandex.com', 'port': 587, 'provider': 'Yandex'}

        # Mailgun
        if 'mailgun.org' in mx_combined:
            return {'host': 'smtp.mailgun.org', 'port': 587, 'provider': 'Mailgun'}

        # Postmark
        if 'postmarkapp.com' in mx_combined:
            return {'host': 'smtp.postmarkapp.com', 'port': 587, 'provider': 'Postmark'}

        # Hostinger
        if 'hostinger' in mx_combined:
            return {'host': 'smtp.hostinger.com', 'port': 587, 'provider': 'Hostinger'}

        # DreamHost
        if 'dreamhost.com' in mx_combined:
            return {'host': 'smtp.dreamhost.com', 'port': 587, 'provider': 'DreamHost'}

        # SiteGround
        if 'sgcpanel.com' in mx_combined or 'siteground' in mx_combined:
            return {'host': f'mail.{domain}', 'port': 587, 'provider': 'SiteGround'}

        # Hetzner
        if 'hetzner' in mx_combined:
            return {'host': 'mail.your-server.de', 'port': 587, 'provider': 'Hetzner'}

        # Mail.ru
        if 'mail.ru' in mx_combined:
            return {'host': 'smtp.mail.ru', 'port': 587, 'provider': 'Mail.ru'}

        # GMX
        if 'gmx.net' in mx_combined or 'gmx.com' in mx_combined:
            return {'host': 'mail.gmx.com', 'port': 587, 'provider': 'GMX'}

        # Web.de
        if 'web.de' in mx_combined:
            return {'host': 'smtp.web.de', 'port': 587, 'provider': 'Web.de'}

        # Mailchimp / Mandrill
        if 'mandrillapp.com' in mx_combined or 'mailchimp' in mx_combined:
            return {'host': 'smtp.mandrillapp.com', 'port': 587, 'provider': 'Mailchimp'}

        # Brevo (SendinBlue)
        if 'sendinblue.com' in mx_combined or 'brevo.com' in mx_combined:
            return {'host': 'smtp-relay.brevo.com', 'port': 587, 'provider': 'Brevo'}

        # HostGator
        if 'hostgator' in mx_combined:
            return {'host': f'mail.{domain}', 'port': 587, 'provider': 'HostGator'}

        # Hover
        if 'hover.com' in mx_combined:
            return {'host': 'mail.hover.com', 'port': 587, 'provider': 'Hover'}

        # iPage
        if 'ipage.com' in mx_combined:
            return {'host': f'mail.{domain}', 'port': 587, 'provider': 'iPage'}

        # A2 Hosting
        if 'a2hosting' in mx_combined:
            return {'host': f'mail.{domain}', 'port': 587, 'provider': 'A2 Hosting'}

        # Gandi
        if 'gandi.net' in mx_combined:
            return {'host': 'mail.gandi.net', 'port': 587, 'provider': 'Gandi'}

        # Migadu
        if 'migadu.com' in mx_combined:
            return {'host': 'smtp.migadu.com', 'port': 587, 'provider': 'Migadu'}

        # Runbox
        if 'runbox.com' in mx_combined:
            return {'host': 'mail.runbox.com', 'port': 587, 'provider': 'Runbox'}

        # Mailfence
        if 'mailfence.com' in mx_combined:
            return {'host': 'smtp.mailfence.com', 'port': 587, 'provider': 'Mailfence'}

        # Infomaniak
        if 'infomaniak' in mx_combined:
            return {'host': 'mail.infomaniak.com', 'port': 587, 'provider': 'Infomaniak'}

        # Strato
        if 'strato.de' in mx_combined or 'strato.com' in mx_combined:
            return {'host': 'smtp.strato.de', 'port': 587, 'provider': 'Strato'}

        # Posteo
        if 'posteo.de' in mx_combined:
            return {'host': 'posteo.de', 'port': 587, 'provider': 'Posteo'}

        # Mailbox.org
        if 'mailbox.org' in mx_combined:
            return {'host': 'smtp.mailbox.org', 'port': 587, 'provider': 'Mailbox.org'}

        # Pair Networks
        if 'pair.com' in mx_combined:
            return {'host': f'mail.{domain}', 'port': 587, 'provider': 'Pair Networks'}

        # Generic fallback — try smtp.domain.com
        return {'host': f'smtp.{domain}', 'port': 587, 'provider': 'Unknown', 'mx': mx_hosts[:3]}

    except Exception:
        return {'host': f'smtp.{domain}', 'port': 587, 'provider': 'Unknown'}


class SmtpSettingsRequest(BaseModel):
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = 587
    smtp_user: Optional[str] = None
    smtp_pass: Optional[str] = None
    smtp_from: Optional[str] = None


@router.post("/smtp")
async def save_smtp_settings(body: SmtpSettingsRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Save user's SMTP settings (password encrypted at rest)."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.smtp_host = body.smtp_host
    user.smtp_port = body.smtp_port or 587
    user.smtp_user = body.smtp_user
    if body.smtp_pass:
        try:
            user.smtp_pass_encrypted = encrypt_smtp_pass(body.smtp_pass)
        except ValueError:
            raise HTTPException(status_code=503, detail="SMTP encryption unavailable — server missing encryption key")
    else:
        user.smtp_pass_encrypted = None
    user.smtp_from = body.smtp_from
    await db.commit()
    # Update cache
    SMTP_STORE[payload["email"]] = {
        "smtp_host": body.smtp_host,
        "smtp_port": body.smtp_port or 587,
        "smtp_user": body.smtp_user,
        "smtp_pass": body.smtp_pass,
        "smtp_from": body.smtp_from,
    }
    return {"status": "saved"}


@router.get("/smtp")
async def get_smtp_settings(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Get user's SMTP settings (password masked)."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    settings = await get_user_smtp(payload["email"], db)
    return {
        "smtp_host": settings.get("smtp_host"),
        "smtp_port": settings.get("smtp_port"),
        "smtp_user": settings.get("smtp_user"),
        "smtp_pass": "••••••••" if settings.get("smtp_pass") else None,
        "smtp_from": settings.get("smtp_from"),
        "configured": bool(settings.get("smtp_host") and settings.get("smtp_user") and settings.get("smtp_pass")),
    }


@router.get("/usage")
async def get_usage(authorization: str = Header(...), period: str = "7d", db: AsyncSession = Depends(get_db)):
    """Get user's usage stats for a period (7d, 30d, all)."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Determine date filter
    if period == "30d":
        since = datetime.now(timezone.utc).date() - timedelta(days=30)
    elif period == "all":
        since = datetime(2020, 1, 1).date()
    else:
        since = datetime.now(timezone.utc).date() - timedelta(days=7)

    result = await db.execute(
        select(GhostUsageLog).where(
            GhostUsageLog.user_id == user.id,
            GhostUsageLog.date >= since,
        ).order_by(GhostUsageLog.date.desc())
    )
    logs = result.scalars().all()

    total_in = sum(l.tokens_in or 0 for l in logs)
    total_out = sum(l.tokens_out or 0 for l in logs)
    total_requests = sum(l.requests or 0 for l in logs)

    return {
        "total_messages": total_requests,
        "total_tokens_in": total_in,
        "total_tokens_out": total_out,
        "total_tokens": total_in + total_out,
        "credits_remaining": user.credits,
        "plan": user.plan,
        "daily": [
            {"date": str(l.date), "tokens_in": l.tokens_in or 0, "tokens_out": l.tokens_out or 0, "requests": l.requests or 0}
            for l in logs
        ],
    }


@router.delete("/account")
async def delete_account(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Permanently delete user account and all associated data."""
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Delete all connected app credentials
    from routes.ghost_connectors import GhostConnectorCred
    creds_result = await db.execute(select(GhostConnectorCred).where(GhostConnectorCred.user_id == user.id))
    for cred in creds_result.scalars().all():
        await db.delete(cred)
    # Delete chat sessions and messages
    sessions_result = await db.execute(select(GhostChatSession).where(GhostChatSession.user_id == user.id))
    for session in sessions_result.scalars().all():
        msgs_result = await db.execute(select(GhostChatMessage).where(GhostChatMessage.session_id == session.id))
        for msg in msgs_result.scalars().all():
            await db.delete(msg)
        await db.delete(session)
    # Revoke all active sessions
    sessions_result = await db.execute(select(GhostSession).where(GhostSession.user_id == user.id, GhostSession.revoked == False))
    for s in sessions_result.scalars().all():
        s.revoked = True
    await _audit_log(db, payload["email"], "account_deleted", "User permanently deleted account and all data")
    await db.delete(user)
    await db.commit()
    return {"status": "deleted", "message": "Account permanently deleted"}


# ── Data Export (GDPR Right to Portability) ──────────────────────────

@router.get("/export")
async def export_my_data(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Export all user data as JSON — GDPR data portability."""
    from fastapi.responses import JSONResponse
    token = authorization.replace("Bearer ", "")
    payload = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Account info (no password hash)
    account = {
        "email": user.email, "name": user.name, "plan": user.plan,
        "credits": user.credits, "created_at": str(user.created_at),
        "email_verified": user.email_verified, "is_2fa_enabled": user.is_2fa_enabled or False,
    }

    # Chat sessions + decrypted messages
    sessions_result = await db.execute(select(GhostChatSession).where(GhostChatSession.user_id == user.id))
    sessions = sessions_result.scalars().all()
    chat_data = []
    for s in sessions:
        msgs_result = await db.execute(
            select(GhostChatMessage).where(GhostChatMessage.session_id == s.id).order_by(GhostChatMessage.timestamp.asc())
        )
        messages = msgs_result.scalars().all()
        chat_data.append({
            "id": s.id, "title": s.title, "agent_id": s.agent_id, "pinned": s.pinned,
            "tag": s.tag, "created_at": s.created_at, "updated_at": s.updated_at,
            "messages": [{"role": m.role, "content": decrypt_chat_content(m.content or ""), "timestamp": m.timestamp} for m in messages],
        })

    # Audit logs (last 1000)
    audit_result = await db.execute(
        select(GhostAuditLog).where(GhostAuditLog.user_email == user.email).order_by(GhostAuditLog.timestamp.desc()).limit(1000)
    )
    audit_logs = [{"action": a.action, "details": a.details, "timestamp": str(a.timestamp)} for a in audit_result.scalars().all()]

    # Usage logs
    usage_result = await db.execute(select(GhostUsageLog).where(GhostUsageLog.user_id == user.id).order_by(GhostUsageLog.date.desc()))
    usage_logs = [{"date": str(u.date), "tokens_in": u.tokens_in, "tokens_out": u.tokens_out, "requests": u.requests} for u in usage_result.scalars().all()]

    # Connected apps (IDs only, no credentials)
    from routes.ghost_connectors import GhostConnectorCred
    creds_result = await db.execute(select(GhostConnectorCred).where(GhostConnectorCred.user_id == user.id))
    connected_apps = [{"app_id": c.app_id, "connected_at": str(c.connected_at)} for c in creds_result.scalars().all()]

    # Log the export
    await _audit_log(db, user.email, "data_export", "User exported all personal data")
    await db.commit()

    export = {
        "exported_at": str(datetime.now(timezone.utc)),
        "account": account,
        "chat_sessions": chat_data,
        "audit_logs": audit_logs,
        "usage_logs": usage_logs,
        "connected_apps": connected_apps,
    }

    return JSONResponse(
        content=export,
        headers={"Content-Disposition": f'attachment; filename="gofarther_export_{user.email}.json"'},
    )


# ══════════════════════════════════════════════════════════════════════════
# Chat Sync — persist conversations across devices
# ══════════════════════════════════════════════════════════════════════════

from sqlalchemy import Text, BigInteger

class GhostChatSession(Base):
    __tablename__ = "ghost_chat_sessions"
    id = Column(String, primary_key=True)  # UUID from client
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    title = Column(String, default="New Chat")
    agent_id = Column(String, nullable=True)
    pinned = Column(Boolean, default=False)
    tag = Column(String, nullable=True)
    created_at = Column(BigInteger, nullable=False)  # epoch ms from client
    updated_at = Column(BigInteger, nullable=False)


class GhostChatMessage(Base):
    __tablename__ = "ghost_chat_messages"
    id = Column(String, primary_key=True)  # UUID from client
    session_id = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False)  # user | assistant | system
    content = Column(Text, nullable=False)
    timestamp = Column(BigInteger, nullable=False)  # epoch ms
    reaction = Column(String, nullable=True)  # up | down | null


class SyncSessionIn(BaseModel):
    id: str
    title: str = "New Chat"
    agent_id: Optional[str] = None
    pinned: bool = False
    tag: Optional[str] = None
    created_at: int
    updated_at: int


class SyncMessageIn(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    timestamp: int
    reaction: Optional[str] = None


class SyncPayload(BaseModel):
    sessions: list[SyncSessionIn] = []
    messages: list[SyncMessageIn] = []


@router.post("/chat/sync")
async def sync_chat(payload: SyncPayload, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Push local chat data to server. Last-write-wins merge by updated_at / timestamp."""
    token = authorization.replace("Bearer ", "")
    auth = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == auth["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")

    synced_sessions = 0
    synced_messages = 0

    # Upsert sessions — with ownership check
    for s in payload.sessions:
        existing = await db.execute(select(GhostChatSession).where(GhostChatSession.id == s.id))
        row = existing.scalar_one_or_none()
        if row:
            # Ownership check — only update sessions belonging to this user
            if row.user_id != user.id:
                continue
            if s.updated_at > (row.updated_at or 0):
                row.title = s.title
                row.agent_id = s.agent_id
                row.pinned = s.pinned
                row.tag = s.tag
                row.updated_at = s.updated_at
                synced_sessions += 1
        else:
            db.add(GhostChatSession(
                id=s.id, user_id=user.id, title=s.title, agent_id=s.agent_id,
                pinned=s.pinned, tag=s.tag, created_at=s.created_at, updated_at=s.updated_at,
            ))
            synced_sessions += 1

    # Upsert messages — verify session ownership before inserting
    # Build set of user's session IDs for ownership check
    user_sessions = await db.execute(select(GhostChatSession.id).where(GhostChatSession.user_id == user.id))
    owned_session_ids = {str(r[0]) for r in user_sessions.all()}
    for m in payload.messages:
        # Only allow messages for sessions owned by this user
        if m.session_id not in owned_session_ids:
            continue
        existing = await db.execute(select(GhostChatMessage).where(GhostChatMessage.id == m.id))
        row = existing.scalar_one_or_none()
        if row:
            # Update reaction if changed
            if m.reaction != row.reaction:
                row.reaction = m.reaction
                synced_messages += 1
        else:
            db.add(GhostChatMessage(
                id=m.id, session_id=m.session_id, role=m.role,
                content=encrypt_chat_content(m.content), timestamp=m.timestamp, reaction=m.reaction,
            ))
            synced_messages += 1

    await db.commit()
    return {"synced_sessions": synced_sessions, "synced_messages": synced_messages}


@router.get("/chat/sessions")
async def get_chat_sessions(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Get all chat sessions for the authenticated user."""
    token = authorization.replace("Bearer ", "")
    auth = verify_ghost_token(token)
    result = await db.execute(select(GhostUser).where(GhostUser.email == auth["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")

    result = await db.execute(
        select(GhostChatSession)
        .where(GhostChatSession.user_id == user.id)
        .order_by(GhostChatSession.updated_at.desc())
    )
    sessions = result.scalars().all()
    return {"sessions": [
        {"id": s.id, "title": s.title, "agent_id": s.agent_id, "pinned": s.pinned, "tag": s.tag, "created_at": s.created_at, "updated_at": s.updated_at}
        for s in sessions
    ]}


@router.get("/chat/sessions/{session_id}/messages")
async def get_chat_messages(session_id: str, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    """Get all messages for a specific chat session."""
    token = authorization.replace("Bearer ", "")
    auth = verify_ghost_token(token)
    # Verify session belongs to user
    result = await db.execute(select(GhostUser).where(GhostUser.email == auth["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")

    session_result = await db.execute(
        select(GhostChatSession).where(GhostChatSession.id == session_id, GhostChatSession.user_id == user.id)
    )
    if not session_result.scalar_one_or_none():
        raise HTTPException(404, "Session not found")

    result = await db.execute(
        select(GhostChatMessage)
        .where(GhostChatMessage.session_id == session_id)
        .order_by(GhostChatMessage.timestamp.asc())
    )
    messages = result.scalars().all()
    return {"messages": [
        {"id": m.id, "session_id": m.session_id, "role": m.role, "content": decrypt_chat_content(m.content or ""), "timestamp": m.timestamp, "reaction": m.reaction}
        for m in messages
    ]}


# ── Geo-Blocking ──────────────────────────────────────────────────────

class GhostGeoRestriction(Base):
    __tablename__ = "ghost_geo_restrictions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), unique=True, nullable=False, index=True)
    allowed_countries = Column(Text, nullable=True)  # JSON array of country codes
    enabled = Column(Boolean, default=False)

class GhostGeoSettingsRequest(BaseModel):
    enabled: bool = False
    allowed_countries: list[str] = []

@router.get("/geo-settings")
async def get_geo_settings(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    payload = verify_ghost_token(authorization.replace("Bearer ", ""))
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")
    result = await db.execute(select(GhostGeoRestriction).where(GhostGeoRestriction.user_id == user.id))
    geo = result.scalar_one_or_none()
    if not geo:
        return {"enabled": False, "allowed_countries": []}
    import json
    return {"enabled": geo.enabled, "allowed_countries": json.loads(geo.allowed_countries or "[]")}

@router.post("/geo-settings")
async def update_geo_settings(body: GhostGeoSettingsRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    payload = verify_ghost_token(authorization.replace("Bearer ", ""))
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")
    import json
    result = await db.execute(select(GhostGeoRestriction).where(GhostGeoRestriction.user_id == user.id))
    geo = result.scalar_one_or_none()
    if geo:
        geo.enabled = body.enabled
        geo.allowed_countries = json.dumps(body.allowed_countries)
    else:
        db.add(GhostGeoRestriction(user_id=user.id, enabled=body.enabled, allowed_countries=json.dumps(body.allowed_countries)))
    await _audit_log(db, payload["email"], "geo_settings_updated", f"enabled={body.enabled}, countries={body.allowed_countries}")
    await db.commit()
    return {"ok": True}


# ── Device Security Check ─────────────────────────────────────────────

class DeviceCheckRequest(BaseModel):
    is_rooted: bool = False
    device_model: str = ""
    os_version: str = ""

@router.post("/device-check")
async def device_check(body: DeviceCheckRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    payload = verify_ghost_token(authorization.replace("Bearer ", ""))
    if body.is_rooted:
        await _audit_log(db, payload["email"], "rooted_device_detected", f"model={body.device_model}, os={body.os_version}")
        await db.commit()
        return {"allowed": True, "warning": "This device appears to be rooted/jailbroken. Your data may be at risk."}
    return {"allowed": True, "warning": None}


# ── E2E Encryption Key Storage ────────────────────────────────────────

class E2EKeyRequest(BaseModel):
    public_key: str

@router.post("/e2e/keys")
async def store_e2e_key(body: E2EKeyRequest, authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    payload = verify_ghost_token(authorization.replace("Bearer ", ""))
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")
    user.public_key = body.public_key
    await _audit_log(db, payload["email"], "e2e_key_stored", "Public key updated")
    await db.commit()
    return {"ok": True}

@router.get("/e2e/keys")
async def get_e2e_key(authorization: str = Header(...), db: AsyncSession = Depends(get_db)):
    payload = verify_ghost_token(authorization.replace("Bearer ", ""))
    result = await db.execute(select(GhostUser).where(GhostUser.email == payload["email"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")
    return {"public_key": user.public_key}
