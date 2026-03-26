from __future__ import annotations
"""
Data Snapshots — backup and restore all app data as JSONB snapshots.

Routes:
  POST   /api/apps/{project_id}/snapshots               — create snapshot
  GET    /api/apps/{project_id}/snapshots               — list snapshots
  GET    /api/apps/{project_id}/snapshots/{id}           — get snapshot details
  POST   /api/apps/{project_id}/snapshots/{id}/restore   — restore from snapshot
  DELETE /api/apps/{project_id}/snapshots/{id}           — delete snapshot
"""

import json
import sys
import uuid
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, text, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.app_snapshot import AppSnapshot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps", tags=["App Snapshots"])


# ── Schemas ──────────────────────────────────────────────────────────

class CreateSnapshotRequest(BaseModel):
    name: str = "Untitled Snapshot"


# ── Helpers ──────────────────────────────────────────────────────────

def _serialize_snapshot(s: AppSnapshot, include_data: bool = False) -> dict:
    result = {
        "id": str(s.id),
        "project_id": str(s.project_id),
        "org_id": str(s.org_id),
        "name": s.name,
        "tables_count": s.tables_count,
        "rows_count": s.rows_count,
        "size_bytes": s.size_bytes,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
    if include_data and s.data:
        # Include per-table row counts
        result["tables"] = {
            tbl: {"row_count": len(rows)} for tbl, rows in s.data.items()
        }
    return result


async def _get_app_tables(db: AsyncSession, project_id: uuid.UUID) -> list[str]:
    """Get all dynamic app data tables for a project by inspecting the spec."""
    from models.project import Project
    result = await db.execute(
        select(Project.spec).where(Project.id == project_id)
    )
    spec = result.scalar_one_or_none()
    if not spec:
        return []

    tables = []
    # The spec stores tables under the "pages" key, each page has a "table" field
    pages = spec.get("pages", [])
    for page in pages:
        table_name = page.get("table")
        if table_name:
            tables.append(table_name)
    return tables


async def _read_table_data(db: AsyncSession, project_id: uuid.UUID, table_name: str) -> list[dict]:
    """Read all rows from a dynamic app table."""
    try:
        # App data tables are typically named with the project schema
        # They live in the app_data route's dynamic table structure
        safe_table = table_name.replace('"', '').replace("'", "").replace(";", "")
        result = await db.execute(
            text(f'SELECT * FROM "{safe_table}" WHERE project_id = :pid'),
            {"pid": str(project_id)},
        )
        rows = result.mappings().all()
        # Convert rows to JSON-serializable dicts
        serialized = []
        for row in rows:
            row_dict = {}
            for key, value in dict(row).items():
                if isinstance(value, (datetime, )):
                    row_dict[key] = value.isoformat()
                elif isinstance(value, uuid.UUID):
                    row_dict[key] = str(value)
                else:
                    row_dict[key] = value
            serialized.append(row_dict)
        return serialized
    except Exception as e:
        logger.warning(f"Could not read table {table_name}: {e}")
        return []


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/{project_id}/snapshots", status_code=201)
async def create_snapshot(
    project_id: uuid.UUID,
    body: CreateSnapshotRequest,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Create a snapshot of all app data."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    # Discover tables from the project spec
    tables = await _get_app_tables(db, project_id)

    # Read data from each table
    snapshot_data = {}
    total_rows = 0
    for table_name in tables:
        rows = await _read_table_data(db, project_id, table_name)
        snapshot_data[table_name] = rows
        total_rows += len(rows)

    # Estimate size
    data_json = json.dumps(snapshot_data)
    size_bytes = sys.getsizeof(data_json)

    snapshot = AppSnapshot(
        project_id=project_id,
        org_id=org_id,
        name=body.name,
        data=snapshot_data,
        tables_count=len(tables),
        rows_count=total_rows,
        size_bytes=size_bytes,
    )
    db.add(snapshot)
    await db.commit()
    await db.refresh(snapshot)

    return _serialize_snapshot(snapshot, include_data=True)


@router.get("/{project_id}/snapshots")
async def list_snapshots(
    project_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """List all snapshots for this project."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppSnapshot)
        .where(AppSnapshot.project_id == project_id)
        .order_by(AppSnapshot.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    snapshots = result.scalars().all()

    return {"snapshots": [_serialize_snapshot(s) for s in snapshots]}


@router.get("/{project_id}/snapshots/{snapshot_id}")
async def get_snapshot(
    project_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Get snapshot details with per-table row counts."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppSnapshot).where(
            AppSnapshot.id == snapshot_id,
            AppSnapshot.project_id == project_id,
        )
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    return _serialize_snapshot(snapshot, include_data=True)


@router.post("/{project_id}/snapshots/{snapshot_id}/restore")
async def restore_snapshot(
    project_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Restore data from a snapshot. DANGER: clears current data and replaces with snapshot."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppSnapshot).where(
            AppSnapshot.id == snapshot_id,
            AppSnapshot.project_id == project_id,
        )
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    if not snapshot.data:
        raise HTTPException(status_code=400, detail="Snapshot contains no data")

    restored_tables = []
    total_restored_rows = 0

    for table_name, rows in snapshot.data.items():
        safe_table = table_name.replace('"', '').replace("'", "").replace(";", "")
        try:
            # Delete current data for this project in this table
            await db.execute(
                text(f'DELETE FROM "{safe_table}" WHERE project_id = :pid'),
                {"pid": str(project_id)},
            )

            # Insert snapshot rows
            for row in rows:
                columns = ", ".join(f'"{k}"' for k in row.keys())
                placeholders = ", ".join(f":{k}" for k in row.keys())
                await db.execute(
                    text(f'INSERT INTO "{safe_table}" ({columns}) VALUES ({placeholders})'),
                    row,
                )
                total_restored_rows += 1

            restored_tables.append(table_name)
        except Exception as e:
            logger.warning(f"Could not restore table {table_name}: {e}")

    await db.commit()

    return {
        "restored": True,
        "snapshot_id": str(snapshot_id),
        "snapshot_name": snapshot.name,
        "tables_restored": len(restored_tables),
        "rows_restored": total_restored_rows,
    }


@router.delete("/{project_id}/snapshots/{snapshot_id}")
async def delete_snapshot(
    project_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    org_id: uuid.UUID = Depends(get_current_org_id),
):
    """Delete a snapshot."""
    from generator.orchestrator import _get_project
    await _get_project(db, project_id, org_id)

    result = await db.execute(
        select(AppSnapshot).where(
            AppSnapshot.id == snapshot_id,
            AppSnapshot.project_id == project_id,
        )
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    await db.delete(snapshot)
    await db.commit()

    return {"deleted": True}
