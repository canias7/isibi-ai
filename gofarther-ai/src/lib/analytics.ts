/** Simple analytics — tracks events locally + can be sent to backend */
import { load, save } from './storage';

interface AnalyticsEvent {
  event: string;
  ts: number;
  meta?: Record<string, string>;
}

export async function track(event: string, meta?: Record<string, string>) {
  const events: AnalyticsEvent[] = await load('analytics_events', []);
  events.push({ event, ts: Date.now(), meta });
  await save('analytics_events', events.slice(-1000));
}

export async function getEvents(): Promise<AnalyticsEvent[]> {
  return load('analytics_events', []);
}

export async function getUsageStats(): Promise<{
  totalChats: number;
  totalActions: number;
  topFeatures: { feature: string; count: number }[];
}> {
  const events = await getEvents();
  const totalChats = events.filter(e => e.event === 'chat_send').length;
  const totalActions = events.filter(e => e.event.startsWith('action_')).length;

  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.event] = (counts[e.event] || 0) + 1;
  }

  const topFeatures = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([feature, count]) => ({ feature, count }));

  return { totalChats, totalActions, topFeatures };
}

export async function clearAnalytics() {
  await save('analytics_events', []);
}
