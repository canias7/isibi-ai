from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import UUID as pgUUID, JSONB

from db import Base


class AppEmbed(Base):
    __tablename__ = "app_embeds"

    id = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(pgUUID(as_uuid=True), nullable=False, index=True)
    org_id = Column(pgUUID(as_uuid=True), nullable=False, index=True)
    type = Column(String(50), nullable=False)  # form, table, chart, stat_card
    entity = Column(String(200), nullable=False)
    config = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
