from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Text, Integer, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID as pgUUID, JSONB
from sqlalchemy.orm import Mapped

from db import Base


class Template(Base):
    __tablename__ = "templates"

    id = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    description: Mapped[Optional[str]] = Column(Text, nullable=True)
    category: Mapped[Optional[str]] = Column(String(100), nullable=True)  # crm, ecommerce, saas, restaurant, fitness, etc.
    spec = Column(JSONB, nullable=False)  # the full spec
    preview_image_url: Mapped[Optional[str]] = Column(String(1000), nullable=True)
    author_id: Mapped[Optional[uuid.UUID]] = Column(pgUUID(as_uuid=True), nullable=True)
    is_official = Column(Boolean, nullable=False, default=False)
    is_public = Column(Boolean, nullable=False, default=True)
    use_count = Column(Integer, nullable=False, default=0)
    price = Column(Integer, nullable=False, default=0)  # in cents, 0 = free
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
