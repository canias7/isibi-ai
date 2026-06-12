// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { cleanReminderTitle } from './reminders';

describe('cleanReminderTitle', () => {
  it('strips a leading "remind me to" and capitalizes the task', () => {
    expect(cleanReminderTitle('Remind me to brush my teeth')).toBe('Brush my teeth');
    expect(cleanReminderTitle('remind me to call Sam')).toBe('Call Sam');
    expect(cleanReminderTitle('remind me that the rent is due')).toBe('The rent is due');
  });

  it('handles other natural lead-ins', () => {
    expect(cleanReminderTitle("don't forget to water the plants")).toBe('Water the plants');
    expect(cleanReminderTitle('remember to lock the door')).toBe('Lock the door');
    expect(cleanReminderTitle('set a reminder to pay rent')).toBe('Pay rent');
    expect(cleanReminderTitle('I need to renew my passport')).toBe('Renew my passport');
  });

  it('handles the "reminder:" noun form and tames shouting', () => {
    expect(cleanReminderTitle('reminder: buy milk')).toBe('Buy milk');
    expect(cleanReminderTitle('Reminder - pick up package')).toBe('Pick up package');
    expect(cleanReminderTitle('REMIND ME TO CALL MOM')).toBe('Call mom');
    expect(cleanReminderTitle('CALL MOM')).toBe('Call mom');
    expect(cleanReminderTitle('Buy iPhone case')).toBe('Buy iPhone case'); // mixed case preserved
  });

  it('leaves an already-clean title alone (bar capitalization)', () => {
    expect(cleanReminderTitle('Brush my teeth')).toBe('Brush my teeth');
    expect(cleanReminderTitle('dentist at 3')).toBe('Dentist at 3');
  });

  it('does not mangle titles that only start with similar words', () => {
    expect(cleanReminderTitle('Remind the team about the deadline')).toBe('Remind the team about the deadline');
    expect(cleanReminderTitle('To-do list review')).toBe('To-do list review');
  });

  it('falls back to the original when stripping would empty it', () => {
    expect(cleanReminderTitle('')).toBe('');
    expect(cleanReminderTitle('   ')).toBe('');
  });
});
