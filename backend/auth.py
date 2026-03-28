from __future__ import annotations
import os
from uuid import UUID
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
if JWT_SECRET == "change-me-in-production" and os.getenv("RENDER"):
    raise RuntimeError("JWT_SECRET must be explicitly set in production — refusing to start with default value")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
_ALLOWED_ALGORITHMS = {"HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "ES256", "ES384", "ES512"}
if JWT_ALGORITHM.lower() == "none" or JWT_ALGORITHM not in _ALLOWED_ALGORITHMS:
    raise RuntimeError(f"JWT_ALGORITHM must be one of {_ALLOWED_ALGORITHMS}, got: {JWT_ALGORITHM!r}")

security = HTTPBearer()


async def get_current_org_id(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> UUID:
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
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
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing sub in token")
        return UUID(user_id)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
