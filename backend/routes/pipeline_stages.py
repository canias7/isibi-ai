from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_db
from auth import get_current_org_id
from models.pipeline_stage import PipelineStage
from schemas.pipeline_stage import PipelineStageCreate, PipelineStageUpdate, PipelineStageRead
from schemas.pagination import PaginatedResponse
from routes.crud import paginated_list, get_one, create_one, update_one, soft_delete

router = APIRouter(prefix="/pipeline-stages", tags=["Pipeline Stages"])


@router.get("", response_model=PaginatedResponse[PipelineStageRead])
async def list_pipeline_stages(
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await paginated_list(db, PipelineStage, org_id, limit, cursor)


@router.get("/{stage_id}", response_model=PipelineStageRead)
async def get_pipeline_stage(
    stage_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await get_one(db, PipelineStage, stage_id, org_id)


@router.post("", response_model=PipelineStageRead, status_code=201)
async def create_pipeline_stage(
    body: PipelineStageCreate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await create_one(db, PipelineStage, org_id, body.model_dump())


@router.patch("/{stage_id}", response_model=PipelineStageRead)
async def update_pipeline_stage(
    stage_id: UUID,
    body: PipelineStageUpdate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await update_one(db, PipelineStage, stage_id, org_id, body.model_dump(exclude_unset=True))


@router.delete("/{stage_id}", status_code=204)
async def delete_pipeline_stage(
    stage_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    await soft_delete(db, PipelineStage, stage_id, org_id)
