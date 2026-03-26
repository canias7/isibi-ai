from __future__ import annotations

"""
Google Sheets Import — placeholder endpoint for importing data from Google Sheets.

Endpoints:
  POST /api/apps/{project_id}/import/google-sheets  — import from Google Sheets
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_org_id
from db import get_db

router = APIRouter(prefix="/apps", tags=["App Google Sheets Import"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class GoogleSheetsImportBody(BaseModel):
    spreadsheet_url: str
    sheet_name: Optional[str] = None
    target_entity: str
    header_row: int = 1
    column_mapping: dict[str, str] = {}  # sheet_column -> entity_field


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/{project_id}/import/google-sheets")
async def import_google_sheets(
    project_id: str,
    body: GoogleSheetsImportBody,
    org_id: uuid.UUID = Depends(get_current_org_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Import data from a Google Sheets spreadsheet into an app entity.

    This is a placeholder endpoint. Full implementation requires:
    - Google Sheets API credentials (service account or OAuth)
    - gspread or google-api-python-client library

    Returns a preview of what would be imported.
    """
    if not body.spreadsheet_url:
        raise HTTPException(status_code=400, detail="spreadsheet_url is required")
    if not body.target_entity:
        raise HTTPException(status_code=400, detail="target_entity is required")

    return {
        "status": "placeholder",
        "message": "Google Sheets import is not yet fully implemented. "
                   "Configure Google API credentials and install gspread to enable.",
        "config": {
            "project_id": project_id,
            "spreadsheet_url": body.spreadsheet_url,
            "sheet_name": body.sheet_name,
            "target_entity": body.target_entity,
            "header_row": body.header_row,
            "column_mapping": body.column_mapping,
        },
    }
