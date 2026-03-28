import asyncio
import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, text, update, delete
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
            await _check_expired_subscriptions()
            await _send_daily_digest_reports()
            await _cleanup_expired_record_locks()
            await _run_scheduled_commands()
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


async def _check_expired_subscriptions():
    """Downgrade expired subscriptions to free plan."""
    async with async_session() as db:
        try:
            from models.subscription import Subscription

            now = datetime.now(timezone.utc)
            result = await db.execute(
                select(Subscription).where(
                    Subscription.plan != "free",
                    Subscription.status.in_(("canceled", "past_due")),
                    Subscription.current_period_end.isnot(None),
                    Subscription.current_period_end < now,
                )
            )
            expired = result.scalars().all()

            for sub in expired:
                sub.plan = "free"
                sub.status = "active"
                sub.builds_used = 0
                sub.builds_limit = 3
                sub.updated_at = now
                logger.info(f"Downgraded subscription {sub.id} (org {sub.org_id}) to free — expired at {sub.current_period_end}")

            if expired:
                await db.commit()
                logger.info(f"Downgraded {len(expired)} expired subscriptions to free")
        except Exception as e:
            logger.warning(f"Expired subscription check failed: {e}")


async def _send_daily_digest_reports():
    """Send daily digest emails for AppScheduledReport entries with schedule=daily."""
    async with async_session() as db:
        try:
            from models.app_scheduled_report import AppScheduledReport

            now = datetime.now(timezone.utc)
            cutoff = now - timedelta(hours=24)

            # Find daily reports that haven't been sent in the last 24 hours
            result = await db.execute(
                select(AppScheduledReport).where(
                    AppScheduledReport.enabled == True,
                    AppScheduledReport.schedule == "daily",
                    (
                        (AppScheduledReport.last_sent_at.is_(None))
                        | (AppScheduledReport.last_sent_at < cutoff)
                    ),
                )
            )
            reports = result.scalars().all()

            for report in reports:
                try:
                    # Build a summary of entities for this project
                    from generator.app_db import get_schema_name
                    schema = get_schema_name(str(report.project_id))

                    entity_summaries = []
                    for entity_name in (report.entities or []):
                        try:
                            count_result = await db.execute(
                                text(f"SELECT COUNT(*) FROM {schema}.{entity_name.lower()}s WHERE deleted_at IS NULL")
                            )
                            count = count_result.scalar() or 0
                            entity_summaries.append(f"{entity_name}: {count} records")
                        except Exception:
                            entity_summaries.append(f"{entity_name}: unable to count")

                    summary = "\n".join(entity_summaries) if entity_summaries else "No entity data available."

                    # Send email via SMTP if configured, otherwise log
                    import os
                    smtp_host = os.getenv("SMTP_HOST")
                    if smtp_host:
                        import smtplib
                        from email.mime.text import MIMEText

                        msg = MIMEText(
                            f"Daily Report: {report.name}\n\n{summary}\n\nGenerated at {now.isoformat()}",
                            "plain",
                        )
                        msg["Subject"] = f"[isibi] Daily Report: {report.name}"
                        msg["From"] = os.getenv("SMTP_FROM", "noreply@isibi.ai")
                        msg["To"] = report.recipient_email

                        with smtplib.SMTP(smtp_host, int(os.getenv("SMTP_PORT", "587"))) as server:
                            smtp_user = os.getenv("SMTP_USER")
                            if smtp_user:
                                server.starttls()
                                server.login(smtp_user, os.getenv("SMTP_PASS", ""))
                            server.send_message(msg)

                        logger.info(f"Sent daily digest '{report.name}' to {report.recipient_email}")
                    else:
                        logger.info(f"Daily digest '{report.name}' ready (no SMTP configured): {summary[:200]}")

                    # Mark as sent
                    report.last_sent_at = now
                    report.updated_at = now
                except Exception as e:
                    logger.warning(f"Failed to send digest '{report.name}': {e}")

            if reports:
                await db.commit()
                logger.info(f"Processed {len(reports)} daily digest reports")
        except Exception as e:
            logger.warning(f"Daily digest check failed: {e}")


async def _cleanup_expired_record_locks():
    """Delete expired record locks so records become editable again."""
    async with async_session() as db:
        try:
            from models.app_record_lock import AppRecordLock

            now = datetime.now(timezone.utc)
            result = await db.execute(
                delete(AppRecordLock).where(AppRecordLock.expires_at < now)
            )
            await db.commit()

            if result.rowcount and result.rowcount > 0:
                logger.info(f"Cleaned up {result.rowcount} expired record locks")
        except Exception as e:
            logger.warning(f"Record lock cleanup failed: {e}")


async def _run_scheduled_commands():
    """Execute scheduled commands whose time has arrived."""
    async with async_session() as db:
        try:
            from models.app_scheduled_command import AppScheduledCommand
            from worker.command_executor import execute_command
            import pytz

            now_utc = datetime.now(timezone.utc)

            # Fetch all enabled commands
            result = await db.execute(
                select(AppScheduledCommand).where(AppScheduledCommand.enabled == True)
            )
            commands = result.scalars().all()

            executed = 0
            for cmd in commands:
                try:
                    # Convert current UTC time to the command's timezone
                    try:
                        tz = pytz.timezone(cmd.timezone or "UTC")
                    except pytz.UnknownTimeZoneError:
                        tz = pytz.UTC
                    now_local = now_utc.astimezone(tz)

                    # Parse scheduled time
                    parts = cmd.schedule_time.split(":")
                    sched_hour = int(parts[0])
                    sched_minute = int(parts[1]) if len(parts) > 1 else 0

                    # Check if current time matches (within 1-minute window)
                    if now_local.hour != sched_hour or now_local.minute != sched_minute:
                        continue

                    # Check schedule_type constraints
                    if cmd.schedule_type == "weekly":
                        day_name = now_local.strftime("%A").lower()
                        if cmd.schedule_day and day_name != cmd.schedule_day.lower():
                            continue

                    elif cmd.schedule_type == "monthly":
                        if cmd.schedule_day:
                            try:
                                if now_local.day != int(cmd.schedule_day):
                                    continue
                            except ValueError:
                                continue

                    elif cmd.schedule_type == "once":
                        # Only run if never run before
                        if cmd.last_run_at is not None:
                            continue

                    # Avoid running the same command twice in the same minute
                    if cmd.last_run_at:
                        last_local = cmd.last_run_at.astimezone(tz)
                        if (
                            last_local.date() == now_local.date()
                            and last_local.hour == now_local.hour
                            and last_local.minute == now_local.minute
                        ):
                            continue

                    # Execute the command
                    result_text = await execute_command(str(cmd.project_id), cmd.command, db)

                    # Update state
                    cmd.last_run_at = now_utc
                    cmd.last_result = result_text
                    executed += 1

                    # Disable one-time commands after execution
                    if cmd.schedule_type == "once":
                        cmd.enabled = False

                    logger.info(
                        f"Scheduled command executed: '{cmd.command[:50]}' "
                        f"for project {cmd.project_id}"
                    )

                except Exception as e:
                    logger.warning(
                        f"Failed to execute scheduled command {cmd.id}: {e}"
                    )

            if executed > 0:
                await db.commit()
                logger.info(f"Executed {executed} scheduled commands")

        except Exception as e:
            logger.warning(f"Scheduled commands check failed: {e}")
