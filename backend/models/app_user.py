from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as pgUUID
from sqlalchemy.orm import Mapped

from db import Base


class AppUser(Base):
    __tablename__ = "app_users"

    id = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(pgUUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)

    email = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    display_name: Mapped[Optional[str]] = Column(String(200), nullable=True)
    role = Column(String(50), nullable=False, default="user")
    is_active = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("email", "project_id", name="uq_app_users_email_project"),
    )
