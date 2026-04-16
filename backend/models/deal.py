from __future__ import annotations
from typing import Optional
import uuid
from datetime import datetime, date
from sqlalchemy import (
    String, Text, SmallInteger, Integer, Numeric, DateTime, Date,
    Enum as PgEnum, ForeignKey, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db import Base

deal_status = PgEnum("open", "won", "lost", "stalled", name="deal_status", create_type=True)


class Deal(Base):
    __tablename__ = "deals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    stage_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pipeline_stages.id", ondelete="RESTRICT"), nullable=False)
    assigned_to: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    value: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, server_default=text("0"))
    probability: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("50"))
    expected_close_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(deal_status, nullable=False, server_default="open")
    lost_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))

    lead = relationship("Lead", back_populates="deals")
    stage = relationship("PipelineStage", back_populates="deals")
    tasks = relationship("Task", back_populates="deal", cascade="all, delete-orphan")
    assignee = relationship("User", foreign_keys=[assigned_to])
