from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, text
from sqlalchemy.dialects.postgresql import UUID as pgUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        pgUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        pgUUID(as_uuid=True), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        pgUUID(as_uuid=True), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(
        String(100), nullable=False, index=True
    )
    entity_type: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        pgUUID(as_uuid=True), nullable=True
    )
    details: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True
    )
    ip_address: Mapped[Optional[str]] = mapped_column(
        String(45), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()")
    )
