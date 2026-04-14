from __future__ import annotations
from datetime import datetime
from enum import Enum
from uuid import UUID
from pydantic import BaseModel


class Channel(str, Enum):
    email = "email"
    sms = "sms"
    internal = "internal"
    chat = "chat"


class ConversationStatus(str, Enum):
    open = "open"
    closed = "closed"
    pending = "pending"


class ConversationCreate(BaseModel):
    lead_id: UUID
    channel: Channel
    status: ConversationStatus = ConversationStatus.open
    assigned_to: UUID | None = None


class ConversationUpdate(BaseModel):
    channel: Channel | None = None
    status: ConversationStatus | None = None
    assigned_to: UUID | None = None
    last_message_at: datetime | None = None
    version: int


class ConversationRead(BaseModel):
    id: UUID
    org_id: UUID
    lead_id: UUID
    channel: Channel
    status: ConversationStatus
    assigned_to: UUID | None
    last_message_at: datetime | None
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = {"from_attributes": True}
