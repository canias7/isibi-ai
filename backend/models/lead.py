from __future__ import annotations
from typing import Optional
import uuid
from datetime import datetime
from sqlalchemy import (
    String, Text, SmallInteger, Integer, Numeric, DateTime, Enum as PgEnum,
    ForeignKey, ARRAY, text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db import Base

lead_status = PgEnum(
    "new", "contacted", "qualified", "negotiating", "converted", "lost",
    name="lead_status", create_type=True,
)
lead_source = PgEnum(
    "website", "referral", "cold_call", "social_media", "advertisement", "walk_in", "other",
    name="lead_source", create_type=True,
)
priority_level = PgEnum("low", "medium", "high", "urgent", name="priority_level", create_type=True)


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    status: Mapped[str] = mapped_column(lead_status, nullable=False, server_default="new")
    source: Mapped[str] = mapped_column(lead_source, nullable=False, server_default="other")
    priority: Mapped[str] = mapped_column(priority_level, nullable=False, server_default="medium")
    assigned_to: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default=text("'{}'"))
    budget: Mapped[Optional[float]] = mapped_column(Numeric(15, 2), nullable=True)
    lead_score: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_contacted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    converted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    custom_fields: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))

    tasks = relationship("Task", back_populates="lead", cascade="all, delete-orphan")
    deals = relationship("Deal", back_populates="lead")
    conversations = relationship("Conversation", back_populates="lead", cascade="all, delete-orphan")
    assignee = relationship("User", foreign_keys=[assigned_to])
