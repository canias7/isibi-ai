from __future__ import annotations
from typing import Optional
import uuid
from datetime import datetime
from sqlalchemy import (
    Integer, DateTime, Enum as PgEnum, ForeignKey, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db import Base

conversation_channel = PgEnum("email", "sms", "internal", "chat", name="conversation_channel", create_type=True)
conversation_status = PgEnum("open", "closed", "pending", name="conversation_status", create_type=True)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    lead_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    channel: Mapped[str] = mapped_column(conversation_channel, nullable=False)
    status: Mapped[str] = mapped_column(conversation_status, nullable=False, server_default="open")
    assigned_to: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    last_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))

    lead = relationship("Lead", back_populates="conversations")
    assignee = relationship("User", foreign_keys=[assigned_to])
