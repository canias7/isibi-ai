from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_db
from auth import get_current_org_id
from models.deal import Deal
from schemas.deal import DealCreate, DealUpdate, DealRead
from schemas.pagination import PaginatedResponse
from routes.crud import paginated_list, get_one, create_one, update_one, soft_delete

router = APIRouter(prefix="/deals", tags=["Deals"])


@router.get("", response_model=PaginatedResponse[DealRead])
async def list_deals(
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await paginated_list(db, Deal, org_id, limit, cursor)


@router.get("/{deal_id}", response_model=DealRead)
async def get_deal(
    deal_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await get_one(db, Deal, deal_id, org_id)


@router.post("", response_model=DealRead, status_code=201)
async def create_deal(
    body: DealCreate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await create_one(db, Deal, org_id, body.model_dump())


@router.patch("/{deal_id}", response_model=DealRead)
async def update_deal(
    deal_id: UUID,
    body: DealUpdate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await update_one(db, Deal, deal_id, org_id, body.model_dump(exclude_unset=True))


@router.delete("/{deal_id}", status_code=204)
async def delete_deal(
    deal_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    await soft_delete(db, Deal, deal_id, org_id)
