import asyncio
import logging
from datetime import datetime, timedelta
from sqlalchemy import select, text
from db import async_session

logger = logging.getLogger(__name__)


async def run_scheduler():
    """Background scheduler that runs every 60 seconds."""
    while True:
        try:
            await asyncio.sleep(60)
            await _check_deadline_reminders()
            await _check_status_rules()
            await _fire_webhooks()
        except asyncio.CancelledError:
            logger.info("Scheduler cancelled, shutting down")
            break
        except Exception as e:
            logger.error(f"Scheduler error: {e}")


async def _check_deadline_reminders():
    """Check for upcoming deadlines and create notifications."""
    async with async_session() as db:
        from models.app_deadline_reminder import AppDeadlineReminder
        reminders = (await db.execute(
            select(AppDeadlineReminder).where(AppDeadlineReminder.enabled == True)
        )).scalars().all()

        for reminder in reminders:
            # Check if any records match the deadline window
            # This is a simplified version - just log for now
            logger.info(f"Checking deadline reminder: {reminder.entity}")


async def _check_status_rules():
    """Check for status auto-progression rules."""
    async with async_session() as db:
        from models.app_status_rule import AppStatusRule
        rules = (await db.execute(
            select(AppStatusRule).where(AppStatusRule.enabled == True)
        )).scalars().all()

        for rule in rules:
            logger.info(f"Checking status rule: {rule.entity} {rule.from_value} -> {rule.to_value}")


async def _fire_webhooks():
    """Fire pending webhooks."""
    # For now, just log
    pass
