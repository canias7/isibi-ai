from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Text, DateTime, BigInteger, ForeignKey
from sqlalchemy.dialects.postgresql import UUID as pgUUID
from sqlalchemy.orm import Mapped

from db import Base


class FileUpload(Base):
    __tablename__ = "file_uploads"

    id = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(pgUUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    org_id = Column(pgUUID(as_uuid=True), nullable=False, index=True)

    file_name = Column(String(500), nullable=False)
    file_key = Column(String(1000), nullable=False)  # e.g. uploads/{project_id}/{uuid}_{filename}
    file_url = Column(String(1000), nullable=False)
    file_type: Mapped[Optional[str]] = Column(String(200), nullable=True)
    file_size = Column(BigInteger, nullable=False, default=0)

    file_data = Column(Text, nullable=True)  # base64-encoded file content for cloud storage

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
