from __future__ import annotations

"""
GhostScheduledTask — user-scoped scheduled tasks for the GoFarther AI mobile app.

These are the tasks users create in the mobile app's Scheduled screen. Unlike
ScheduledCommand (which is project-scoped), these belong to a ghost_user and
run on the backend scheduler so they fire reliably even when the phone is
locked or backgrounded.
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, String, Boolean, DateTime, Text, text
from sqlalchemy.dialects.postgresql import UUID

from db import Base


class GhostScheduledTask(Base):
    __tablename__ = "ghost_scheduled_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Stable client-generated id so mobile → server sync is idempotent
    client_id = Column(String, nullable=False, index=True)
    user_email = Column(String, nullable=False, index=True)

    label = Column(String, nullable=False)
    command = Column(Text, nullable=False)

    # Agent metadata (denormalized so the backend executor doesn't need a separate Agent table)
    agent_id = Column(String, nullable=True)
    agent_name = Column(String, nullable=True)
    agent_system_prompt = Column(Text, nullable=True)

    # "days|H:M" or "once|M/D/Y|H:M" — hours/minutes are in the user's local time
    schedule = Column(String, nullable=False)
    # IANA timezone string (e.g. "America/Los_Angeles"). Defaults to UTC if the
    # mobile client doesn't send one (older app versions).
    timezone = Column(String(64), nullable=False, default="UTC", server_default=text("'UTC'"))
    enabled = Column(Boolean, default=True, nullable=False)

    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_result = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.utcnow(), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.utcnow(), server_default=text("NOW()"), onupdate=lambda: datetime.utcnow())
