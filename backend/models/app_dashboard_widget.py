from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, DateTime, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class AppDashboardWidget(Base):
    __tablename__ = "app_dashboard_widgets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False)  # stat_card, bar_chart, line_chart, pie_chart, recent_items, calendar, todo_list, funnel, goal_progress
    entity: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    config: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True, server_default=text("'{}'::jsonb"))
    position: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    width: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, server_default=text("'full'"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
