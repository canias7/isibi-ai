from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, Integer, DateTime, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class AppDeadlineReminder(Base):
    __tablename__ = "app_deadline_reminders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    entity: Mapped[str] = mapped_column(String(200), nullable=False)
    date_field: Mapped[str] = mapped_column(String(200), nullable=False)
    remind_days_before: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("2"))
    notify_field: Mapped[str] = mapped_column(String(200), nullable=False)
    message_template: Mapped[str] = mapped_column(String(1000), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
