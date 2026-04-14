from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Integer, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID as pgUUID
from sqlalchemy.orm import Mapped

from db import Base


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(pgUUID(as_uuid=True), nullable=False, unique=True, index=True)
    plan = Column(String(50), nullable=False, default="free")  # free, pro, teams
    stripe_customer_id: Mapped[Optional[str]] = Column(String(255), nullable=True)
    stripe_subscription_id: Mapped[Optional[str]] = Column(String(255), nullable=True)
    status = Column(String(50), nullable=False, default="active")  # active, canceled, past_due
    builds_used = Column(Integer, nullable=False, default=0)
    builds_limit = Column(Integer, nullable=False, default=3)  # free=3, pro=unlimited(-1), teams=unlimited(-1)
    current_period_end: Mapped[Optional[datetime]] = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
