from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID as pgUUID, JSONB
from sqlalchemy.orm import Mapped

from db import Base


class DesignImport(Base):
    __tablename__ = "design_imports"

    id = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(pgUUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    org_id = Column(pgUUID(as_uuid=True), nullable=False, index=True)

    file_name = Column(String(500), nullable=False)
    file_url = Column(String(1000), nullable=False)
    description: Mapped[Optional[str]] = Column(Text, nullable=True)
    status = Column(String(50), nullable=False, default="uploaded")
    # status: uploaded -> processing -> completed -> failed

    generated_spec_fragment: Mapped[Optional[dict]] = Column(JSONB, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
