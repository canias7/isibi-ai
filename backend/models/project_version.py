from __future__ import annotations
"""
ProjectVersion model — stores version snapshots of project specs.

Each time a spec is generated or refined, a version snapshot is saved
so users can browse history and restore previous versions.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Text, DateTime, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID as pgUUID, JSONB
from sqlalchemy.orm import Mapped

from db import Base


class ProjectVersion(Base):
    __tablename__ = "project_versions"

    id: Mapped[str] = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[str] = Column(pgUUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    org_id: Mapped[str] = Column(pgUUID(as_uuid=True), nullable=False)
    version_number: Mapped[int] = Column(Integer, nullable=False)
    spec_snapshot: Mapped[dict] = Column(JSONB, nullable=False)
    change_description: Mapped[Optional[str]] = Column(Text, nullable=True)
    created_at: Mapped[datetime] = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
