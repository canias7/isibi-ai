from __future__ import annotations
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class PipelineStageCreate(BaseModel):
    name: str = Field(max_length=100)
    stage_order: int | None = None
    color: str | None = Field(default=None, max_length=6)
    is_won: bool = False
    is_lost: bool = False


class PipelineStageUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    stage_order: int | None = None
    color: str | None = Field(default=None, max_length=6)
    is_won: bool | None = None
    is_lost: bool | None = None
    version: int


class PipelineStageRead(BaseModel):
    id: UUID
    org_id: UUID
    name: str
    stage_order: int | None
    color: str | None
    is_won: bool
    is_lost: bool
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = {"from_attributes": True}
