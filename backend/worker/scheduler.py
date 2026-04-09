import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, text, update, delete
from db import async_session

logger = logging.getLogger(__name__)

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _safe_ident(name: str) -> str:
    """Validate SQL identifier to prevent injection."""
    if not name or not _IDENT_RE.match(name) or len(name) > 128:
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    return name


_last_retention_cleanup: datetime | None = None


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
            await _run_ghost_scheduled_tasks()
            await _cleanup_old_data()
        except asyncio.CancelledError:
            logger.info("Scheduler cancelled, shutting down")
            break
        except Exception as e:
            logger.error("Scheduler error: %s", e, exc_info=True)


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

                # Validate identifiers before using in SQL
                date_field = _safe_ident(reminder.date_field)
                entity_table = _safe_ident(reminder.entity.lower() + "s")
                days = int(reminder.remind_days_before)  # ensure integer

                # Query for records approaching deadline
                query = text(f"""
                    SELECT id, {date_field} as due_date
                    FROM {schema}.{entity_table}
                    WHERE {date_field} IS NOT NULL
                    AND {date_field} BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '{days} days'
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

                # Validate identifiers before using in SQL
                entity_table = _safe_ident(rule.entity.lower() + "s")
                field = _safe_ident(rule.field)
                days = int(rule.after_days)

                # Update records that have been in from_value for longer than after_days
                update_query = text(f"""
                    UPDATE {schema}.{entity_table}
                    SET {field} = :to_value, updated_at = NOW()
                    WHERE {field} = :from_value
                    AND updated_at < NOW() - INTERVAL '{days} days'
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


def _is_report_due(schedule: str, last_sent_at: datetime | None, now: datetime) -> bool:
    """Decide whether a scheduled report should fire now."""
    if schedule == "daily":
        return last_sent_at is None or (now - last_sent_at) >= timedelta(hours=24)
    if schedule == "weekly_monday":
        if now.weekday() != 0:
            return False
        return last_sent_at is None or (now - last_sent_at) >= timedelta(hours=20)
    if schedule == "weekly_friday":
        if now.weekday() != 4:
            return False
        return last_sent_at is None or (now - last_sent_at) >= timedelta(hours=20)
    if schedule == "monthly_first":
        if now.day != 1:
            return False
        return last_sent_at is None or last_sent_at.month != now.month or last_sent_at.year != now.year
    if schedule == "monthly_last":
        import calendar
        last_day = calendar.monthrange(now.year, now.month)[1]
        if now.day != last_day:
            return False
        return last_sent_at is None or last_sent_at.month != now.month or last_sent_at.year != now.year
    return False


async def _send_daily_digest_reports():
    """Send scheduled report emails via Resend."""
    async with async_session() as db:
        try:
            from models.app_scheduled_report import AppScheduledReport
            from services.email import send_generic_email

            now = datetime.now(timezone.utc)

            result = await db.execute(
                select(AppScheduledReport).where(AppScheduledReport.enabled == True)
            )
            reports = result.scalars().all()

            sent_count = 0
            for report in reports:
                try:
                    if not _is_report_due(report.schedule, report.last_sent_at, now):
                        continue

                    # Build a summary of entities for this project
                    from generator.app_db import get_schema_name
                    schema = get_schema_name(str(report.project_id))

                    entity_rows = []
                    for entity_name in (report.entities or []):
                        try:
                            entity_table = _safe_ident(entity_name.lower() + "s")
                            count_result = await db.execute(
                                text(f"SELECT COUNT(*) FROM {schema}.{entity_table} WHERE deleted_at IS NULL")
                            )
                            count = count_result.scalar() or 0
                            entity_rows.append((entity_name, count))
                        except Exception:
                            entity_rows.append((entity_name, None))

                    rows_html = "".join(
                        f'<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">{name}</td>'
                        f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">'
                        f'{count if count is not None else "—"}</td></tr>'
                        for (name, count) in entity_rows
                    )
                    html = f"""
                    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:40px 20px">
                      <h2 style="font-size:20px;font-weight:600;color:#000;margin:0 0 8px">{report.name}</h2>
                      <p style="font-size:14px;color:#666;margin:0 0 24px">Scheduled report — {now.strftime('%B %d, %Y')}</p>
                      <table style="width:100%;border-collapse:collapse;font-size:14px">
                        <thead><tr>
                          <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #000">Entity</th>
                          <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #000">Records</th>
                        </tr></thead>
                        <tbody>{rows_html or '<tr><td colspan="2" style="padding:12px;color:#999">No data</td></tr>'}</tbody>
                      </table>
                      <p style="font-size:12px;color:#999;margin:24px 0 0">Sent by isibi.ai</p>
                    </div>
                    """

                    # Look up the project owner's SMTP settings — prefer user SMTP, fall back to Resend
                    ok = False
                    try:
                        from models.project import Project
                        from routes.ghost_auth import GhostUser, get_user_smtp
                        proj_res = await db.execute(select(Project).where(Project.id == report.project_id))
                        proj = proj_res.scalar_one_or_none()
                        if proj and proj.user_id:
                            user_res = await db.execute(select(GhostUser).where(GhostUser.id == proj.user_id))
                            owner = user_res.scalar_one_or_none()
                            if owner:
                                settings = await get_user_smtp(owner.email, db)
                                if settings.get("smtp_host"):
                                    from services.email import send_via_smtp
                                    ok = await send_via_smtp(
                                        settings,
                                        to=report.recipient_email,
                                        subject=f"[isibi] {report.name}",
                                        html=html,
                                    )
                    except Exception as lookup_err:
                        logger.warning(f"SMTP lookup failed for report '{report.name}': {lookup_err}")

                    if not ok:
                        ok = await send_generic_email(
                            to=report.recipient_email,
                            subject=f"[isibi] {report.name}",
                            html=html,
                        )
                    if ok:
                        report.last_sent_at = now
                        report.updated_at = now
                        sent_count += 1
                        logger.info(f"Scheduled report sent: '{report.name}' → {report.recipient_email}")
                    else:
                        logger.warning(f"Scheduled report send failed: '{report.name}' → {report.recipient_email}")
                except Exception as e:
                    logger.warning(f"Failed to process report '{report.name}': {e}", exc_info=True)

            if sent_count:
                await db.commit()
                logger.info(f"Sent {sent_count} scheduled reports")
        except Exception as e:
            logger.warning(f"Scheduled report check failed: {e}", exc_info=True)


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


def _parse_ghost_schedule(schedule: str) -> tuple[str, list[int], int, int, tuple[int, int, int] | None]:
    """Parse the mobile schedule format.
    Returns (kind, days, hour, minute, once_date).
      kind = 'recurring' | 'once' | 'invalid'
      days = list of weekday ints (JS Date.getDay: Sun=0..Sat=6) — only for recurring
      once_date = (month, day, year) — only for once
    """
    if not schedule:
        return ("invalid", [], 0, 0, None)

    parts = schedule.split("|")

    def parse_hm(s: str) -> tuple[int, int]:
        if not s:
            return (0, 0)
        bits = s.split(":")
        try:
            h = int(bits[0])
        except Exception:
            h = 0
        try:
            m = int(bits[1]) if len(bits) > 1 else 0
        except Exception:
            m = 0
        return (max(0, min(23, h)), max(0, min(59, m)))

    if parts[0] == "once" and len(parts) == 3:
        try:
            mo, d, y = [int(x) for x in parts[1].split("/")]
        except Exception:
            return ("invalid", [], 0, 0, None)
        h, mi = parse_hm(parts[2])
        return ("once", [], h, mi, (mo, d, y))

    if len(parts) == 2 and parts[0] != "once":
        try:
            days = [int(x) for x in parts[0].split(",") if x.strip() != ""]
        except Exception:
            return ("invalid", [], 0, 0, None)
        h, mi = parse_hm(parts[1])
        return ("recurring", days, h, mi, None)

    return ("invalid", [], 0, 0, None)


def _js_weekday(now: datetime) -> int:
    """Python Monday=0..Sunday=6 → JS Sunday=0..Saturday=6."""
    return (now.weekday() + 1) % 7


async def _run_ghost_scheduled_tasks():
    """Fire user-scoped mobile scheduled tasks whose minute matches the current clock."""
    async with async_session() as db:
        try:
            from models.ghost_scheduled_task import GhostScheduledTask
            from worker.ghost_task_executor import execute_ghost_task

            now = datetime.now(timezone.utc)
            # Match the user's LOCAL clock? For now we use UTC — mobile schedule stores local hour/min
            # but the backend doesn't know the user's timezone. TODO: add tz to GhostUser.
            # For now assume UTC. The user can compensate when picking the time.

            result = await db.execute(
                select(GhostScheduledTask).where(GhostScheduledTask.enabled == True)
            )
            tasks = result.scalars().all()

            # Filter to tasks that are actually due right now (cheap, synchronous)
            due: list = []
            for task in tasks:
                try:
                    kind, days, hour, minute, once_date = _parse_ghost_schedule(task.schedule)
                    if kind == "invalid":
                        continue
                    if now.hour != hour or now.minute != minute:
                        continue
                    if kind == "once":
                        if once_date is None:
                            continue
                        mo, d, y = once_date
                        if not (now.month == mo and now.day == d and now.year == y):
                            continue
                    elif kind == "recurring":
                        if _js_weekday(now) not in days:
                            continue
                    else:
                        continue
                    # Debounce: avoid running the same task twice in the same minute
                    if task.last_run_at:
                        last = task.last_run_at
                        if (
                            last.year == now.year
                            and last.month == now.month
                            and last.day == now.day
                            and last.hour == now.hour
                            and last.minute == now.minute
                        ):
                            continue
                    due.append(task)
                except Exception as e:
                    logger.warning("Ghost task filter %s failed: %s", task.label, e)

            if not due:
                return

            # Run due tasks concurrently, but cap concurrency so we don't
            # blow out Anthropic rate limits or SMTP providers. Each task
            # gets its own DB session so they don't fight over one cursor.
            sem = asyncio.Semaphore(10)

            async def _run_one(t):
                async with sem:
                    try:
                        async with async_session() as task_db:
                            result_text = await execute_ghost_task(t, task_db)
                        t.last_run_at = now
                        t.last_result = (result_text or "")[:2000]
                        logger.info(
                            "Ghost scheduled task fired: %s (%s) → %s",
                            t.label, t.user_email, (result_text or "")[:120],
                        )
                    except Exception as e:
                        logger.warning("Ghost task %s failed: %s", t.label, e, exc_info=True)

            await asyncio.gather(*(_run_one(t) for t in due), return_exceptions=True)
            await db.commit()
            logger.info("Ghost scheduler fired %d tasks in parallel", len(due))
        except Exception as e:
            logger.warning("Ghost scheduled tasks check failed: %s", e, exc_info=True)


async def _cleanup_old_data():
    """Data retention cleanup — runs once every 24 hours.
    Enforces SOC 2 data retention policy:
      - Audit logs: 365 days
      - Usage logs: 90 days
      - Revoked sessions: 30 days
      - Inactive trusted devices: 90 days
      - Expired login logs: 90 days
    """
    global _last_retention_cleanup
    now = datetime.now(timezone.utc)
    if _last_retention_cleanup and (now - _last_retention_cleanup).total_seconds() < 86400:
        return  # Already ran today
    _last_retention_cleanup = now

    async with async_session() as db:
        try:
            total = 0
            # Audit logs > 365 days
            cutoff_365 = now - timedelta(days=365)
            r = await db.execute(text("DELETE FROM ghost_audit_logs WHERE timestamp < :cutoff"), {"cutoff": cutoff_365})
            total += r.rowcount or 0

            # Usage logs > 90 days
            cutoff_90d = (now - timedelta(days=90)).date()
            r = await db.execute(text("DELETE FROM ghost_usage_logs WHERE date < :cutoff"), {"cutoff": cutoff_90d})
            total += r.rowcount or 0

            # Revoked sessions > 30 days
            cutoff_30 = now - timedelta(days=30)
            r = await db.execute(text("DELETE FROM ghost_sessions WHERE revoked = true AND last_active < :cutoff"), {"cutoff": cutoff_30})
            total += r.rowcount or 0

            # Inactive trusted devices > 90 days
            cutoff_90 = now - timedelta(days=90)
            r = await db.execute(text("DELETE FROM ghost_trusted_devices WHERE trusted_at < :cutoff"), {"cutoff": cutoff_90})
            total += r.rowcount or 0

            # Login logs > 90 days
            r = await db.execute(text("DELETE FROM ghost_login_logs WHERE timestamp < :cutoff"), {"cutoff": cutoff_90})
            total += r.rowcount or 0

            # Login attempts > 1 hour (lockout tracking)
            cutoff_1h = now - timedelta(hours=1)
            r = await db.execute(text("DELETE FROM ghost_login_attempts WHERE timestamp < :cutoff"), {"cutoff": cutoff_1h})
            total += r.rowcount or 0

            # Expired login challenges
            r = await db.execute(text("DELETE FROM ghost_login_challenges WHERE expires < :now"), {"now": now})
            total += r.rowcount or 0

            await db.commit()
            logger.info("Data retention cleanup completed: %d rows removed", total)
        except Exception as e:
            logger.warning("Data retention cleanup failed: %s", e)
