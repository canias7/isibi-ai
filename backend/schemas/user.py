from __future__ import annotations
from datetime import datetime
from enum import Enum
from uuid import UUID
from pydantic import BaseModel, Field, EmailStr


class UserRole(str, Enum):
    admin = "admin"
    manager = "manager"
    agent = "agent"


class UserStatus(str, Enum):
    active = "active"
    inactive = "inactive"
    suspended = "suspended"


class UserCreate(BaseModel):
    first_name: str = Field(max_length=100)
    last_name: str = Field(max_length=100)
    email: EmailStr
    role: UserRole = UserRole.agent
    status: UserStatus = UserStatus.active
    avatar_url: str | None = None
    department: str | None = Field(default=None, max_length=100)
    timezone: str = "America/New_York"


class UserUpdate(BaseModel):
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    email: EmailStr | None = None
    role: UserRole | None = None
    status: UserStatus | None = None
    avatar_url: str | None = None
    department: str | None = Field(default=None, max_length=100)
    timezone: str | None = None
    version: int


class UserRead(BaseModel):
    id: UUID
    org_id: UUID
    first_name: str
    last_name: str
    email: str
    role: UserRole
    status: UserStatus
    avatar_url: str | None
    department: str | None
    timezone: str
    last_login_at: datetime | None
    invite_accepted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = {"from_attributes": True}
