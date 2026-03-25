from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_db
from auth import get_current_org_id
from models.task import Task
from schemas.task import TaskCreate, TaskUpdate, TaskRead
from schemas.pagination import PaginatedResponse
from routes.crud import paginated_list, get_one, create_one, update_one, soft_delete

router = APIRouter(prefix="/tasks", tags=["Tasks"])


@router.get("", response_model=PaginatedResponse[TaskRead])
async def list_tasks(
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await paginated_list(db, Task, org_id, limit, cursor)


@router.get("/{task_id}", response_model=TaskRead)
async def get_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await get_one(db, Task, task_id, org_id)


@router.post("", response_model=TaskRead, status_code=201)
async def create_task(
    body: TaskCreate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await create_one(db, Task, org_id, body.model_dump())


@router.patch("/{task_id}", response_model=TaskRead)
async def update_task(
    task_id: UUID,
    body: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    return await update_one(db, Task, task_id, org_id, body.model_dump(exclude_unset=True))


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    await soft_delete(db, Task, task_id, org_id)
