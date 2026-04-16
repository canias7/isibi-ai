from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_db
from auth import get_current_org_id
from models.lead import Lead
from schemas.lead import LeadCreate, LeadUpdate, LeadRead
from schemas.pagination import PaginatedResponse
from routes.crud import paginated_list, get_one, create_one, update_one, soft_delete

router = APIRouter(prefix="/leads", tags=["Leads"])


@router.get("", response_model=PaginatedResponse[LeadRead])
async def list_leads(
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await paginated_list(db, Lead, org_id, limit, cursor)


@router.get("/{lead_id}", response_model=LeadRead)
async def get_lead(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await get_one(db, Lead, lead_id, org_id)


@router.post("", response_model=LeadRead, status_code=201)
async def create_lead(
    body: LeadCreate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await create_one(db, Lead, org_id, body.model_dump())


@router.patch("/{lead_id}", response_model=LeadRead)
async def update_lead(
    lead_id: UUID,
    body: LeadUpdate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await update_one(db, Lead, lead_id, org_id, body.model_dump(exclude_unset=True))


@router.delete("/{lead_id}", status_code=204)
async def delete_lead(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    await soft_delete(db, Lead, lead_id, org_id)
