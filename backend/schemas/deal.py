from __future__ import annotations
from datetime import datetime, date
from enum import Enum
from uuid import UUID
from pydantic import BaseModel, Field


class DealStatus(str, Enum):
    open = "open"
    won = "won"
    lost = "lost"
    stalled = "stalled"


class DealCreate(BaseModel):
    title: str = Field(max_length=255)
    lead_id: UUID | None = None
    stage_id: UUID
    assigned_to: UUID | None = None
    value: float = Field(default=0, ge=0)
    probability: int = Field(default=50, ge=0, le=100)
    expected_close_date: date | None = None
    status: DealStatus = DealStatus.open


class DealUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    lead_id: UUID | None = None
    stage_id: UUID | None = None
    assigned_to: UUID | None = None
    value: float | None = Field(default=None, ge=0)
    probability: int | None = Field(default=None, ge=0, le=100)
    expected_close_date: date | None = None
    status: DealStatus | None = None
    lost_reason: str | None = None
    version: int


class DealRead(BaseModel):
    id: UUID
    org_id: UUID
    title: str
    lead_id: UUID | None
    stage_id: UUID
    assigned_to: UUID | None
    value: float
    probability: int
    expected_close_date: date | None
    status: DealStatus
    lost_reason: str | None
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = {"from_attributes": True}
