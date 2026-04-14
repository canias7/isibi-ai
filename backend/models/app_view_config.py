from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID as pgUUID, JSONB

from db import Base


class AppViewConfig(Base):
    __tablename__ = "app_view_configs"

    id = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(pgUUID(as_uuid=True), nullable=False, index=True)
    org_id = Column(pgUUID(as_uuid=True), nullable=False, index=True)
    entity = Column(String(200), nullable=False)
    view_type = Column(String(50), nullable=False)  # gantt, map, timeline, gallery, tree, comparison, print_template, qr_display
    config = Column(JSONB, nullable=False, default=dict)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
