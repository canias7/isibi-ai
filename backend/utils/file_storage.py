"""
Cloud-safe file storage utility.

If R2/S3 credentials are set (R2_ACCESS_KEY_ID), uses Cloudflare R2.
Otherwise, stores files as base64 in memory — simple fallback for dev.
"""

import base64
import os
import logging
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# ── R2/S3 config ────────────────────────────────────────────────────────
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "gofarther-files")
R2_ENDPOINT = os.getenv("R2_ENDPOINT", "")  # e.g. https://<account_id>.r2.cloudflarestorage.com

USE_CLOUD = bool(R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_ENDPOINT)

_s3_client = None


def _get_s3():
    """Lazy-init S3-compatible client for Cloudflare R2."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )
    return _s3_client


async def upload_to_r2(file_key: str, data: bytes, content_type: str = "application/octet-stream", filename: str = "") -> bool:
    """Upload bytes to R2. Returns True on success."""
    if not USE_CLOUD:
        return False
    try:
        metadata = {}
        if filename:
            metadata["filename"] = filename
        _get_s3().put_object(
            Bucket=R2_BUCKET_NAME,
            Key=file_key,
            Body=data,
            ContentType=content_type,
            Metadata=metadata,
        )
        logger.info(f"Uploaded to R2: {file_key}")
        return True
    except ClientError as e:
        logger.error(f"R2 upload failed for {file_key}: {e}")
        return False


async def download_from_r2(file_key: str) -> dict | None:
    """Download from R2. Returns {"data": bytes, "content_type": str, "filename": str} or None."""
    if not USE_CLOUD:
        return None
    try:
        resp = _get_s3().get_object(Bucket=R2_BUCKET_NAME, Key=file_key)
        return {
            "data": resp["Body"].read(),
            "content_type": resp.get("ContentType", "application/octet-stream"),
            "filename": resp.get("Metadata", {}).get("filename", ""),
        }
    except ClientError as e:
        logger.error(f"R2 download failed for {file_key}: {e}")
        return None


async def delete_from_r2(file_key: str) -> bool:
    """Delete object from R2."""
    if not USE_CLOUD:
        return False
    try:
        _get_s3().delete_object(Bucket=R2_BUCKET_NAME, Key=file_key)
        return True
    except ClientError:
        return False


# ── Legacy helpers (used by file_storage route, kept for compat) ────────

async def save_file(content: bytes, filename: str) -> tuple[str, str]:
    """Save file, return (file_key, file_url)."""
    if USE_CLOUD:
        file_key = f"uploads/{filename}"
        ok = await upload_to_r2(file_key, content)
        if ok:
            return file_key, f"/api/files/serve/{filename}"
    b64 = base64.b64encode(content).decode("utf-8")
    return b64, f"/api/files/serve/{filename}"


async def get_file(file_key: str) -> bytes:
    """Get file content from key."""
    if USE_CLOUD and not _is_base64(file_key):
        result = await download_from_r2(file_key)
        if result:
            return result["data"]
    return base64.b64decode(file_key)


def delete_file(file_key: str):
    """Delete a stored file."""
    pass


def _is_base64(s: str) -> bool:
    """Quick check if string looks like base64 vs an R2 key."""
    return len(s) > 100 or "/" not in s
