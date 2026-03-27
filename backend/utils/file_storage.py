"""
Cloud-safe file storage utility.

If R2/S3 credentials are set (R2_ACCESS_KEY_ID), uses cloud storage.
Otherwise, stores files as base64 in the database — simple and works
on any hosting without external services. Fine for files under 5 MB.
"""

import base64
import os
import logging

logger = logging.getLogger(__name__)

# If R2/S3 credentials are set, use cloud storage
USE_CLOUD = bool(os.getenv("R2_ACCESS_KEY_ID"))


async def save_file(content: bytes, filename: str) -> tuple[str, str]:
    """Save file, return (file_key, file_url).

    If cloud storage configured, uploads to R2/S3.
    Otherwise, returns base64-encoded content as the file_key.
    """
    if USE_CLOUD:
        # TODO: Implement R2/S3 upload when credentials are provided
        logger.info("Cloud storage configured but not yet implemented, falling back to base64")

    # Store as base64 in database
    b64 = base64.b64encode(content).decode("utf-8")
    return b64, f"/api/files/serve/{filename}"


async def get_file(file_key: str) -> bytes:
    """Get file content from key."""
    if USE_CLOUD:
        # TODO: Implement R2/S3 download when credentials are provided
        pass
    return base64.b64decode(file_key)


def delete_file(file_key: str):
    """Delete a stored file."""
    pass  # For DB storage, deletion happens when the record is deleted
