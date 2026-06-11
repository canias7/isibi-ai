import { describe, it, expect } from 'vitest';
import { modelChip, isModelChoice, MODEL_OPTIONS } from './models';

describe('model catalog', () => {
  it('validates ids, rejecting junk', () => {
    expect(isModelChoice('sonnet')).toBe(true);
    expect(isModelChoice('auto')).toBe(true);
    expect(isModelChoice('gpt-5')).toBe(false);
    expect(isModelChoice('')).toBe(false);
    expect(isModelChoice(null)).toBe(false);
  });

  it('exposes every option with a chip + cost dots, auto first', () => {
    expect(MODEL_OPTIONS[0].id).toBe('auto');
    for (const o of MODEL_OPTIONS) {
      expect(o.chip.length).toBeGreaterThan(0);
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.sub.length).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(o.dots);
      expect(isModelChoice(o.id)).toBe(true);
    }
  });

  it('maps a choice to its composer chip, falling back to Auto', () => {
    expect(modelChip('haiku')).toBe('Haiku');
    expect(modelChip('opus')).toBe('Opus');
    expect(modelChip('auto')).toBe('Auto');
  });
});
