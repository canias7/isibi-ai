// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { rowCost, rowCacheSavings, summarize, fmtUsd, fmtTokens, fmtDuration, sourceLabel, loadBudget, saveBudget, type UsageRow } from './usage';

const NOW = new Date('2026-06-11T15:00:00Z');
const row = (over: Partial<UsageRow>): UsageRow => ({
  source: 'chat', model: 'claude-sonnet-4-6',
  in_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, out_tokens: 0,
  created_at: '2026-06-11T12:00:00Z',
  ...over,
});

describe('usage cost estimates', () => {
  it('prices sonnet input/output at list', () => {
    // 1M in = $3, 1M out = $15
    expect(rowCost(row({ in_tokens: 1_000_000 }))).toBeCloseTo(3);
    expect(rowCost(row({ out_tokens: 1_000_000 }))).toBeCloseTo(15);
  });

  it('prices opus and haiku by model name', () => {
    expect(rowCost(row({ model: 'claude-opus-4-8', out_tokens: 1_000_000 }))).toBeCloseTo(25);
    expect(rowCost(row({ model: 'claude-haiku-4-5', in_tokens: 1_000_000 }))).toBeCloseTo(1);
  });

  it('bills cache writes at 2x input and reads at 10%', () => {
    expect(rowCost(row({ cache_write_tokens: 1_000_000 }))).toBeCloseTo(6);   // 2 × $3
    expect(rowCost(row({ cache_read_tokens: 1_000_000 }))).toBeCloseTo(0.3); // 0.1 × $3
  });

  it('computes cache savings as the 90% discount on reads', () => {
    expect(rowCacheSavings(row({ cache_read_tokens: 1_000_000 }))).toBeCloseTo(2.7);
  });

  it('prices unknown models like sonnet instead of dropping them', () => {
    expect(rowCost(row({ model: 'claude-future-9', in_tokens: 1_000_000 }))).toBeCloseTo(3);
  });
});

describe('summarize (today / week / month windows)', () => {
  it('buckets rows into the right windows', () => {
    const rows: UsageRow[] = [
      row({ in_tokens: 1_000_000, created_at: '2026-06-11T12:00:00Z' }), // today ($3)
      row({ in_tokens: 1_000_000, created_at: '2026-06-08T12:00:00Z' }), // this week
      row({ in_tokens: 1_000_000, created_at: '2026-05-20T12:00:00Z' }), // this month only
    ];
    const s = summarize(rows, NOW);
    expect(s.today.cost).toBeCloseTo(3);
    expect(s.week.cost).toBeCloseTo(6);
    expect(s.month.cost).toBeCloseTo(9);
    expect(s.month.tokens).toBe(3_000_000);
  });

  it('splits by source, highest spend first', () => {
    const rows: UsageRow[] = [
      row({ source: 'detector', model: 'claude-haiku-4-5', in_tokens: 1_000_000 }), // $1
      row({ source: 'chat', in_tokens: 2_000_000 }),                                 // $6
    ];
    const s = summarize(rows, NOW);
    expect(s.bySource[0]).toEqual({ source: 'chat', cost: expect.closeTo(6) });
    expect(s.bySource[1].source).toBe('detector');
  });

  it('ignores rows with unparseable timestamps', () => {
    const s = summarize([row({ in_tokens: 1_000_000, created_at: 'garbage' })], NOW);
    expect(s.month.cost).toBe(0);
  });
});

describe('5-hour burst window', () => {
  it('sums only charges in the last 5h and counts down to when it frees up', () => {
    const rows: UsageRow[] = [
      row({ in_tokens: 1_000_000, created_at: '2026-06-11T13:00:00Z' }), // 2h ago — in window ($3)
      row({ in_tokens: 1_000_000, created_at: '2026-06-11T09:00:00Z' }), // 6h ago — out of window
    ];
    const s = summarize(rows, NOW); // NOW = 15:00Z
    expect(s.fiveHour.cost).toBeCloseTo(3);
    // oldest in-window charge at 13:00 frees at 18:00 → 3h from NOW
    expect(s.fiveHour.resetsInMs).toBe(3 * 3600_000);
  });
  it('is empty with no recent charges (no countdown)', () => {
    const s = summarize([row({ in_tokens: 1_000_000, created_at: '2026-06-10T15:00:00Z' })], NOW);
    expect(s.fiveHour.cost).toBe(0);
    expect(s.fiveHour.resetsInMs).toBe(0);
  });
});

describe('fmtDuration', () => {
  it('formats hours and minutes compactly', () => {
    expect(fmtDuration(3 * 3600_000)).toBe('3h');
    expect(fmtDuration(3 * 3600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(fmtDuration(45 * 60_000)).toBe('45m');
    expect(fmtDuration(0)).toBe('0m');
  });
});

describe('formatting', () => {
  it('formats dollars and token counts compactly', () => {
    expect(fmtUsd(2.413)).toBe('$2.41');
    expect(fmtUsd(123.4)).toBe('$123');
    expect(fmtTokens(950)).toBe('950');
    expect(fmtTokens(12_400)).toBe('12k');
    expect(fmtTokens(2_500_000)).toBe('2.5M');
  });

  it('labels sources in plain language', () => {
    expect(sourceLabel('chat')).toBe('Chat');
    expect(sourceLabel('detector')).toBe('Background checks');
    expect(sourceLabel('tts')).toBe('Tts');
  });
});

describe('monthly budget', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to $100 and round-trips a set value', () => {
    expect(loadBudget()).toBe(100);
    saveBudget(250);
    expect(loadBudget()).toBe(250);
  });
  it('ignores junk and non-positive values', () => {
    saveBudget(0); saveBudget(-5); saveBudget(NaN);
    expect(loadBudget()).toBe(100);
    localStorage.setItem('gf_usage_budget', 'lots');
    expect(loadBudget()).toBe(100);
  });
});
