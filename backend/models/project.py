from __future__ import annotations
"""
Project model — stores generated specs per user.

Each project = one generated app (e.g. "Real Estate CRM", "Restaurant Manager").
The spec JSON is stored in the database and served to the frontend via GET /api/spec.
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, DateTime, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID as pgUUID, JSONB
from db import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(pgUUID(as_uuid=True), nullable=False, index=True)
    user_id = Column(pgUUID(as_uuid=True), nullable=False, index=True)

    # Project metadata
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="generating")
    # status: generating → ready → building → deployed → error

    # The user's original prompt
    prompt = Column(Text, nullable=False)

    # The AI-generated spec (full JSON)
    spec = Column(JSONB, nullable=True)

    # Build output path (where the generated backend code lives)
    build_path = Column(String(500), nullable=True)

    # Conversation history for multi-turn refinement
    conversation_history = Column(JSONB, nullable=True, default=list)

    # Standard fields
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
