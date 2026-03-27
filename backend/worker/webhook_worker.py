"""Webhook worker - fires configured webhooks when app data events occur.

Features:
- Retry up to 3 times with exponential backoff (1s, 4s, 16s)
- Auto-disable webhooks after 10 cumulative failures
- Update last_triggered_at on successful fire
"""
import asyncio
import logging
import json
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
BACKOFF_BASE = 1  # seconds — delays: 1s, 4s, 16s
MAX_FAILURE_COUNT = 10


async def fire_webhooks(project_id: str, event: str, entity: str, record: dict, db):
    """Check if any webhook triggers match this event and fire them.

    Args:
        project_id: The project UUID
        event: "record_created", "record_updated", "record_deleted"
        entity: Entity/table name
        record: The record data
        db: Database session
    """
    from sqlalchemy import select
    from models.app_webhook_trigger import AppWebhookTrigger

    try:
        triggers = (await db.execute(
            select(AppWebhookTrigger).where(
                AppWebhookTrigger.project_id == project_id,
                AppWebhookTrigger.event == event,
                AppWebhookTrigger.entity == entity,
                AppWebhookTrigger.enabled == True,
            )
        )).scalars().all()

        for trigger in triggers:
            await _send_webhook_with_retry(trigger, event, entity, record, db)
    except Exception as e:
        logger.error(f"Webhook trigger error: {e}")


async def _send_webhook_with_retry(trigger, event: str, entity: str, record: dict, db):
    """Send a webhook POST with retry logic (exponential backoff)."""
    import httpx

    payload = {
        "event": event,
        "entity": entity,
        "data": record,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "project_id": str(trigger.project_id),
    }

    headers = {"Content-Type": "application/json"}

    # Add custom headers from trigger config
    if trigger.headers and isinstance(trigger.headers, dict):
        headers.update(trigger.headers)

    payload_bytes = json.dumps(payload, default=str).encode()

    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    trigger.url,
                    content=payload_bytes,
                    headers=headers,
                )

            if response.status_code < 300:
                # Success
                logger.info(f"Webhook '{trigger.name}' fired: {response.status_code}")
                if trigger.failure_count > 0:
                    trigger.failure_count = 0
                trigger.last_triggered_at = datetime.now(timezone.utc)
                await db.commit()
                return
            else:
                last_error = f"HTTP {response.status_code}"
                logger.warning(
                    f"Webhook '{trigger.name}' attempt {attempt + 1}/{MAX_RETRIES} "
                    f"returned {response.status_code}"
                )
        except Exception as e:
            last_error = str(e)
            logger.warning(
                f"Webhook '{trigger.name}' attempt {attempt + 1}/{MAX_RETRIES} "
                f"failed: {e}"
            )

        # Wait before retry (exponential backoff: 1s, 4s, 16s)
        if attempt < MAX_RETRIES - 1:
            delay = BACKOFF_BASE * (4 ** attempt)
            await asyncio.sleep(delay)

    # All retries exhausted — increment failure count
    trigger.failure_count = (trigger.failure_count or 0) + 1
    logger.error(
        f"Webhook '{trigger.name}' failed after {MAX_RETRIES} retries: {last_error}. "
        f"Failure count: {trigger.failure_count}"
    )

    # Auto-disable if failure count exceeds threshold
    if trigger.failure_count > MAX_FAILURE_COUNT:
        trigger.enabled = False
        logger.warning(
            f"Webhook '{trigger.name}' auto-disabled after {trigger.failure_count} "
            f"cumulative failures"
        )

    try:
        await db.commit()
    except Exception:
        pass
