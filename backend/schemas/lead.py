from __future__ import annotations
from datetime import datetime
from enum import Enum
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


class LeadStatus(str, Enum):
    new = "new"
    contacted = "contacted"
    qualified = "qualified"
    negotiating = "negotiating"
    converted = "converted"
    lost = "lost"


class LeadSource(str, Enum):
    website = "website"
    referral = "referral"
    cold_call = "cold_call"
    social_media = "social_media"
    advertisement = "advertisement"
    walk_in = "walk_in"
    other = "other"


class Priority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"


class LeadCreate(BaseModel):
    first_name: str = Field(max_length=100)
    last_name: str = Field(max_length=100)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    status: LeadStatus = LeadStatus.new
    source: LeadSource = LeadSource.other
    priority: Priority = Priority.medium
    assigned_to: UUID | None = None
    tags: list[str] = Field(default_factory=list)
    budget: float | None = Field(default=None, ge=0)
    lead_score: int = Field(default=0, ge=0, le=100)
    notes: str | None = None
    custom_fields: dict = Field(default_factory=dict)


class LeadUpdate(BaseModel):
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    status: LeadStatus | None = None
    source: LeadSource | None = None
    priority: Priority | None = None
    assigned_to: UUID | None = None
    tags: list[str] | None = None
    budget: float | None = Field(default=None, ge=0)
    lead_score: int | None = Field(default=None, ge=0, le=100)
    notes: str | None = None
    custom_fields: dict | None = None
    version: int


class LeadRead(BaseModel):
    id: UUID
    org_id: UUID
    first_name: str
    last_name: str
    email: str | None
    phone: str | None
    status: LeadStatus
    source: LeadSource
    priority: Priority
    assigned_to: UUID | None
    tags: list[str]
    budget: float | None
    lead_score: int
    notes: str | None
    last_contacted_at: datetime | None
    converted_at: datetime | None
    custom_fields: dict
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = {"from_attributes": True}
