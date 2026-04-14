from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_db
from auth import get_current_org_id
from models.user import User
from schemas.user import UserCreate, UserUpdate, UserRead
from schemas.pagination import PaginatedResponse
from routes.crud import paginated_list, get_one, create_one, update_one, soft_delete

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("", response_model=PaginatedResponse[UserRead])
async def list_users(
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await paginated_list(db, User, org_id, limit, cursor)


@router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await get_one(db, User, user_id, org_id)


@router.post("", response_model=UserRead, status_code=201)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await create_one(db, User, org_id, body.model_dump())


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: UUID,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await update_one(db, User, user_id, org_id, body.model_dump(exclude_unset=True))


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    await soft_delete(db, User, user_id, org_id)
