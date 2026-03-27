"""Webhook worker - fires configured webhooks when app data events occur."""
import logging
import hashlib
import hmac
import json
from datetime import datetime

logger = logging.getLogger(__name__)

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
            await _send_webhook(trigger, event, entity, record, db)
    except Exception as e:
        logger.error(f"Webhook trigger error: {e}")


async def _send_webhook(trigger, event: str, entity: str, record: dict, db):
    """Send a single webhook POST."""
    import httpx

    payload = {
        "event": event,
        "entity": entity,
        "data": record,
        "timestamp": datetime.utcnow().isoformat(),
        "project_id": str(trigger.project_id),
    }

    headers = {"Content-Type": "application/json"}

    # Add custom headers from trigger config
    if trigger.headers and isinstance(trigger.headers, dict):
        headers.update(trigger.headers)

    # Add signature if webhook has a secret
    payload_bytes = json.dumps(payload, default=str).encode()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                trigger.url,
                content=payload_bytes,
                headers=headers,
            )

        if response.status_code < 300:
            logger.info(f"Webhook '{trigger.name}' fired: {response.status_code}")
            # Reset failure count on success
            if trigger.failure_count > 0:
                trigger.failure_count = 0
                await db.commit()
        else:
            logger.warning(f"Webhook '{trigger.name}' returned {response.status_code}")
            trigger.failure_count = (trigger.failure_count or 0) + 1
            await db.commit()
    except Exception as e:
        logger.error(f"Webhook '{trigger.name}' failed: {e}")
        trigger.failure_count = (trigger.failure_count or 0) + 1
        try:
            await db.commit()
        except:
            pass
