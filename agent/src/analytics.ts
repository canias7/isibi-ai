/**
 * ISIBI Ghost Mode — Analytics
 *
 * Tracks action usage, success/failure rates, and response times.
 * Stored at userData/analytics.json
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

interface ActionEvent {
  type: string;
  success: boolean;
  durationMs: number;
  timestamp: string;
}

interface AnalyticsData {
  totalCommands: number;
  totalActions: number;
  successCount: number;
  failCount: number;
  actionCounts: Record<string, number>;
  recentEvents: ActionEvent[];
}

const ANALYTICS_PATH = () => path.join(app.getPath('userData'), 'analytics.json');

let data: AnalyticsData = {
  totalCommands: 0,
  totalActions: 0,
  successCount: 0,
  failCount: 0,
  actionCounts: {},
  recentEvents: [],
};

export function loadAnalytics(): void {
  try {
    if (fs.existsSync(ANALYTICS_PATH())) {
      data = JSON.parse(fs.readFileSync(ANALYTICS_PATH(), 'utf-8'));
    }
  } catch {}
}

function save(): void {
  try {
    fs.writeFileSync(ANALYTICS_PATH(), JSON.stringify(data, null, 2));
  } catch {}
}

export function trackCommand(): void {
  data.totalCommands++;
  save();
}

export function trackAction(type: string, success: boolean, durationMs: number): void {
  data.totalActions++;
  if (success) data.successCount++;
  else data.failCount++;
  data.actionCounts[type] = (data.actionCounts[type] || 0) + 1;
  data.recentEvents.push({ type, success, durationMs, timestamp: new Date().toISOString() });
  if (data.recentEvents.length > 200) data.recentEvents = data.recentEvents.slice(-200);
  save();
}

export function getAnalytics(): {
  totalCommands: number;
  totalActions: number;
  successRate: string;
  topActions: { type: string; count: number }[];
  todayCommands: number;
} {
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = data.recentEvents.filter(e => e.timestamp.startsWith(today));
  const sorted = Object.entries(data.actionCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalCommands: data.totalCommands,
    totalActions: data.totalActions,
    successRate: data.totalActions > 0 ? ((data.successCount / data.totalActions) * 100).toFixed(1) + '%' : 'N/A',
    topActions: sorted,
    todayCommands: todayEvents.length,
  };
}
