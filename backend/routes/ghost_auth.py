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
from sqlalchemy import select, Column, String, Integer, Boolean, DateTime, Date, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import UUID

from db import get_db, Base
from services.email import send_verification_email, send_password_reset_email
import time
import hashlib

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
    return plaintext  # fallback: store as-is if no key configured

def decrypt_smtp_pass(ciphertext: str) -> str:
    if _fernet:
        try:
            return _fernet.decrypt(ciphertext.encode()).decode()
        except Exception:
            return ciphertext  # fallback if decryption fails
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
    # SMTP settings (password encrypted with Fernet)
    smtp_host = Column(String, nullable=True)
    smtp_port = Column(Integer, nullable=True)
    smtp_user = Column(String, nullable=True)
    smtp_pass_encrypted = Column(String, nullable=True)
    smtp_from = Column(String, nullable=True)

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


# Runtime cache for SMTP lookups (populated from DB on first access)
SMTP_STORE: dict[str, dict] = {}


async def get_user_smtp(email: str, db: AsyncSession) -> dict:
    """Get user's SMTP settings from cache or DB. Returns decrypted password."""
    if email in SMTP_STORE:
        return SMTP_STORE[email]
    result = await db.execute(select(GhostUser).where(GhostUser.email == email))
    user = result.scalar_one_or_none()
    if user and user.smtp_host and user.smtp_user and user.smtp_pass_encrypted:
        settings = {
            "smtp_host": user.smtp_host,
            "smtp_port": user.smtp_port or 587,
            "smtp_user": user.smtp_user,
            "smtp_pass": decrypt_smtp_pass(user.smtp_pass_encrypted),
            "smtp_from": user.smtp_from,
        }
        SMTP_STORE[email] = settings
        return settings
    return {}


@router.get("/detect-smtp/{email}")
async def detect_smtp(email: str):
    """Auto-detect SMTP settings from email domain via MX records."""
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
    user.smtp_pass_encrypted = encrypt_smtp_pass(body.smtp_pass) if body.smtp_pass else None
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
    await db.delete(user)
    await db.commit()
    return {"status": "deleted", "message": "Account permanently deleted"}
