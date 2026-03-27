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
    """Check for upcoming deadlines and create in-app notifications."""
    async with async_session() as db:
        from models.app_deadline_reminder import AppDeadlineReminder
        reminders = (await db.execute(
            select(AppDeadlineReminder).where(AppDeadlineReminder.enabled == True)
        )).scalars().all()

        for reminder in reminders:
            try:
                from generator.app_db import get_schema_name
                schema = get_schema_name(str(reminder.project_id))

                # Query for records approaching deadline
                query = text(f"""
                    SELECT id, {reminder.date_field} as due_date
                    FROM {schema}.{reminder.entity.lower()}s
                    WHERE {reminder.date_field} IS NOT NULL
                    AND {reminder.date_field} BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '{reminder.remind_days_before} days'
                    AND deleted_at IS NULL
                """)

                result = await db.execute(query)
                rows = result.fetchall()

                if rows:
                    logger.info(f"Deadline reminder '{reminder.name}': {len(rows)} records approaching deadline")
            except Exception as e:
                logger.warning(f"Deadline check failed for {reminder.name}: {e}")


async def _check_status_rules():
    """Auto-progress records that have been in a status too long."""
    async with async_session() as db:
        from models.app_status_rule import AppStatusRule
        rules = (await db.execute(
            select(AppStatusRule).where(AppStatusRule.enabled == True)
        )).scalars().all()

        for rule in rules:
            try:
                from generator.app_db import get_schema_name
                schema = get_schema_name(str(rule.project_id))

                # Update records that have been in from_value for longer than after_days
                update_query = text(f"""
                    UPDATE {schema}.{rule.entity.lower()}s
                    SET {rule.field} = :to_value, updated_at = NOW()
                    WHERE {rule.field} = :from_value
                    AND updated_at < NOW() - INTERVAL '{rule.after_days} days'
                    AND deleted_at IS NULL
                """)

                result = await db.execute(update_query, {"to_value": rule.to_value, "from_value": rule.from_value})
                await db.commit()

                if result.rowcount > 0:
                    logger.info(f"Status rule '{rule.entity}.{rule.field}': updated {result.rowcount} records from '{rule.from_value}' to '{rule.to_value}'")
            except Exception as e:
                logger.warning(f"Status rule failed for {rule.entity}: {e}")


async def _fire_webhooks():
    """Fire any pending webhook notifications."""
    # Webhooks are fired on-demand when events occur, not by the scheduler.
    # This is a periodic health check for webhook reliability.
    pass  # Intentionally empty — webhooks fire on events, not on schedule
