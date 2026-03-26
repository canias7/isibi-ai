from __future__ import annotations
"""
File Serve — serves files stored as base64 in the database.

Routes:
  GET /api/files/{file_id} — serve a file by its UUID from any file table
"""

import base64
import uuid
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import async_session
from models.file_upload import FileUpload
from models.app_field_file import AppFieldFile
from models.app_record_file import AppRecordFile

logger = logging.getLogger(__name__)

router = APIRouter(tags=["File Serve"])


@router.get("/files/{file_id}")
async def serve_file(file_id: uuid.UUID):
    """Serve a file from the database by looking up its base64 data."""
    async with async_session() as db:
        # Try each file table in order
        for Model in (FileUpload, AppFieldFile, AppRecordFile):
            result = await db.execute(
                select(Model).where(Model.id == file_id)
            )
            record = result.scalar_one_or_none()
            if record and record.file_data:
                try:
                    content = base64.b64decode(record.file_data)
                except Exception:
                    raise HTTPException(status_code=500, detail="Corrupt file data")

                content_type = getattr(record, "file_type", None) or "application/octet-stream"
                file_name = getattr(record, "file_name", "download")

                return Response(
                    content=content,
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f'inline; filename="{file_name}"',
                        "Cache-Control": "public, max-age=86400",
                    },
                )

        raise HTTPException(status_code=404, detail="File not found")
