from __future__ import annotations

"""
Stripe integration routes — allow generated apps to accept payments.

Endpoints:
  POST /api/apps/{project_id}/stripe/setup     — save Stripe secret key
  POST /api/apps/{project_id}/stripe/checkout   — create Checkout Session
  POST /api/apps/{project_id}/stripe/webhook     — handle Stripe webhook events
"""

import os
import uuid
from base64 import b64decode, b64encode
from typing import Optional

import stripe
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db
from models.project import Project
from models.stripe_config import StripeConfig

router = APIRouter(prefix="/apps", tags=["stripe"])

# ---------------------------------------------------------------------------
# Encryption helpers — use FERNET_KEY env var; fall back to a generated key
# (in production the env var MUST be set so keys survive restarts).
# ---------------------------------------------------------------------------
_FERNET_KEY = os.getenv("FERNET_KEY")
if _FERNET_KEY:
    _fernet = Fernet(_FERNET_KEY.encode())
else:
    _fernet = Fernet(Fernet.generate_key())


def _encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def _decrypt(token: str) -> str:
    return _fernet.decrypt(token.encode()).decode()


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class StripeSetupRequest(BaseModel):
    stripe_secret_key: str


class CheckoutRequest(BaseModel):
    price_id: str
    success_url: str
    cancel_url: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/{project_id}/stripe/setup")
async def stripe_setup(
    project_id: str,
    body: StripeSetupRequest,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Save an encrypted Stripe secret key for a project."""
    pid = uuid.UUID(project_id)

    # Verify the project belongs to this org
    result = await db.execute(
        select(Project).where(
            Project.id == pid,
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # Validate the key by making a lightweight Stripe call
    try:
        stripe.api_key = body.stripe_secret_key
        stripe.Account.retrieve()
    except stripe.error.AuthenticationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Stripe secret key",
        )

    # Upsert
    result = await db.execute(
        select(StripeConfig).where(StripeConfig.project_id == pid)
    )
    config = result.scalar_one_or_none()

    if config:
        config.stripe_key_encrypted = _encrypt(body.stripe_secret_key)
        config.is_active = True
    else:
        config = StripeConfig(
            project_id=pid,
            org_id=org_id,
            stripe_key_encrypted=_encrypt(body.stripe_secret_key),
            is_active=True,
        )
        db.add(config)

    await db.commit()
    await db.refresh(config)

    return {
        "id": str(config.id),
        "project_id": str(config.project_id),
        "is_active": config.is_active,
        "created_at": config.created_at.isoformat(),
    }


@router.post("/{project_id}/stripe/checkout")
async def stripe_checkout(
    project_id: str,
    body: CheckoutRequest,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """Create a Stripe Checkout Session for the project."""
    pid = uuid.UUID(project_id)

    result = await db.execute(
        select(StripeConfig).where(
            StripeConfig.project_id == pid,
            StripeConfig.org_id == org_id,
            StripeConfig.is_active.is_(True),
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stripe is not configured for this project",
        )

    secret_key = _decrypt(config.stripe_key_encrypted)
    stripe.api_key = secret_key

    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{"price": body.price_id, "quantity": 1}],
            success_url=body.success_url,
            cancel_url=body.cancel_url,
        )
    except stripe.error.InvalidRequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stripe error: {exc.user_message or str(exc)}",
        )

    return {
        "checkout_session_id": session.id,
        "url": session.url,
    }


@router.post("/{project_id}/stripe/webhook")
async def stripe_webhook(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Handle incoming Stripe webhook events."""
    pid = uuid.UUID(project_id)

    result = await db.execute(
        select(StripeConfig).where(
            StripeConfig.project_id == pid,
            StripeConfig.is_active.is_(True),
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stripe is not configured for this project",
        )

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    # If a webhook secret is stored, verify the signature
    if config.webhook_secret:
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, config.webhook_secret
            )
        except (ValueError, stripe.error.SignatureVerificationError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid webhook signature",
            )
    else:
        # No webhook secret configured — parse the payload directly
        import json
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid payload",
            )

    # ---- Handle specific event types ----
    event_type = event.get("type") if isinstance(event, dict) else event.type

    if event_type == "checkout.session.completed":
        # Payment succeeded — downstream logic goes here
        pass
    elif event_type == "payment_intent.succeeded":
        pass
    elif event_type == "payment_intent.payment_failed":
        pass

    return {"status": "ok", "event_type": event_type}
