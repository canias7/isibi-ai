from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_db
from auth import get_current_org_id
from models.conversation import Conversation
from schemas.conversation import ConversationCreate, ConversationUpdate, ConversationRead
from schemas.pagination import PaginatedResponse
from routes.crud import paginated_list, get_one, create_one, update_one, soft_delete

router = APIRouter(prefix="/conversations", tags=["Conversations"])


@router.get("", response_model=PaginatedResponse[ConversationRead])
async def list_conversations(
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await paginated_list(db, Conversation, org_id, limit, cursor)


@router.get("/{conversation_id}", response_model=ConversationRead)
async def get_conversation(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await get_one(db, Conversation, conversation_id, org_id)


@router.post("", response_model=ConversationRead, status_code=201)
async def create_conversation(
    body: ConversationCreate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await create_one(db, Conversation, org_id, body.model_dump())


@router.patch("/{conversation_id}", response_model=ConversationRead)
async def update_conversation(
    conversation_id: UUID,
    body: ConversationUpdate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await update_one(db, Conversation, conversation_id, org_id, body.model_dump(exclude_unset=True))


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    await soft_delete(db, Conversation, conversation_id, org_id)
