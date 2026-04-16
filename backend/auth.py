from __future__ import annotations
import os
from uuid import UUID
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import logging
from jose import JWTError, jwt

_logger = logging.getLogger(__name__)

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
if JWT_SECRET == "change-me-in-production" and os.getenv("RENDER"):
    raise RuntimeError("CRITICAL: JWT_SECRET must be set to a secure random value in production!")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
_ALLOWED_ALGORITHMS = {"HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "ES256", "ES384", "ES512"}
if JWT_ALGORITHM.lower() == "none" or JWT_ALGORITHM not in _ALLOWED_ALGORITHMS:
    raise RuntimeError(f"JWT_ALGORITHM must be one of {_ALLOWED_ALGORITHMS}, got: {JWT_ALGORITHM!r}")

# ── Secret rotation: support old secrets during transition ────────────────
# Set JWT_SECRETS_OLD="old-secret-1,old-secret-2" in env to keep old tokens valid
_OLD_SECRETS_RAW = os.getenv("JWT_SECRETS_OLD", "")
JWT_SECRETS_OLD: list[str] = [s.strip() for s in _OLD_SECRETS_RAW.split(",") if s.strip()]
if JWT_SECRETS_OLD:
    _logger.info("JWT secret rotation: %d old secret(s) configured", len(JWT_SECRETS_OLD))


def _decode_token(token: str) -> dict:
    """Decode a JWT token, trying the current secret first, then old secrets.

    This allows seamless secret rotation:
    1. Set new JWT_SECRET in env
    2. Move old secret to JWT_SECRETS_OLD
    3. Old tokens still work until they expire
    4. New tokens use the new secret
    """
    # Try current secret first
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        pass

    # Try old secrets for rotation
    for old_secret in JWT_SECRETS_OLD:
        try:
            return jwt.decode(token, old_secret, algorithms=[JWT_ALGORITHM])
        except JWTError:
            continue

    # All secrets failed
    raise JWTError("Token could not be verified with any configured secret")


security = HTTPBearer()


async def get_current_org_id(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> UUID:
    try:
        payload = _decode_token(credentials.credentials)
        org_id = payload.get("org_id")
        if org_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing org_id in token")
        return UUID(org_id)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> UUID:
    try:
        payload = _decode_token(credentials.credentials)
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing sub in token")
        return UUID(user_id)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
