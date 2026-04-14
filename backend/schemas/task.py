from __future__ import annotations
from datetime import datetime
from enum import Enum
from uuid import UUID
from pydantic import BaseModel, Field
from schemas.lead import Priority


class TaskStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    overdue = "overdue"
    cancelled = "cancelled"


class TaskType(str, Enum):
    call = "call"
    email = "email"
    meeting = "meeting"
    follow_up = "follow_up"
    document = "document"
    other = "other"


class TaskCreate(BaseModel):
    title: str = Field(max_length=255)
    status: TaskStatus = TaskStatus.pending
    priority: Priority = Priority.medium
    type: TaskType = TaskType.other
    assigned_to: UUID | None = None
    lead_id: UUID | None = None
    deal_id: UUID | None = None
    due_date: datetime | None = None
    reminder_at: datetime | None = None
    is_automated: bool = False


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    status: TaskStatus | None = None
    priority: Priority | None = None
    type: TaskType | None = None
    assigned_to: UUID | None = None
    lead_id: UUID | None = None
    deal_id: UUID | None = None
    due_date: datetime | None = None
    reminder_at: datetime | None = None
    completed_at: datetime | None = None
    is_automated: bool | None = None
    version: int


class TaskRead(BaseModel):
    id: UUID
    org_id: UUID
    title: str
    status: TaskStatus
    priority: Priority
    type: TaskType
    assigned_to: UUID | None
    lead_id: UUID | None
    deal_id: UUID | None
    due_date: datetime | None
    reminder_at: datetime | None
    completed_at: datetime | None
    is_automated: bool
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = {"from_attributes": True}
