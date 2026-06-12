// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Reminder } from './reminders';

// Capture what gets handed to the native plugin so we can assert the SHAPE of
// the schedule (calendar components for recurring, the orphan sweep, the cap).
const calls: { schedule: any[]; cancel: any[]; pending: { notifications: any[] } } = {
  schedule: [],
  cancel: [],
  pending: { notifications: [] },
};

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    schedule: vi.fn((o: unknown) => { calls.schedule.push(o); return Promise.resolve(); }),
    cancel: vi.fn((o: unknown) => { calls.cancel.push(o); return Promise.resolve(); }),
    getPending: vi.fn(() => Promise.resolve(calls.pending)),
    createChannel: vi.fn(() => Promise.resolve()),
    registerActionTypes: vi.fn(() => Promise.resolve()),
    addListener: vi.fn(() => Promise.resolve({ remove() {} })),
  },
}));
vi.mock('./reminderSounds', () => ({ loadReminderSound: () => 'default', reminderSoundLabel: () => 'Default' }));

import { scheduleReminder, syncReminders } from './reminders';

const base: Reminder = { id: 'r1', title: 'Brush my teeth', remind_at: '', repeat: 'none', enabled: true, created_at: '2026-01-01T00:00:00Z' };
const rem = (o: Partial<Reminder>): Reminder => ({ ...base, ...o });
// Build remind_at from LOCAL fields and read it back locally, so assertions are
// timezone-independent. 2030-01-07 09:30 is a Monday (getDay()===1).
const localISO = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString();

beforeEach(() => { calls.schedule = []; calls.cancel = []; calls.pending = { notifications: [] }; });

describe('scheduleReminder schedule shape', () => {
  it('daily fires by calendar hour/minute (no fixed-ms every — DST-proof)', async () => {
    await scheduleReminder(rem({ repeat: 'daily', remind_at: localISO(2030, 0, 7, 9, 30) }));
    expect(calls.schedule).toHaveLength(1);
    const s = calls.schedule[0].notifications[0].schedule;
    expect(s.on).toEqual({ hour: 9, minute: 30 });
    expect(s.at).toBeUndefined();
    expect(s.every).toBeUndefined();
  });

  it('weekly anchors to the weekday (Monday => Capacitor weekday 2)', async () => {
    await scheduleReminder(rem({ repeat: 'weekly', remind_at: localISO(2030, 0, 7, 9, 30) }));
    expect(calls.schedule[0].notifications[0].schedule.on).toEqual({ weekday: 2, hour: 9, minute: 30 });
  });

  it('future one-off schedules at the instant', async () => {
    await scheduleReminder(rem({ remind_at: new Date(Date.now() + 86_400_000).toISOString() }));
    expect(calls.schedule[0].notifications[0].schedule.at).toBeInstanceOf(Date);
  });

  it('a passed one-off is dropped, not fired immediately', async () => {
    await scheduleReminder(rem({ remind_at: new Date(Date.now() - 3_600_000).toISOString() }));
    expect(calls.schedule).toHaveLength(0);
  });

  it('a malformed remind_at never arms an Invalid Date notification', async () => {
    await scheduleReminder(rem({ remind_at: 'not-a-date', repeat: 'daily' }));
    expect(calls.schedule).toHaveLength(0);
  });

  it('carries the title in extra for cold-start snooze', async () => {
    await scheduleReminder(rem({ repeat: 'daily', remind_at: localISO(2030, 0, 7, 9, 30) }));
    expect(calls.schedule[0].notifications[0].extra).toMatchObject({ reminderId: 'r1', title: 'Brush my teeth' });
  });
});

describe('syncReminders reconciliation', () => {
  it('cancels an orphan armed for a reminder no longer in the list', async () => {
    calls.pending.notifications = [{ id: 11, extra: { reminderId: 'deleted-elsewhere' } }];
    await syncReminders([]); // empty list = everything armed is an orphan
    const cancelledIds = calls.cancel.flatMap((c) => c.notifications.map((n: { id: number }) => n.id));
    expect(cancelledIds).toContain(11);
  });

  it('preserves a live snooze (its reminder is present + enabled)', async () => {
    calls.pending.notifications = [{ id: 1_500_000_001, extra: { reminderId: 'r1' } }];
    await syncReminders([rem({ id: 'r1', enabled: true, remind_at: localISO(2030, 0, 7, 9, 30) })]);
    const cancelledIds = calls.cancel.flatMap((c) => c.notifications.map((n: { id: number }) => n.id));
    expect(cancelledIds).not.toContain(1_500_000_001);
  });

  it('arms at most 60 (the iOS pending cap), soonest first', async () => {
    const many = Array.from({ length: 65 }, (_, i) =>
      rem({ id: `r${i}`, enabled: true, remind_at: new Date(Date.now() + (i + 1) * 3_600_000).toISOString() }));
    await syncReminders(many);
    expect(calls.schedule.length).toBe(60);
  });
});
