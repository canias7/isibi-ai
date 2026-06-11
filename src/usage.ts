import { supabase } from './supabase';

// The in-app usage meter (the chip bottom-right of the chat + its sheet).
// Reads the user's OWN ai_usage telemetry rows (RLS select-own) and turns them
// into honest spend ESTIMATES: token counts × Anthropic list prices. Real
// invoices can differ (server-tool surcharges, price changes), which is why
// every figure is presented as an estimate.

export interface UsageRow {
  source: string;            // chat | workflow | detector | …
  model: string;             // claude-sonnet-4-6 | claude-opus-4-8 | claude-haiku-4-5 | …
  in_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  out_tokens: number;
  created_at: string;
}

// $ per MILLION tokens (list prices). Cache write billed at 2× input (the app
// uses 1h-TTL caches); cache read at 10% of input.
const PRICES: Array<{ match: RegExp; inM: number; outM: number }> = [
  { match: /opus/i, inM: 5, outM: 25 },
  { match: /sonnet/i, inM: 3, outM: 15 },
  { match: /haiku/i, inM: 1, outM: 5 },
];
const FALLBACK = { inM: 3, outM: 15 }; // unknown model: price like Sonnet

function priceFor(model: string): { inM: number; outM: number } {
  return PRICES.find((p) => p.match.test(model)) ?? FALLBACK;
}

// Estimated dollars for one row.
export function rowCost(r: UsageRow): number {
  const p = priceFor(r.model);
  return (
    (r.in_tokens * p.inM +
      r.cache_write_tokens * p.inM * 2 +
      r.cache_read_tokens * p.inM * 0.1 +
      r.out_tokens * p.outM) / 1_000_000
  );
}

// What the cached reads WOULD have cost as plain input minus what they cost —
// i.e. the money prompt caching saved.
export function rowCacheSavings(r: UsageRow): number {
  const p = priceFor(r.model);
  return (r.cache_read_tokens * p.inM * 0.9) / 1_000_000;
}

const tokensOf = (r: UsageRow) =>
  r.in_tokens + r.cache_write_tokens + r.cache_read_tokens + r.out_tokens;

export interface UsageSummary {
  today: { cost: number; tokens: number };
  week: { cost: number; tokens: number };   // last 7 days
  month: { cost: number; tokens: number };  // last 30 days
  bySource: Array<{ source: string; cost: number }>; // last 30 days, desc
  cacheSavings: number;                      // last 30 days
}

// Aggregate rows (already ≤30 days old) into the sheet's figures. `now` is
// injectable so tests are deterministic.
export function summarize(rows: UsageRow[], now: Date = new Date()): UsageSummary {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = now.getTime() - 7 * 86400_000;
  const sums = {
    today: { cost: 0, tokens: 0 },
    week: { cost: 0, tokens: 0 },
    month: { cost: 0, tokens: 0 },
  };
  const bySrc = new Map<string, number>();
  let savings = 0;
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (Number.isNaN(t)) continue;
    const cost = rowCost(r);
    const tok = tokensOf(r);
    sums.month.cost += cost; sums.month.tokens += tok;
    if (t >= weekStart) { sums.week.cost += cost; sums.week.tokens += tok; }
    if (t >= dayStart) { sums.today.cost += cost; sums.today.tokens += tok; }
    bySrc.set(r.source, (bySrc.get(r.source) ?? 0) + cost);
    savings += rowCacheSavings(r);
  }
  return {
    ...sums,
    bySource: [...bySrc.entries()].map(([source, cost]) => ({ source, cost })).sort((a, b) => b.cost - a.cost),
    cacheSavings: savings,
  };
}

export const fmtUsd = (n: number): string => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);
export const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n);

// A monthly budget for the spend bar. The meter has no real plan limit to draw
// against (it's pay-as-you-go API spend), so this is the user's OWN ceiling,
// editable in the sheet and stored locally. Default $100.
const BUDGET_KEY = 'gf_usage_budget';
export function loadBudget(): number {
  try { const v = Number(localStorage.getItem(BUDGET_KEY)); return v > 0 && Number.isFinite(v) ? v : 100; } catch { return 100; }
}
export function saveBudget(n: number): void {
  try { if (n > 0 && Number.isFinite(n)) localStorage.setItem(BUDGET_KEY, String(Math.round(n))); } catch { /* private mode */ }
}

// Friendly labels for the telemetry sources.
export function sourceLabel(s: string): string {
  if (s === 'chat') return 'Chat';
  if (s === 'workflow') return 'Workflows';
  if (s === 'detector') return 'Background checks';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The user's own usage rows for the last 30 days (RLS scopes to auth.uid()).
export async function fetchUsage(): Promise<UsageRow[] | null> {
  try {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data, error } = await supabase
      .from('ai_usage')
      .select('source,model,in_tokens,cache_write_tokens,cache_read_tokens,out_tokens,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error || !data) return null;
    return data as UsageRow[];
  } catch {
    return null;
  }
}
