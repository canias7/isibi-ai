// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadReminderSound, saveReminderSound, reminderSoundLabel, isReminderSound, REMINDER_SOUNDS } from './reminderSounds';

beforeEach(() => localStorage.clear());

describe('reminder sound choice', () => {
  it('defaults to the system sound', () => {
    expect(loadReminderSound()).toBe('default');
  });

  it('round-trips a valid choice', () => {
    saveReminderSound('rem_scream');
    expect(loadReminderSound()).toBe('rem_scream');
    expect(localStorage.getItem('gf_reminder_sound')).toBe('rem_scream');
  });

  it('rejects junk and falls back to default', () => {
    localStorage.setItem('gf_reminder_sound', 'rm -rf');
    expect(loadReminderSound()).toBe('default');
    expect(isReminderSound('rm -rf')).toBe(false);
    expect(isReminderSound('rem_chime')).toBe(true);
    saveReminderSound('not-a-sound');
    expect(loadReminderSound()).toBe('default');
  });

  it('has Default first, unique ids, and a label + section each', () => {
    expect(REMINDER_SOUNDS[0].id).toBe('default');
    const ids = REMINDER_SOUNDS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of REMINDER_SOUNDS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.section.length).toBeGreaterThan(0);
    }
    expect(reminderSoundLabel('rem_chime')).toBe('Chime');
    expect(reminderSoundLabel('default')).toBe('Default');
    expect(reminderSoundLabel('bogus')).toBe('Default');
  });
});
