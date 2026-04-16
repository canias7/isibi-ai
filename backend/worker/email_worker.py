"""Email trigger worker - fires emails when app data events occur."""
import os
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "isibi.ai <noreply@isibi.ai>")

async def fire_email_triggers(project_id: str, event: str, entity: str, record: dict, db):
    """Check if any email triggers match this event and fire them.

    Called from app_data.py after create/update/delete operations.

    Args:
        project_id: The project UUID
        event: "record_created", "record_updated", "record_deleted"
        entity: Entity name (e.g., "Order")
        record: The record data dict
        db: Database session
    """
    if not RESEND_API_KEY:
        logger.debug("No RESEND_API_KEY, skipping email triggers")
        return

    from sqlalchemy import select
    from models.app_email_trigger import AppEmailTrigger

    try:
        triggers = (await db.execute(
            select(AppEmailTrigger).where(
                AppEmailTrigger.project_id == project_id,
                AppEmailTrigger.event == event,
                AppEmailTrigger.entity == entity,
                AppEmailTrigger.enabled == True,
            )
        )).scalars().all()

        for trigger in triggers:
            await _send_trigger_email(trigger, record)
    except Exception as e:
        logger.error(f"Email trigger error: {e}")


async def _send_trigger_email(trigger, record: dict):
    """Send a single trigger email."""
    try:
        import resend
        resend.api_key = RESEND_API_KEY

        # Get recipient email from record
        to_email = record.get(trigger.to_field)
        if not to_email or "@" not in str(to_email):
            logger.warning(f"No valid email in field '{trigger.to_field}' for trigger '{trigger.name}'")
            return

        # Render templates with record data
        subject = _render_template(trigger.subject_template, record)
        body = _render_template(trigger.body_template, record)

        resend.Emails.send({
            "from": FROM_EMAIL,
            "to": [str(to_email)],
            "subject": subject,
            "html": f"<div style='font-family:Inter,sans-serif;color:#111'>{body}</div>",
        })

        logger.info(f"Email sent: '{trigger.name}' to {to_email}")
    except Exception as e:
        logger.error(f"Failed to send email for trigger '{trigger.name}': {e}")


def _render_template(template: str, record: dict) -> str:
    """Replace {{field_name}} placeholders with record values."""
    def replacer(match):
        key = match.group(1).strip()
        return str(record.get(key, f"[{key}]"))

    return re.sub(r'\{\{(\w+)\}\}', replacer, template)
