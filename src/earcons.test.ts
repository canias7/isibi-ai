// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { soundsOn, setSoundsOn, sentSound, replySound } from './earcons';

beforeEach(() => localStorage.clear());

describe('earcons (send/reply sound preference)', () => {
  it('defaults to on', () => {
    expect(soundsOn()).toBe(true);
  });

  it('round-trips the toggle through localStorage', () => {
    setSoundsOn(false);
    expect(soundsOn()).toBe(false);
    expect(localStorage.getItem('gf_sounds')).toBe('0');
    setSoundsOn(true);
    expect(soundsOn()).toBe(true);
  });

  it('survives garbage in storage (any non-"0" value means on)', () => {
    localStorage.setItem('gf_sounds', 'not a flag');
    expect(soundsOn()).toBe(true);
  });

  it('is a silent no-op where Web Audio is missing (jsdom has none)', () => {
    expect(() => { sentSound(); replySound(); }).not.toThrow();
    setSoundsOn(false);
    expect(() => sentSound()).not.toThrow();
  });
});
