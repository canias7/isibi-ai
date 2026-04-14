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
# Urgent-email poller runs every 5 minutes so we're not hammering
# every user's mailbox on every 60-second scheduler tick. Tracked
# here so we don't have to persist it.
_last_urgent_email_poll: datetime | None = None


async def run_scheduler():
    """Background scheduler that runs every 60 seconds."""
    global _last_urgent_email_poll
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

            # Urgent-email poller — runs every 5 minutes. Walks every
            # user with a connected mailbox and pushes a notification
            # if anything urgent arrived since the last poll. Isolated
            # here so a polling error never breaks the rest of the
            # scheduler loop.
            try:
                now = datetime.now(timezone.utc)
                if _last_urgent_email_poll is None or (now - _last_urgent_email_poll) >= timedelta(minutes=5):
                    _last_urgent_email_poll = now
                    from worker.push_email_poller import poll_urgent_emails_for_all_users
                    await poll_urgent_emails_for_all_users()
                    # Proactive agents — same 5-minute cadence so we
                    # share the spirit of the urgent-email poller.
                    # Each agent does its own mailbox poll (could be
                    # optimized later to reuse the same call).
                    try:
                        from worker.agent_trigger_poller import poll_email_triggers_for_all_users
                        await poll_email_triggers_for_all_users()
                    except Exception as agent_err:
                        logger.warning(f"Agent email triggers failed: {agent_err}")
            except Exception as poll_err:
                logger.warning(f"Urgent-email poller failed: {poll_err}")

            # Morning digest tick — runs every minute but internally
            # dedupes by last_fired_at (23h window) and only fires
            # for users whose configured time matches the current
            # minute in their own timezone. Cheap when no-one's
            # digest time is "now".
            try:
                from worker.digest_runner import tick_digests
                await tick_digests()
            except Exception as digest_err:
                logger.warning(f"Digest tick failed: {digest_err}")

            # Proactive-agent schedule triggers — minute-precision,
            # internally dedupes via 23h window. Cheap when no agents
            # are scheduled for "now".
            try:
                from worker.agent_trigger_poller import tick_schedule_triggers
                await tick_schedule_triggers()
            except Exception as agent_sched_err:
                logger.warning(f"Agent schedule tick failed: {agent_sched_err}")
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

                    # Route through the unified sender: a connected mail
                    # app if the owner has one, else Resend as a last
                    # resort (scheduled reports are system-adjacent —
                    # they still need to go out even if the user hasn't
                    # connected a mail app yet).
                    ok = False
                    try:
                        from models.project import Project
                        from routes.ghost_auth import GhostUser
                        from routes.ghost_connectors import send_email_for_user
                        proj_res = await db.execute(select(Project).where(Project.id == report.project_id))
                        proj = proj_res.scalar_one_or_none()
                        if proj and proj.user_id:
                            user_res = await db.execute(select(GhostUser).where(GhostUser.id == proj.user_id))
                            owner = user_res.scalar_one_or_none()
                            if owner:
                                result = await send_email_for_user(
                                    owner.id,
                                    owner.email,
                                    db,
                                    to=report.recipient_email,
                                    subject=f"[isibi] {report.name}",
                                    html=html,
                                )
                                ok = bool(result.get("sent"))
                    except Exception as lookup_err:
                        logger.warning(f"Unified send failed for report '{report.name}': {lookup_err}")

                    if not ok:
                        # Final safety net for scheduled reports — keep
                        # Resend so recurring system-driven sends still
                        # work even if the owner hasn't connected a mail
                        # app yet. Interactive user sends don't get this.
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
                        # Also push a digest notification to the owner's
                        # devices so they get pinged even if the app was
                        # closed when the scheduled report fired. Best
                        # effort — we never block the mail send on push.
                        try:
                            from routes.ghost_push import send_push_to_user
                            if 'owner' in locals() and owner and owner.id:
                                await send_push_to_user(
                                    owner.id,
                                    db,
                                    title=f"{report.name} is ready",
                                    body=f"Your scheduled digest was delivered to {report.recipient_email}.",
                                    kind="digest",
                                    data={"reportId": str(report.id)},
                                )
                        except Exception:
                            logger.exception("Digest push fan-out failed (non-fatal)")
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


# Cap how many ghost tasks can be running concurrently across the whole
# backend, regardless of how many scheduler ticks have spawned them. Prevents
# Anthropic / SMTP rate-limit blowouts when many tasks pile up at once.
_GHOST_TASK_SEM = asyncio.Semaphore(10)

# How far back to still consider a task "due". With fire-and-forget execution
# the scheduler tick is non-blocking, but the executor itself can still slow
# the loop on a busy event loop, and DB / network hiccups can delay a tick.
# A 5-minute window means a task fires even if the scheduler missed its exact
# minute, and the per-task last_run_at debounce stops any double-fire.
_GHOST_DUE_WINDOW = timedelta(minutes=5)


def _ghost_most_recent_instance(
    kind: str,
    days: list[int],
    hour: int,
    minute: int,
    once_date: tuple[int, int, int] | None,
    now_local: datetime,
) -> datetime | None:
    """Return the most recent at-or-before scheduled fire time in `now_local`'s
    timezone, or None if the task has no due instance."""
    if kind == "once":
        if once_date is None:
            return None
        mo, d, y = once_date
        try:
            return now_local.replace(
                year=y, month=mo, day=d, hour=hour, minute=minute, second=0, microsecond=0
            )
        except ValueError:
            return None

    if kind == "recurring":
        # Today's instance at hour:minute
        today_inst = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
        candidates: list[datetime] = []
        if _js_weekday(today_inst) in days and today_inst <= now_local:
            candidates.append(today_inst)
        # Also consider yesterday — handles tasks scheduled near midnight
        # where "today's" instance is still in the future but yesterday's
        # instance is just a few minutes ago.
        y_inst = today_inst - timedelta(days=1)
        if _js_weekday(y_inst) in days and y_inst <= now_local:
            candidates.append(y_inst)
        return max(candidates) if candidates else None

    return None


async def _run_ghost_scheduled_tasks():
    """Fire user-scoped mobile scheduled tasks within a 5-minute due window.

    Each due task is dispatched as a background asyncio.Task so a slow run
    can never block the scheduler loop. last_run_at is stamped synchronously
    BEFORE dispatch so the next tick won't double-fire it while it's still
    running. The shared _GHOST_TASK_SEM caps total concurrency across all
    background runs.
    """
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    async with async_session() as db:
        try:
            from models.ghost_scheduled_task import GhostScheduledTask

            now_utc = datetime.now(timezone.utc)

            result = await db.execute(
                select(GhostScheduledTask).where(GhostScheduledTask.enabled == True)
            )
            tasks = result.scalars().all()

            due: list = []
            for task in tasks:
                try:
                    kind, days, hour, minute, once_date = _parse_ghost_schedule(task.schedule)
                    if kind == "invalid":
                        continue

                    tz_name = task.timezone or "UTC"
                    try:
                        tz = ZoneInfo(tz_name)
                    except (ZoneInfoNotFoundError, Exception):
                        tz = ZoneInfo("UTC")
                    now_local = now_utc.astimezone(tz)

                    scheduled_local = _ghost_most_recent_instance(
                        kind, days, hour, minute, once_date, now_local
                    )
                    if scheduled_local is None:
                        continue

                    # Within the grace window?
                    if (now_local - scheduled_local) > _GHOST_DUE_WINDOW:
                        continue

                    # Debounce: did we already run this exact instance?
                    if task.last_run_at is not None:
                        scheduled_utc = scheduled_local.astimezone(timezone.utc)
                        if task.last_run_at >= scheduled_utc:
                            continue

                    due.append(task)
                except Exception as e:
                    logger.warning("Ghost task filter %s failed: %s", task.label, e)

            if not due:
                return

            # Stamp last_run_at NOW so the next scheduler tick can't pick the
            # same task up again while it's still running in the background.
            for t in due:
                t.last_run_at = now_utc
            await db.commit()

            # Fire-and-forget: each task runs in its own background asyncio
            # Task with its own DB session. The scheduler loop returns
            # immediately and resumes ticking on time even if a task takes
            # several minutes.
            for t in due:
                asyncio.create_task(_run_one_ghost_task_bg(t.id))
            logger.info("Ghost scheduler dispatched %d tasks (background)", len(due))
        except Exception as e:
            logger.warning("Ghost scheduled tasks check failed: %s", e, exc_info=True)


async def _run_one_ghost_task_bg(task_id):
    """Background runner for a single ghost scheduled task. Uses its own DB
    session so it can outlive the scheduler tick that dispatched it. Caps
    global concurrency via _GHOST_TASK_SEM."""
    async with _GHOST_TASK_SEM:
        try:
            async with async_session() as task_db:
                from models.ghost_scheduled_task import GhostScheduledTask
                from worker.ghost_task_executor import execute_ghost_task

                res = await task_db.execute(
                    select(GhostScheduledTask).where(GhostScheduledTask.id == task_id)
                )
                t = res.scalar_one_or_none()
                if t is None:
                    return

                try:
                    result_text = await execute_ghost_task(t, task_db)
                    t.last_result = (result_text or "")[:2000]
                    logger.info(
                        "Ghost scheduled task fired: %s (%s) → %s",
                        t.label, t.user_email, (result_text or "")[:120],
                    )
                except Exception as e:
                    t.last_result = f"Error: {e}"[:2000]
                    logger.warning("Ghost task %s failed: %s", t.label, e, exc_info=True)

                await task_db.commit()
        except Exception as e:
            logger.warning("Background ghost task wrapper failed: %s", e, exc_info=True)


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
