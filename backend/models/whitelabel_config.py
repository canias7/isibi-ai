from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID as pgUUID
from sqlalchemy.orm import Mapped

from db import Base


class WhitelabelConfig(Base):
    __tablename__ = "whitelabel_configs"

    id = Column(pgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(pgUUID(as_uuid=True), nullable=False, unique=True, index=True)
    brand_name = Column(String(200), nullable=False)
    logo_url: Mapped[Optional[str]] = Column(String(1000), nullable=True)
    primary_color = Column(String(7), nullable=False, default="#000000")
    custom_domain: Mapped[Optional[str]] = Column(String(255), nullable=True)
    hide_isibi_branding = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
