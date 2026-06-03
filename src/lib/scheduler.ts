/** Scheduler engine — runs scheduled tasks in the background */
import { getScheduledTasks, ScheduledTask } from './storage';
import { chat, Message } from './ai';
import { buildUserContextPrompt } from './promptContext';
import { scheduleLocalNotification } from './notifications';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const lastRun: Record<string, number> = {};

/** Start the scheduler — checks every minute if tasks should run */
export function startScheduler() {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(checkTasks, 60000); // Check every minute
  checkTasks(); // Run immediately on start
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

async function checkTasks() {
  try {
    const tasks = await getScheduledTasks();
    const now = new Date();

    for (const task of tasks) {
      if (!task.enabled) continue;
      if (shouldRun(task, now)) {
        runTask(task);
      }
    }
  } catch {}
}

/** Parse "H" (legacy hour-only) or "H:M" → [hour, minute] */
function parseHM(s: string): [number, number] {
  if (!s) return [0, 0];
  const [hStr, mStr] = s.split(':');
  return [parseInt(hStr) || 0, parseInt(mStr) || 0];
}

function shouldRun(task: ScheduledTask, now: Date): boolean {
  const key = task.id;
  const last = lastRun[key] || 0;
  const elapsed = Date.now() - last;

  const parts = task.schedule.split('|');

  // One-time format: "once|4/15/2026|9:30" (or legacy "once|4/15/2026|9")
  if (parts[0] === 'once' && parts.length === 3) {
    const [month, day, year] = parts[1].split('/').map(Number);
    const [hour, minute] = parseHM(parts[2]);
    return now.getMonth() + 1 === month && now.getDate() === day && now.getFullYear() === year
      && now.getHours() === hour && now.getMinutes() === minute && elapsed > 120000;
  }

  // Recurring format: "0,1,2,3,4,5,6|9:30" = days|hour:minute (legacy: days|hour)
  if (parts.length === 2 && parts[0] !== 'once') {
    const days = parts[0].split(',').map(Number);
    const [hour, minute] = parseHM(parts[1]);
    return days.includes(now.getDay()) && now.getHours() === hour && now.getMinutes() === minute && elapsed > 120000;
  }

  // Legacy format support
  switch (task.schedule) {
    case 'hourly': return elapsed > 3600000;
    case 'daily_9am': return now.getHours() === 9 && now.getMinutes() < 2 && elapsed > 3600000;
    case 'daily_6pm': return now.getHours() === 18 && now.getMinutes() < 2 && elapsed > 3600000;
    case 'weekly_mon': return now.getDay() === 1 && now.getHours() === 9 && now.getMinutes() < 2 && elapsed > 86400000;
    case 'weekdays': return now.getDay() >= 1 && now.getDay() <= 5 && now.getHours() === 9 && now.getMinutes() < 2 && elapsed > 3600000;
    case 'monthly': return now.getDate() === 1 && now.getHours() === 9 && now.getMinutes() < 2 && elapsed > 86400000;
    default: return false;
  }
}

async function runTask(task: ScheduledTask) {
  lastRun[task.id] = Date.now();

  try {
    const messages: Message[] = [{ role: 'user', content: task.command }];
    // Pull shared user-context extras so scheduled tasks also know the
    // user's saved contacts, memory, custom instructions, nickname, etc.
    // Skip the contact-learning sidecar rule — scheduled tasks run in the
    // background and can't meaningfully save new contacts mid-run.
    const extras = await buildUserContextPrompt({
      terseWhenEmpty: true,
      includeContactLearningRule: false,
    });
    const systemPrompt = `You are an AI assistant executing a scheduled task. The task is: "${task.label}". Execute the following command and provide a brief result.${extras}`;

    const response = await chat(messages, systemPrompt);

    // Send notification with result
    await scheduleLocalNotification(
      `Task: ${task.label}`,
      response.slice(0, 200),
      1
    );
  } catch (e: any) {
    await scheduleLocalNotification(
      `Task Failed: ${task.label}`,
      e.message || 'Unknown error',
      1
    );
  }
}
