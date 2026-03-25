from __future__ import annotations
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    prompt: str = Field(..., min_length=5, max_length=2000, description="What do you want to build?")
    name: str | None = Field(None, max_length=200, description="Optional project name")


class ProjectRefine(BaseModel):
    feedback: str = Field(..., min_length=3, max_length=2000, description="What to change or add")


class ProjectResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    org_id: UUID
    user_id: UUID
    name: str
    description: str | None = None
    status: str
    prompt: str
    spec: dict | None = None
    build_path: str | None = None
    conversation_history: list[dict] | None = None
    version: int
    created_at: datetime
    updated_at: datetime


class ProjectListItem(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    name: str
    status: str
    prompt: str
    created_at: datetime
    updated_at: datetime
