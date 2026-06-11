import { describe, it, expect } from 'vitest';
import { pickSuggestions } from './suggestions';

const zero = () => 0; // deterministic: always picks the first option, no shuffling

describe('home-screen suggestion picker', () => {
  it('always returns three unique prompts', () => {
    for (const apps of [[], ['gmail'], ['gmail', 'gcal', 'slack', 'notion']]) {
      for (const hour of [8, 14, 21]) {
        const out = pickSuggestions(apps, hour);
        expect(out).toHaveLength(3);
        expect(new Set(out).size).toBe(3);
      }
    }
  });

  it('leads with "What can you do?" for a user with nothing connected', () => {
    expect(pickSuggestions([], 10, zero)[0]).toBe('What can you do?');
  });

  it('draws from connected apps when they exist', () => {
    const out = pickSuggestions(['gmail'], 10, zero);
    expect(out).toContain('Summarize my inbox');
  });

  it('respects the time of day', () => {
    expect(pickSuggestions([], 8, zero)).toContain('Plan my morning');
    expect(pickSuggestions([], 20, zero)).toContain('Recap my day');
  });

  it('ignores connected apps it has no prompts for', () => {
    const out = pickSuggestions(['someweirdapp'], 10, zero);
    expect(out).toHaveLength(3);
    expect(out.join(' ')).not.toContain('someweirdapp');
  });
});
