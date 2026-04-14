from __future__ import annotations
from typing import Optional
import uuid
from datetime import datetime
from sqlalchemy import (
    String, Integer, Boolean, DateTime, Enum as PgEnum, ForeignKey, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db import Base
from models.lead import priority_level

task_status = PgEnum(
    "pending", "in_progress", "completed", "overdue", "cancelled",
    name="task_status", create_type=True,
)
task_type = PgEnum(
    "call", "email", "meeting", "follow_up", "document", "other",
    name="task_type", create_type=True,
)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(task_status, nullable=False, server_default="pending")
    priority: Mapped[str] = mapped_column(priority_level, nullable=False, server_default="medium")
    type: Mapped[str] = mapped_column(task_type, nullable=False, server_default="other")
    assigned_to: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), nullable=True)
    deal_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("deals.id", ondelete="CASCADE"), nullable=True)
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    reminder_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_automated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("FALSE"))
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))

    lead = relationship("Lead", back_populates="tasks")
    deal = relationship("Deal", back_populates="tasks")
    assignee = relationship("User", foreign_keys=[assigned_to])
