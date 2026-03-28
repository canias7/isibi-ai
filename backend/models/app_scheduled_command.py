from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Boolean, DateTime, Text, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class AppScheduledCommand(Base):
    __tablename__ = "app_scheduled_commands"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)  # app user who created it
    command: Mapped[str] = mapped_column(String(500), nullable=False)  # "give me a report of all income today"
    schedule_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "daily", "weekly", "monthly", "once"
    schedule_time: Mapped[str] = mapped_column(String(10), nullable=False)  # "17:00" (24h format)
    schedule_day: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # "monday" for weekly, "1" for monthly
    timezone: Mapped[str] = mapped_column(String(50), nullable=False, server_default=text("'UTC'"))
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_result: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # last command output
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
