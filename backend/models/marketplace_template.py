from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Text, Integer, Float, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID as pgUUID, JSONB, ARRAY
from sqlalchemy.orm import Mapped

from db import Base


class MarketplaceTemplate(Base):
    __tablename__ = "marketplace_templates"

    id = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    author_id = Column(pgUUID(as_uuid=True), nullable=False, index=True)
    project_id = Column(pgUUID(as_uuid=True), nullable=False)
    title = Column(String(300), nullable=False)
    description: Mapped[Optional[str]] = Column(Text, nullable=True)
    category: Mapped[Optional[str]] = Column(String(100), nullable=True, index=True)
    price = Column(Float, nullable=False, default=0.0)
    spec = Column(JSONB, nullable=False)
    preview_images = Column(JSONB, nullable=True, default=list)  # list of image URLs
    rating_avg = Column(Float, nullable=False, default=0.0)
    rating_count = Column(Integer, nullable=False, default=0)
    purchases = Column(Integer, nullable=False, default=0)
    is_published = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class MarketplaceRating(Base):
    __tablename__ = "marketplace_ratings"

    id = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id = Column(pgUUID(as_uuid=True), nullable=False, index=True)
    user_id = Column(pgUUID(as_uuid=True), nullable=False)
    rating = Column(Integer, nullable=False)  # 1-5
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
