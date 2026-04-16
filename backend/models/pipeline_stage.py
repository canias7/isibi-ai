from __future__ import annotations
from typing import Optional
import uuid
from datetime import datetime
from sqlalchemy import (
    String, Integer, Boolean, DateTime, text, CHAR,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db import Base


class PipelineStage(Base):
    __tablename__ = "pipeline_stages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    stage_order: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    color: Mapped[Optional[str]] = mapped_column(CHAR(6), nullable=True)
    is_won: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("FALSE"))
    is_lost: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("FALSE"))
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))

    deals = relationship("Deal", back_populates="stage")
