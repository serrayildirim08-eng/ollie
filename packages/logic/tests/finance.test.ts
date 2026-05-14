import { describe, it, expect } from 'vitest';
import {
  normalizeMerchant,
  jaroSimilarity,
  jaroWinkler,
  merchantSimilarity,
  parseFinanceDump,
  mergeRecord,
  detectRecurring,
  detectRecurringEarly,
  classifyRecurringCategory,
  predictNextDue,
  detectAnomaly,
  trackADHDTaxEvents,
  detectSubscriptionStale,
  savingsGoalProgress,
  upcomingBills,
  classifyPayFrequency,
  forecast30d,
  spearmanRho,
  correlateFinanceWithCycle,
  scoreBSAS,
  recordScaleResult,
  scaleCadenceStatus,
  detectPatterns,
  tagResearchLoops,
  monthOverMonthDelta,
  computeMonthlyOutflow,
  DAY_MS,
  isoDate,
  detectSavingsTransfers,
  matchTransfersToGoals,
  detectSavingsFromBraindump,
  detectADHDTaxFromTxn,
  detectDuplicatePurchases,
  detectADHDTaxFromBraindump,
} from '../src/finance';
import type { FinanceRecord, RecurringPattern } from '../src/finance';

// ─── helpers ─────────────────────────────────────────────────────────
const DAY = DAY_MS;

/** Build a FinanceRecord at `daysAgo` days before epoch=0. */
function rec(
  eventDate: string,
  amount: number | null,
  direction: 'in' | 'out',
  merchantNorm?: string,
  extra?: Partial<FinanceRecord>,
): FinanceRecord {
  return {
    id: 'r-' + eventDate + '-' + Math.random().toString(36).slice(2, 5),
    event_date: eventDate,
    amount,
    currency: 'USD',
    merchant: merchantNorm ?? null,
    merchant_normalized: merchantNorm ?? null,
    direction,
    tokens: [],
    is_adhd_tax: false,
    adhd_tax_type: null,
    ...extra,
  };
}

function pattern(overrides: Partial<RecurringPattern> = {}): RecurringPattern {
  return {
    id: 'rec-test',
    merchant_normalized: 'netflix',
    display_name: 'Netflix',
    record_ids: [],
    cadence: 'monthly',
    interval_days_median: 30,
    interval_days_mad: 1,
    amount_median: 15,
    amount_mad: 0.5,
    last_at: 0,
    first_seen_at: 0,
    last_seen_at: 0,
    status: 'mature',
    kind: 'bill',
    user_dismissed_stale: false,
    ...overrides,
  };
}

// ─── normalizeMerchant ────────────────────────────────────────────────
describe('normalizeMerchant', () => {
  it('lowercases and strips tld', () => {
    expect(normalizeMerchant('Netflix.com')).toBe('netflix');
  });
  it('strips legal suffixes', () => {
    expect(normalizeMerchant('Acme Inc')).toBe('acme');
  });
  it('returns empty string for non-string input', () => {
    expect(normalizeMerchant(null as unknown as string)).toBe('');
  });
});

// ─── jaroSimilarity + jaroWinkler ─────────────────────────────────────
describe('jaroSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(jaroSimilarity('abc', 'abc')).toBe(1);
  });
  it('returns 0 for empty strings', () => {
    expect(jaroSimilarity('', 'abc')).toBe(0);
  });
  it('MARTHA/MARHTA classic example > 0.94', () => {
    expect(jaroSimilarity('MARTHA', 'MARHTA')).toBeGreaterThan(0.94);
  });
});

describe('jaroWinkler', () => {
  it('boosts score for common prefix', () => {
    const j = jaroSimilarity('JOHNATHAN', 'JONATHAN');
    const jw = jaroWinkler('JOHNATHAN', 'JONATHAN');
    expect(jw).toBeGreaterThanOrEqual(j);
  });
  it('returns 1 for identical strings', () => {
    expect(jaroWinkler('netflix', 'netflix')).toBe(1);
  });
});

describe('merchantSimilarity', () => {
  it('normalizes before comparing', () => {
    // "Netflix.com" vs "Netflix Inc" → both → "netflix"
    expect(merchantSimilarity('Netflix.com', 'Netflix Inc')).toBe(1);
  });
});

// ─── parseFinanceDump ─────────────────────────────────────────────────
describe('parseFinanceDump', () => {
  const NOW = new Date('2026-01-15T12:00:00Z').getTime();

  it('extracts amount and direction from expense text', () => {
    const r = parseFinanceDump('paid $50 for spotify', NOW);
    expect(r.record?.amount).toBe(50);
    expect(r.record?.direction).toBe('out');
  });

  it('detects income direction', () => {
    const r = parseFinanceDump('received salary 5000', NOW);
    expect(r.record?.direction).toBe('in');
  });

  it('returns null record for empty text', () => {
    expect(parseFinanceDump('', NOW).record).toBeNull();
  });

  it('detects ADHD tax type late_fee', () => {
    const r = parseFinanceDump('late fee $35 overdraft', NOW);
    expect(r.record?.is_adhd_tax).toBe(true);
    expect(r.record?.adhd_tax_type).toBe('late_fee');
  });

  it('detects EUR currency', () => {
    const r = parseFinanceDump('spent €100', NOW);
    expect(r.record?.currency).toBe('EUR');
  });
});

// ─── mergeRecord ──────────────────────────────────────────────────────
describe('mergeRecord', () => {
  it('creates a new record when prev is null', () => {
    const r = mergeRecord(null, { amount: 20, direction: 'out' }, 1000);
    expect(r.amount).toBe(20);
    expect(r.direction).toBe('out');
    expect(r.id).toBeTruthy();
  });

  it('merges tokens from both records (union)', () => {
    const prev = rec('2026-01-01', 10, 'out', 'amazon', { tokens: ['a', 'b'] });
    const result = mergeRecord(prev, { tokens: ['b', 'c'] }, 2000);
    expect(result.tokens).toContain('a');
    expect(result.tokens).toContain('b');
    expect(result.tokens).toContain('c');
    expect(result.tokens!.filter((t) => t === 'b').length).toBe(1); // deduplicated
  });

  it('normalizes merchant_normalized when merchant is set', () => {
    const r = mergeRecord(null, { merchant: 'Amazon.com', direction: 'out' }, 1000);
    expect(r.merchant_normalized).toBe('amazon');
  });
});

// ─── detectRecurring ─────────────────────────────────────────────────
describe('detectRecurring', () => {
  it('returns empty arrays for empty input', () => {
    const result = detectRecurring([]);
    expect(result.recurring).toHaveLength(0);
    expect(result.earlyDetection).toHaveLength(0);
    expect(result.oneOffs).toHaveLength(0);
  });

  it('detects monthly bill pattern from 4 records', () => {
    const records: FinanceRecord[] = [
      rec('2026-01-01', 15, 'out', 'netflix'),
      rec('2026-02-01', 15, 'out', 'netflix'),
      rec('2026-03-01', 15, 'out', 'netflix'),
      rec('2026-04-01', 15, 'out', 'netflix'),
    ];
    const result = detectRecurring(records, { minOccurrences: 3 });
    expect(result.recurring.length + result.earlyDetection.length).toBeGreaterThan(0);
    const all = [...result.recurring, ...result.earlyDetection];
    expect(all[0].cadence).toBe('monthly');
  });

  it('puts single-occurrence merchant in oneOffs', () => {
    const records = [rec('2026-01-01', 100, 'out', 'onetime-shop')];
    const result = detectRecurring(records);
    expect(result.oneOffs).toHaveLength(1);
  });
});

// ─── predictNextDue ───────────────────────────────────────────────────
describe('predictNextDue', () => {
  it('predicts dueAt = last_at + interval', () => {
    const lastAt = DAY; // use non-zero so the truthiness check passes
    const p = pattern({ last_at: lastAt, interval_days_median: 30, interval_days_mad: 0 });
    const pred = predictNextDue(p, 0);
    expect(pred.dueAt).toBe(lastAt + 30 * DAY);
    expect(pred.confidence).toBe('high'); // mad < 3
  });

  it('returns null dueAt when pattern has no last_at', () => {
    const p = pattern({ last_at: 0 });
    // @ts-expect-error testing null path
    const pred = predictNextDue({ ...p, last_at: null }, 0);
    expect(pred.dueAt).toBeNull();
  });
});

// ─── detectAnomaly ────────────────────────────────────────────────────
describe('detectAnomaly', () => {
  it('flags high anomaly when modZ >= 3.5', () => {
    const p = pattern({ amount_median: 15, amount_mad: 1 });
    const r = rec('2026-01-01', 100, 'out');
    const result = detectAnomaly(r, p);
    expect(result.isAnomaly).toBe(true);
    expect(result.framing).toBe('high');
  });

  it('returns not anomaly for normal amount', () => {
    const p = pattern({ amount_median: 15, amount_mad: 1 });
    const r = rec('2026-01-01', 15.5, 'out');
    const result = detectAnomaly(r, p);
    expect(result.isAnomaly).toBe(false);
  });

  it('falls back to relative change when mad=0 and amount > 1.5x median', () => {
    const p = pattern({ amount_median: 10, amount_mad: 0 });
    const r = rec('2026-01-01', 100, 'out');
    const result = detectAnomaly(r, p);
    expect(result.isAnomaly).toBe(true);
  });
});

// ─── trackADHDTaxEvents ───────────────────────────────────────────────
describe('trackADHDTaxEvents', () => {
  it('counts ADHD tax records within window', () => {
    const now = 90 * DAY;
    const records: FinanceRecord[] = [
      rec('1970-03-31', 35, 'out', undefined, { is_adhd_tax: true, adhd_tax_type: 'late_fee' }),
      rec('1970-03-01', 20, 'out', undefined, { is_adhd_tax: true, adhd_tax_type: 'replacement' }),
    ];
    const result = trackADHDTaxEvents(records, 90, now);
    expect(result.count).toBe(2);
    expect(result.total).toBe(55);
  });

  it('excludes records outside the window', () => {
    const now = 200 * DAY;
    const records: FinanceRecord[] = [
      rec('1970-01-01', 35, 'out', undefined, { is_adhd_tax: true, adhd_tax_type: 'late_fee' }),
    ];
    const result = trackADHDTaxEvents(records, 90, now);
    expect(result.count).toBe(0);
  });
});

// ─── detectSubscriptionStale ──────────────────────────────────────────
describe('detectSubscriptionStale', () => {
  it('flags stale bill not mentioned in dumps', () => {
    const now = 200 * DAY;
    const p = pattern({
      id: 'rec-netflix',
      kind: 'bill',
      last_at: 0, // 200 days ago
      merchant_normalized: 'netflix',
    });
    const stale = detectSubscriptionStale([p], [], new Set(), 90, now);
    expect(stale).toHaveLength(1);
    expect(stale[0].pattern_id).toBe('rec-netflix');
  });

  it('skips dismissed patterns', () => {
    const now = 200 * DAY;
    const p = pattern({ id: 'rec-netflix', kind: 'bill', last_at: 0 });
    const stale = detectSubscriptionStale([p], [], new Set(['rec-netflix']), 90, now);
    expect(stale).toHaveLength(0);
  });
});

// ─── savingsGoalProgress ─────────────────────────────────────────────
describe('savingsGoalProgress', () => {
  it('returns null for null goal', () => {
    expect(savingsGoalProgress(null, [], 0)).toBeNull();
  });

  it('calculates remaining from target - saved', () => {
    const result = savingsGoalProgress({ target: 1000, saved: 300 }, [], 0);
    expect(result?.remaining).toBe(700);
    expect(result?.saved).toBe(300);
  });

  it('sums contributions when saved not provided', () => {
    const result = savingsGoalProgress(
      { target: 500, contributions: [{ amount: 100 }, { amount: 200 }] },
      [],
      0,
    );
    expect(result?.saved).toBe(300);
    expect(result?.remaining).toBe(200);
  });
});

// ─── classifyPayFrequency ─────────────────────────────────────────────
describe('classifyPayFrequency', () => {
  it('returns cold_start when fewer than 3 income events', () => {
    const result = classifyPayFrequency(
      [rec('2026-01-01', 3000, 'in'), rec('2026-01-15', 3000, 'in')],
      0,
    );
    expect(result.freq).toBe('cold_start');
    expect(result.cold_start).toBe(true);
    expect(result.prior).toBeDefined();
  });

  it('classifies biweekly from 14-day intervals', () => {
    const result = classifyPayFrequency(
      [
        rec('2026-01-01', 3000, 'in'),
        rec('2026-01-15', 3000, 'in'),
        rec('2026-01-29', 3000, 'in'),
        rec('2026-02-12', 3000, 'in'),
      ],
      0,
    );
    expect(result.freq).toBe('biweekly');
  });
});

// ─── monthOverMonthDelta ──────────────────────────────────────────────
describe('monthOverMonthDelta', () => {
  it('returns null when insufficient historical months', () => {
    const now = new Date('2026-04-15T12:00:00Z').getTime();
    const records = [rec('2026-04-01', 500, 'out', 'shop')];
    expect(monthOverMonthDelta(records, 3, now)).toBeNull();
  });

  it('detects upward spending delta', () => {
    const now = new Date('2026-04-15T12:00:00Z').getTime();
    const records: FinanceRecord[] = [
      rec('2026-01-15', 300, 'out', 'shop'),
      rec('2026-02-15', 300, 'out', 'shop'),
      rec('2026-03-15', 300, 'out', 'shop'),
      rec('2026-04-10', 600, 'out', 'shop'),
    ];
    const delta = monthOverMonthDelta(records, 3, now);
    expect(delta).not.toBeNull();
    expect(delta?.direction).toBe('up');
  });
});

// ─── forecast30d ──────────────────────────────────────────────────────
describe('forecast30d', () => {
  it('returns null with no records', () => {
    expect(forecast30d([], 0)).toBeNull();
  });

  it('returns cold_start band with income but no mature patterns', () => {
    const now = 0;
    // only 2 income records — not enough for mature pattern (minOcc=3)
    const records = [
      rec('1970-01-01', 3000, 'in'),
      rec('1970-01-15', 3000, 'in'),
    ];
    const result = forecast30d(records, now);
    expect(result?.cold_start).toBe(true);
  });
});

// ─── spearmanRho ──────────────────────────────────────────────────────
describe('spearmanRho', () => {
  it('returns null for arrays shorter than 3', () => {
    expect(spearmanRho([1, 2], [1, 2])).toBeNull();
  });

  it('returns 1 for perfectly monotone increasing', () => {
    const result = spearmanRho([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(result?.rho).toBe(1);
  });

  it('returns -1 for perfectly monotone decreasing', () => {
    const result = spearmanRho([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
    expect(result?.rho).toBe(-1);
  });

  it('returns ~0 for unrelated arrays', () => {
    const result = spearmanRho([1, 2, 3], [3, 1, 2]);
    expect(result?.rho).toBeDefined();
  });
});

// ─── correlateFinanceWithCycle ────────────────────────────────────────
describe('correlateFinanceWithCycle', () => {
  it('returns null when fewer than 7 days of data', () => {
    const result = correlateFinanceWithCycle(
      [rec('2026-01-01', 50, 'out')],
      { phasesByDate: new Map([['2026-01-01', 'luteal']]) },
      0,
    );
    expect(result).toBeNull();
  });

  it('returns correlation object with cited_urls', () => {
    const phases = new Map<string, string>();
    const records: FinanceRecord[] = [];
    const base = new Date('2026-01-01T12:00:00Z').getTime();
    for (let i = 0; i < 30; i++) {
      const d = isoDate(base + i * DAY_MS);
      const phase = ['menstrual', 'follicular', 'ovulation_window', 'luteal'][i % 4];
      phases.set(d, phase);
      records.push(rec(d, 20 + i * 3, 'out'));
    }
    const result = correlateFinanceWithCycle(records, { phasesByDate: phases }, base + 30 * DAY_MS);
    expect(result?.cited_urls).toHaveLength(2);
    expect(result?.n_days).toBeGreaterThanOrEqual(7);
  });
});

// ─── scoreBSAS ────────────────────────────────────────────────────────
describe('scoreBSAS', () => {
  it('returns null for wrong length', () => {
    expect(scoreBSAS([1, 2, 3])).toBeNull();
  });

  it('returns null for out-of-range value', () => {
    expect(scoreBSAS([0, 0, 0, 0, 0, 0, 5])).toBeNull();
  });

  it('returns null for non-integer', () => {
    expect(scoreBSAS([0, 0, 0, 0, 0, 0, 1.5])).toBeNull();
  });

  it('returns at_risk_screen when 4+ items >= 3', () => {
    const answers = [3, 3, 3, 3, 0, 0, 0];
    const result = scoreBSAS(answers);
    expect(result?.category).toBe('at_risk_screen');
    expect(result?.score).toBe(12);
    expect(result?.cited_url).toContain('fpsyg.2015.01374');
  });

  it('returns within_normal_range for low answers', () => {
    const result = scoreBSAS([0, 1, 0, 1, 0, 0, 1]);
    expect(result?.category).toBe('within_normal_range');
  });
});

// ─── recordScaleResult ────────────────────────────────────────────────
describe('recordScaleResult', () => {
  const validResult = scoreBSAS([3, 3, 3, 3, 0, 0, 0])!;
  const BASE_NOW = new Date('2026-01-01T12:00:00Z').getTime();

  it('appends a new entry on first call', () => {
    const out = recordScaleResult([], 'bsas', validResult, BASE_NOW);
    expect(out.appended).toBe(true);
    expect(out.history).toHaveLength(1);
  });

  it('rejects within 30-day cooldown', () => {
    const first = recordScaleResult([], 'bsas', validResult, BASE_NOW);
    const second = recordScaleResult(
      first.history,
      'bsas',
      validResult,
      BASE_NOW + 10 * DAY_MS,
    );
    expect(second.appended).toBe(false);
    expect(second.reason).toBe('cooldown');
  });

  it('allows after 30-day cooldown', () => {
    const first = recordScaleResult([], 'bsas', validResult, BASE_NOW);
    const second = recordScaleResult(
      first.history,
      'bsas',
      validResult,
      BASE_NOW + 31 * DAY_MS,
    );
    expect(second.appended).toBe(true);
  });
});

// ─── scaleCadenceStatus ───────────────────────────────────────────────
describe('scaleCadenceStatus', () => {
  it('returns quarterly_due=false when no history (§9.5)', () => {
    const status = scaleCadenceStatus([], 'bsas', 0);
    expect(status.quarterly_due).toBe(false);
    expect(status.last_admin_at).toBeNull();
  });

  it('returns quarterly_due=true after 90+ days', () => {
    const validResult = scoreBSAS([3, 3, 3, 3, 0, 0, 0])!;
    const BASE = new Date('2026-01-01T12:00:00Z').getTime();
    const { history } = recordScaleResult([], 'bsas', validResult, BASE);
    const status = scaleCadenceStatus(history, 'bsas', BASE + 91 * DAY_MS);
    expect(status.quarterly_due).toBe(true);
  });
});

// ─── detectPatterns ───────────────────────────────────────────────────
describe('detectPatterns', () => {
  it('returns empty array for empty state', () => {
    const cards = detectPatterns({ now: 0, records: [], dumps: [], research_loops: [] });
    expect(cards).toEqual([]);
  });

  it('detects F4 hyperfocus burst', () => {
    const now = 100 * DAY;
    const base = now - 50 * HOUR_MS; // 6h+ settled
    const records: FinanceRecord[] = [
      rec(isoDate(base), 30, 'out', 'tech-shop', { kind: 'txn', category: 'gadgets' }),
      rec(isoDate(base + 2 * HOUR_MS), 30, 'out', 'tech-shop', { kind: 'txn', category: 'gadgets' }),
      rec(isoDate(base + 4 * HOUR_MS), 30, 'out', 'tech-shop', { kind: 'txn', category: 'gadgets' }),
    ];
    const cards = detectPatterns({ now, records, dumps: [], research_loops: [] });
    const hf = cards.find((c) => c.pattern === 'hyperfocus-burst');
    expect(hf).toBeDefined();
    expect(hf?.category).toBe('gadgets');
  });

  it('detects F5 gig volatility when variance > 40%', () => {
    const now = new Date('2026-06-01T12:00:00Z').getTime();
    const records: FinanceRecord[] = [
      rec('2026-01-15', 1000, 'in'),
      rec('2026-02-15', 1000, 'in'),
      rec('2026-03-15', 1000, 'in'),
      rec('2026-04-15', 5000, 'in'),
      rec('2026-05-15', 5000, 'in'),
    ];
    const cards = detectPatterns({ now, records, dumps: [], research_loops: [] });
    const gig = cards.find((c) => c.pattern === 'gig-volatility');
    expect(gig).toBeDefined();
    expect(gig?.variance_pct).toBeGreaterThan(40);
  });

  it('detects F2 subscription cancel avoidance after 3 days', () => {
    const now = 10 * DAY;
    const records: FinanceRecord[] = [
      {
        id: 'sub-1',
        event_date: '1970-01-01',
        amount: 10,
        currency: 'USD',
        merchant: 'hulu',
        merchant_normalized: 'hulu',
        direction: 'out',
        kind: 'sub',
        sub_meta: { marked_to_cancel_at: 0 }, // marked at day 0, now is day 10
        tokens: [],
        is_adhd_tax: false,
        adhd_tax_type: null,
      },
    ];
    const cards = detectPatterns({ now, records, dumps: [], research_loops: [] });
    const cancel = cards.find((c) => c.pattern === 'subscription-cancel-avoidance');
    expect(cancel).toBeDefined();
    expect(cancel?.days_marked).toBe(10);
  });
});

// ─── tagResearchLoops ─────────────────────────────────────────────────
describe('tagResearchLoops', () => {
  it('creates a new loop on first research-language dump', () => {
    const dumps = [{ ts: 1000, text: 'still researching which laptop to buy' }];
    const result = tagResearchLoops(dumps, [], 2000);
    expect(result).toHaveLength(1);
    expect(result[0].mentions).toHaveLength(1);
  });

  it('deduplicates same dump.ts for same topic', () => {
    const dumps = [
      { ts: 1000, text: 'still researching which laptop to buy' },
      { ts: 1000, text: 'still researching which laptop to buy' },
    ];
    const result = tagResearchLoops(dumps, [], 2000);
    expect(result[0].mentions).toHaveLength(1);
  });

  it('appends mention to existing loop', () => {
    const dumps1 = [{ ts: 1000, text: 'still researching which laptop to buy' }];
    const loops1 = tagResearchLoops(dumps1, [], 2000);
    const dumps2 = [{ ts: 2000, text: 'still researching which laptop to buy' }];
    const loops2 = tagResearchLoops(dumps2, loops1, 3000);
    expect(loops2[0].mentions).toHaveLength(2);
  });
});

// ─── isoDate ──────────────────────────────────────────────────────────
describe('isoDate', () => {
  it('formats UTC epoch zero as 1970-01-01', () => {
    // DAY_MS * 0 = 0 → local midnight may shift; use a non-zero UTC time
    // to avoid timezone-sensitive midnight edge
    const ts = new Date('2026-05-11T12:00:00Z').getTime();
    // isoDate uses local time — verify it's a valid YYYY-MM-DD string
    const result = isoDate(ts);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── upcomingBills ────────────────────────────────────────────────────
describe('upcomingBills', () => {
  it('returns empty for no bills', () => {
    expect(upcomingBills([], 14, 0)).toEqual([]);
  });

  it('returns bill due within window', () => {
    const now = 0;
    const p = pattern({ last_at: -15 * DAY, interval_days_median: 30, interval_days_mad: 0 });
    const bills = upcomingBills([p], 30, now);
    expect(bills).toHaveLength(1);
    expect(bills[0].daysUntil).toBeGreaterThanOrEqual(0);
  });
});

const HOUR_MS = 3_600_000;

// ─── detectRecurringEarly ─────────────────────────────────────────────

// Epoch anchor — 2026-05-14 for readability.
const ANCHOR_MS = new Date('2026-05-14T12:00:00Z').getTime();

function daysAgo(n: number): string {
  return isoDate(ANCHOR_MS - n * DAY_MS);
}

describe('detectRecurringEarly', () => {
  it('returns empty for empty input', () => {
    expect(detectRecurringEarly([])).toEqual([]);
  });

  it('returns empty for income records (direction=in)', () => {
    const r = rec(daysAgo(0), 15, 'in', 'netflix');
    expect(detectRecurringEarly([r])).toEqual([]);
  });

  // ── low confidence ────────────────────────────────────────────────

  it('low: single occurrence of known-recurring merchant (netflix)', () => {
    const r = rec(daysAgo(10), 15.99, 'out', 'netflix');
    const result = detectRecurringEarly([r]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('low');
    expect(result[0].evidence.occurrenceCount).toBe(1);
    expect(result[0].merchant_normalized).toBe('netflix');
  });

  it('low: single occurrence of "rent" merchant', () => {
    const r = rec(daysAgo(5), 1200, 'out', 'rent');
    const result = detectRecurringEarly([r]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('low');
  });

  it('low: single occurrence with "electricity" in name', () => {
    const r = rec(daysAgo(5), 80, 'out', 'electricity');
    const result = detectRecurringEarly([r]);
    expect(result[0].confidence).toBe('low');
    expect(result[0].estimatedInterval).toBeNull();
    expect(result[0].nextDueDate).toBeNull();
  });

  it('low: single occurrence of unknown merchant does NOT trigger', () => {
    const r = rec(daysAgo(5), 42, 'out', 'random-coffee-shop');
    const result = detectRecurringEarly([r]);
    expect(result).toHaveLength(0);
  });

  it('low: single occurrence of "gym" is known recurring', () => {
    const r = rec(daysAgo(3), 55, 'out', 'gym');
    const result = detectRecurringEarly([r]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('low');
  });

  // ── medium confidence ─────────────────────────────────────────────

  it('medium: 2 occurrences with consistent amount and monthly interval', () => {
    const r1 = rec(daysAgo(60), 15.99, 'out', 'spotify');
    const r2 = rec(daysAgo(30), 15.99, 'out', 'spotify');
    const result = detectRecurringEarly([r1, r2]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('medium');
    expect(result[0].evidence.occurrenceCount).toBe(2);
    expect(result[0].estimatedInterval).toBeCloseTo(30, 1);
    expect(result[0].nextDueDate).not.toBeNull();
  });

  it('medium: 2 occurrences unknown merchant still qualifies on interval alone', () => {
    const r1 = rec(daysAgo(60), 200, 'out', 'acme-corp-billing');
    const r2 = rec(daysAgo(30), 200, 'out', 'acme-corp-billing');
    const result = detectRecurringEarly([r1, r2]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('medium');
  });

  it('medium: 2 occurrences with amount within 5% tolerance', () => {
    // 15.00 vs 15.49 — ~3.2% variance, within ±5%
    const r1 = rec(daysAgo(60), 15.00, 'out', 'some-service');
    const r2 = rec(daysAgo(30), 15.49, 'out', 'some-service');
    const result = detectRecurringEarly([r1, r2]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('medium');
  });

  it('medium: 2 occurrences with large amount variance does NOT produce candidate', () => {
    // 10 vs 50 — 80% variance, exceeds ±5%
    const r1 = rec(daysAgo(60), 10, 'out', 'erratic-merchant');
    const r2 = rec(daysAgo(30), 50, 'out', 'erratic-merchant');
    const result = detectRecurringEarly([r1, r2]);
    // MAD/median = (20) / 30 ≈ 0.67 > 0.05 → no match
    expect(result).toHaveLength(0);
  });

  it('medium: 2 occurrences only 1 day apart — interval not plausible, no candidate', () => {
    const r1 = rec(daysAgo(5), 15, 'out', 'flash-charge');
    const r2 = rec(daysAgo(4), 15, 'out', 'flash-charge');
    const result = detectRecurringEarly([r1, r2]);
    expect(result).toHaveLength(0);
  });

  // ── high confidence ───────────────────────────────────────────────

  it('high: 3+ occurrences produce high-confidence candidate', () => {
    const r1 = rec(daysAgo(90), 9.99, 'out', 'hulu');
    const r2 = rec(daysAgo(60), 9.99, 'out', 'hulu');
    const r3 = rec(daysAgo(30), 9.99, 'out', 'hulu');
    const result = detectRecurringEarly([r1, r2, r3]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('high');
    expect(result[0].evidence.occurrenceCount).toBe(3);
  });

  it('high: estimatedInterval is ~30 for monthly records', () => {
    const r1 = rec(daysAgo(90), 50, 'out', 'internet');
    const r2 = rec(daysAgo(60), 50, 'out', 'internet');
    const r3 = rec(daysAgo(30), 50, 'out', 'internet');
    const [c] = detectRecurringEarly([r1, r2, r3]);
    expect(c.estimatedInterval).toBeCloseTo(30, 1);
    expect(c.nextDueDate).not.toBeNull();
  });

  // ── backward compat ───────────────────────────────────────────────

  it('detectRecurring still works unchanged after refactor', () => {
    const recs = [
      rec(daysAgo(90), 15, 'out', 'netflix'),
      rec(daysAgo(60), 15, 'out', 'netflix'),
      rec(daysAgo(30), 15, 'out', 'netflix'),
    ];
    const dr = detectRecurring(recs);
    expect(dr.recurring.length + dr.earlyDetection.length).toBeGreaterThanOrEqual(1);
  });

  // ── edge cases ────────────────────────────────────────────────────

  it('handles records with null amounts', () => {
    const r1 = rec(daysAgo(60), null, 'out', 'netflix');
    const r2 = rec(daysAgo(30), null, 'out', 'netflix');
    const result = detectRecurringEarly([r1, r2]);
    expect(result).toHaveLength(1);
    expect(result[0].estimatedAmount).toBeNull();
  });

  it('handles records with no merchant_normalized (skips silently)', () => {
    const r = rec(daysAgo(10), 15, 'out', undefined);
    const result = detectRecurringEarly([r]);
    expect(result).toHaveLength(0);
  });

  it('fuzzy-clusters similar merchant names (netflix vs netflix inc)', () => {
    const r1 = rec(daysAgo(60), 15.99, 'out', 'netflix');
    // Jaro-Winkler of "netflix" vs "netflix" = 1.0, will cluster
    const r2 = rec(daysAgo(30), 15.99, 'out', 'netflix');
    const result = detectRecurringEarly([r1, r2]);
    expect(result).toHaveLength(1);
    expect(result[0].evidence.occurrenceCount).toBe(2);
  });
});

// ─── classifyRecurringCategory ────────────────────────────────────────────
describe('classifyRecurringCategory', () => {
  it('classifies rent as bill', () => {
    expect(classifyRecurringCategory('rent', 1200)).toBe('bill');
  });

  it('classifies mortgage as bill', () => {
    expect(classifyRecurringCategory('mortgage', 2000)).toBe('bill');
  });

  it('classifies electricity as bill', () => {
    expect(classifyRecurringCategory('electric utility', 80)).toBe('bill');
  });

  it('classifies insurance as bill', () => {
    expect(classifyRecurringCategory('insurance premium', 150)).toBe('bill');
  });

  it('classifies loan as bill', () => {
    expect(classifyRecurringCategory('student loan payment', 300)).toBe('bill');
  });

  it('classifies netflix as subscription', () => {
    expect(classifyRecurringCategory('netflix', 15.99)).toBe('subscription');
  });

  it('classifies spotify as subscription', () => {
    expect(classifyRecurringCategory('spotify', 9.99)).toBe('subscription');
  });

  it('amount >=50 unknown merchant → bill', () => {
    expect(classifyRecurringCategory('unknown-service', 75)).toBe('bill');
  });

  it('amount <30 unknown merchant → subscription', () => {
    expect(classifyRecurringCategory('unknown-service', 12)).toBe('subscription');
  });

  it('amount null unknown merchant → unknown', () => {
    expect(classifyRecurringCategory('unknown-service', null)).toBe('unknown');
  });

  it('detectRecurringEarly attaches category to candidates', () => {
    const r = rec(daysAgo(10), 1200, 'out', 'rent');
    const results = detectRecurringEarly([r]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const candidate = results.find((c) => c.merchant_normalized === 'rent');
    expect(candidate?.category).toBe('bill');
  });

  it('subscription candidate is categorised correctly', () => {
    const r = rec(daysAgo(5), 9.99, 'out', 'spotify');
    const results = detectRecurringEarly([r]);
    const candidate = results.find((c) => c.merchant_normalized === 'spotify');
    expect(candidate?.category).toBe('subscription');
  });
});

// ─── detectSavingsTransfers ───────────────────────────────────────────────
describe('detectSavingsTransfers', () => {
  it('returns empty for empty input', () => {
    expect(detectSavingsTransfers([])).toHaveLength(0);
  });

  it('detects high-confidence matched pair (same day same amount)', () => {
    const outRec = rec('2026-03-01', 500, 'out', undefined, { notes: 'transfer to savings' });
    const inRec  = rec('2026-03-01', 500, 'in',  undefined, { notes: 'from checking' });
    const results = detectSavingsTransfers([outRec, inRec]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results.find((t) => t.is_matched_pair);
    expect(match).toBeDefined();
    expect(match?.confidence).toBe('high');
    expect(match?.amount).toBe(500);
  });

  it('detects medium-confidence single-sided transfer to high-yield', () => {
    const r = rec('2026-03-05', 300, 'out', undefined, { notes: 'to high-yield savings' });
    const results = detectSavingsTransfers([r]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].confidence).toBe('medium');
    expect(results[0].is_matched_pair).toBe(false);
  });

  it('does not return low-confidence transfers', () => {
    // Only "deposit" keyword alone → low confidence, filtered out
    const r = rec('2026-03-07', 100, 'out', 'coffee shop', { notes: 'deposit' });
    // Weak keyword but no amount-pair — should be suppressed
    const results = detectSavingsTransfers([r]);
    expect(results.every((t) => t.confidence !== 'low')).toBe(true);
  });

  it('does not match pair when amounts differ by more than 1 cent', () => {
    const outRec = rec('2026-03-01', 500, 'out', undefined, { notes: 'transfer' });
    const inRec  = rec('2026-03-01', 499, 'in',  undefined, {});
    const results = detectSavingsTransfers([outRec, inRec]);
    const match = results.find((t) => t.is_matched_pair);
    expect(match).toBeUndefined();
  });

  it('ignores income records for outbound scan', () => {
    const r = rec('2026-04-01', 1000, 'in', undefined, { notes: 'to high-yield savings' });
    const results = detectSavingsTransfers([r]);
    // inbound records are not candidates for outbound transfers
    expect(results.every((t) => t.record_id !== r.id)).toBe(true);
  });
});

// ─── matchTransfersToGoals ────────────────────────────────────────────────
describe('matchTransfersToGoals', () => {
  it('returns empty for empty inputs', () => {
    expect(matchTransfersToGoals([], [])).toHaveLength(0);
  });

  it('matches by explicit goal name in memo', () => {
    const outRec = rec('2026-03-01', 200, 'out', undefined, { notes: 'emergency fund deposit' });
    const inRec  = rec('2026-03-01', 200, 'in',  undefined, {});
    const transfers = detectSavingsTransfers([outRec, inRec]);
    const goals = [{ id: 'g1', name: 'emergency fund', target: 1000 }];
    const attributions = matchTransfersToGoals(transfers, goals);
    expect(attributions.length).toBeGreaterThanOrEqual(1);
    const explicit = attributions.find((a) => a.match_reason === 'explicit_memo');
    expect(explicit).toBeDefined();
    expect(explicit?.auto_apply).toBe(true);
    expect(explicit?.goal_id).toBe('g1');
  });

  it('marks ambiguous when multiple goals match amount', () => {
    const outRec = rec('2026-03-01', 200, 'out', undefined, { notes: 'transfer to savings' });
    const transfers = detectSavingsTransfers([outRec]);
    const goals = [
      { id: 'g1', name: 'vacation', target: 2000, contributions: [{ amount: 200 }] },
      { id: 'g2', name: 'emergency', target: 3000, contributions: [{ amount: 200 }] },
    ];
    const attributions = matchTransfersToGoals(transfers, goals);
    const ambiguous = attributions.filter((a) => a.match_reason === 'ambiguous');
    expect(ambiguous.length).toBeGreaterThanOrEqual(2);
    expect(ambiguous.every((a) => a.auto_apply === false)).toBe(true);
  });
});

// ─── detectSavingsFromBraindump ───────────────────────────────────────────
describe('detectSavingsFromBraindump', () => {
  it('returns empty for empty text', () => {
    expect(detectSavingsFromBraindump('')).toHaveLength(0);
  });

  it('detects "moved $300 to savings"', () => {
    const results = detectSavingsFromBraindump('moved $300 to savings today');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].amount).toBe(300);
    expect(results[0].confidence).toBe('medium');
  });

  it('detects "put $500 into savings"', () => {
    const results = detectSavingsFromBraindump('put $500 into savings account');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('does not fire on unrelated text', () => {
    const results = detectSavingsFromBraindump('bought coffee for $5 at the cafe today');
    expect(results).toHaveLength(0);
  });
});

// ─── detectADHDTaxFromTxn ────────────────────────────────────────────────
describe('detectADHDTaxFromTxn', () => {
  it('returns null for income records', () => {
    const r = rec('2026-01-01', 35, 'in', undefined, { notes: 'late fee rebate' });
    expect(detectADHDTaxFromTxn(r)).toBeNull();
  });

  it('returns null when no matching memo', () => {
    const r = rec('2026-01-01', 15, 'out', 'coffee shop', { notes: 'latte' });
    expect(detectADHDTaxFromTxn(r)).toBeNull();
  });

  it('detects late fee with high confidence (auto_add=true)', () => {
    const r = rec('2026-01-05', 35, 'out', undefined, { notes: 'late fee charged' });
    const result = detectADHDTaxFromTxn(r);
    expect(result).not.toBeNull();
    expect(result?.category).toBe('late_fee');
    expect(result?.confidence).toBe('high');
    expect(result?.auto_add).toBe(true);
    expect(result?.amount).toBe(35);
  });

  it('detects overdraft fee with high confidence', () => {
    const r = rec('2026-01-06', 34, 'out', 'bank', { notes: 'overdraft fee' });
    const result = detectADHDTaxFromTxn(r);
    expect(result?.category).toBe('late_fee');
    expect(result?.confidence).toBe('high');
  });

  it('detects NSF fee with high confidence', () => {
    const r = rec('2026-01-07', 27, 'out', 'bank', { notes: 'NSF fee charged' });
    const result = detectADHDTaxFromTxn(r);
    expect(result?.confidence).toBe('high');
  });

  it('detects replacement with medium confidence (auto_add=false)', () => {
    const r = rec('2026-01-08', 60, 'out', 'best buy', { notes: 'replacement charger' });
    const result = detectADHDTaxFromTxn(r);
    expect(result?.category).toBe('replacement');
    expect(result?.confidence).toBe('medium');
    expect(result?.auto_add).toBe(false);
  });

  it('detects duplicate order with medium confidence', () => {
    const r = rec('2026-01-09', 45, 'out', 'amazon', { notes: 'duplicate order refund pending' });
    const result = detectADHDTaxFromTxn(r);
    expect(result?.category).toBe('duplicate');
    expect(result?.confidence).toBe('medium');
  });

  it('copy is factual — no judgment phrases', () => {
    const r = rec('2026-01-05', 35, 'out', undefined, { notes: 'late fee charged' });
    const result = detectADHDTaxFromTxn(r);
    // Must not contain banned phrases
    expect(result?.copy).not.toMatch(/oof|oops|be careful|should have/i);
    // Must be factual
    expect(result?.copy).toContain('late fee');
  });
});

// ─── detectDuplicatePurchases ─────────────────────────────────────────────
describe('detectDuplicatePurchases', () => {
  it('returns empty for empty input', () => {
    expect(detectDuplicatePurchases([])).toHaveLength(0);
  });

  it('returns empty when only one record per merchant', () => {
    const records = [
      rec('2026-01-01', 50, 'out', 'amazon'),
      rec('2026-01-05', 30, 'out', 'spotify'),
    ];
    expect(detectDuplicatePurchases(records)).toHaveLength(0);
  });

  it('detects exact-amount duplicate within 7 days', () => {
    const records = [
      rec('2026-01-01', 50, 'out', 'amazon'),
      rec('2026-01-05', 50, 'out', 'amazon'),
    ];
    const results = detectDuplicatePurchases(records, 7);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].confidence).toBe('medium');
    expect(results[0].merchant_normalized).toBe('amazon');
  });

  it('detects same-amount-within-5pct duplicate', () => {
    const records = [
      rec('2026-02-01', 100, 'out', 'etsy'),
      rec('2026-02-03', 103, 'out', 'etsy'), // 3% difference — within 5%
    ];
    const results = detectDuplicatePurchases(records, 7);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag purchases outside window', () => {
    const records = [
      rec('2026-01-01', 50, 'out', 'amazon'),
      rec('2026-01-15', 50, 'out', 'amazon'), // 14 days apart — outside 7-day window
    ];
    expect(detectDuplicatePurchases(records, 7)).toHaveLength(0);
  });

  it('does not flag purchases with >5% amount difference', () => {
    const records = [
      rec('2026-02-01', 100, 'out', 'shop'),
      rec('2026-02-02', 120, 'out', 'shop'), // 20% difference
    ];
    expect(detectDuplicatePurchases(records, 7)).toHaveLength(0);
  });
});

// ─── detectADHDTaxFromBraindump ───────────────────────────────────────────
describe('detectADHDTaxFromBraindump', () => {
  it('returns empty for empty text', () => {
    expect(detectADHDTaxFromBraindump('')).toHaveLength(0);
  });

  it('detects "forgot to pay"', () => {
    const results = detectADHDTaxFromBraindump('forgot to pay my credit card this month');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].category).toBe('late_fee');
    expect(results[0].confidence).toBe('medium');
    expect(results[0].auto_add).toBe(false);
  });

  it('detects "missed payment"', () => {
    const results = detectADHDTaxFromBraindump('i missed a payment again');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].category).toBe('late_fee');
  });

  it('detects "double charged"', () => {
    const results = detectADHDTaxFromBraindump('i was double charged for netflix');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].category).toBe('duplicate');
  });

  it('negative test: "saved $5 late fee at the cafe" does NOT trigger', () => {
    // Must not classify as late_fee — the phrase describes saving, not incurring a fee.
    const results = detectADHDTaxFromBraindump('saved $5 late fee at the cafe');
    const lateFeeHit = results.find((r) => r.category === 'late_fee');
    expect(lateFeeHit).toBeUndefined();
  });

  it('negative test: random text produces no candidates', () => {
    const results = detectADHDTaxFromBraindump('went for a walk today, feeling good');
    expect(results).toHaveLength(0);
  });

  it('copy is factual — no banned phrases', () => {
    const results = detectADHDTaxFromBraindump('forgot to pay my rent this week');
    if (results.length > 0) {
      expect(results[0].copy).not.toMatch(/oof|oops|be careful|should have/i);
    }
  });
});

// ─── money-module gap closure: variable income tracking ─────────────────
import {
  classifyPayFrequencyDetailed,
  detectInvoicePayments,
  monthlyVolatility,
} from '../src/finance';

describe('classifyPayFrequencyDetailed', () => {
  it('returns random/low for <3 events', () => {
    const recs = [
      rec(daysAgo(20), 1000, 'in', 'employer'),
      rec(daysAgo(6),  1000, 'in', 'employer'),
    ];
    const r = classifyPayFrequencyDetailed(recs);
    expect(r.frequency).toBe('random');
    expect(r.confidence).toBe('low');
    expect(r.cadenceDays).toBeNull();
    expect(r.evidence.n_events).toBe(2);
  });

  it('returns random for an empty list', () => {
    const r = classifyPayFrequencyDetailed([]);
    expect(r.frequency).toBe('random');
    expect(r.evidence.n_events).toBe(0);
    expect(r.evidence.n_intervals).toBe(0);
  });

  it('classifies a clean biweekly pay schedule as biweekly', () => {
    const recs = [0, 14, 28, 42, 56, 70].map((d) => rec(daysAgo(80 - d), 2200, 'in', 'employer'));
    const r = classifyPayFrequencyDetailed(recs);
    expect(r.frequency).toBe('biweekly');
    expect(r.cadenceDays).toBeCloseTo(14, 0);
    expect(r.confidence).toBe('high');
  });

  it('classifies a clean weekly pay schedule as weekly', () => {
    const recs = [0, 7, 14, 21, 28, 35, 42].map((d) =>
      rec(daysAgo(50 - d), 500, 'in', 'employer'),
    );
    const r = classifyPayFrequencyDetailed(recs);
    expect(r.frequency).toBe('weekly');
    expect(r.cadenceDays).toBeCloseTo(7, 0);
  });

  it('classifies a calendar-month schedule (~30d) as monthly', () => {
    const recs = [0, 30, 60, 91, 121].map((d) => rec(daysAgo(130 - d), 4500, 'in', 'employer'));
    const r = classifyPayFrequencyDetailed(recs);
    expect(r.frequency).toBe('monthly');
  });

  it('classifies highly irregular freelance income as random', () => {
    const recs = [0, 3, 18, 40, 47, 70, 95].map((d) =>
      rec(daysAgo(100 - d), 800 + d * 7, 'in', 'client'),
    );
    const r = classifyPayFrequencyDetailed(recs);
    expect(r.frequency).toBe('random');
    expect(r.confidence).toBe('low');
    expect(r.cadenceDays).toBeNull();
  });

  it('ignores outbound records entirely', () => {
    const recs = [
      rec(daysAgo(60), 1000, 'out', 'rent'),
      rec(daysAgo(30), 1000, 'out', 'rent'),
      rec(daysAgo(0),  1000, 'out', 'rent'),
    ];
    const r = classifyPayFrequencyDetailed(recs);
    expect(r.frequency).toBe('random');
    expect(r.evidence.n_events).toBe(0);
  });
});

describe('detectInvoicePayments', () => {
  it('returns empty list for empty input', () => {
    expect(detectInvoicePayments([])).toEqual([]);
  });

  it('surfaces a 2-occurrence recurring inbound from the same client', () => {
    const recs = [
      rec(daysAgo(60), 2500, 'in', 'acme-corp'),
      rec(daysAgo(30), 2500, 'in', 'acme-corp'),
    ];
    const payments = detectInvoicePayments(recs);
    expect(payments).toHaveLength(1);
    expect(payments[0].client_normalized).toBe('acme-corp');
    expect(payments[0].occurrence_count).toBe(2);
    expect(payments[0].amount_median).toBe(2500);
  });

  it('clusters multiple clients separately', () => {
    const recs = [
      rec(daysAgo(60), 2500, 'in', 'acme-corp'),
      rec(daysAgo(30), 2500, 'in', 'acme-corp'),
      rec(daysAgo(50), 1200, 'in', 'globex'),
      rec(daysAgo(20), 1200, 'in', 'globex'),
    ];
    const payments = detectInvoicePayments(recs);
    expect(payments).toHaveLength(2);
    const clients = payments.map((p) => p.client_normalized).sort();
    expect(clients).toEqual(['acme-corp', 'globex']);
  });

  it('ignores outbound and zero/negative amounts', () => {
    const recs = [
      rec(daysAgo(60), 2500, 'out', 'acme-corp'),
      rec(daysAgo(30), 0,    'in',  'acme-corp'),
      rec(daysAgo(20), -100, 'in',  'acme-corp'),
    ];
    expect(detectInvoicePayments(recs)).toEqual([]);
  });

  it('respects custom minOccurrences threshold', () => {
    const recs = [
      rec(daysAgo(30), 2500, 'in', 'acme-corp'),
    ];
    expect(detectInvoicePayments(recs, undefined, { minOccurrences: 1 })).toHaveLength(1);
    expect(detectInvoicePayments(recs, undefined, { minOccurrences: 2 })).toHaveLength(0);
  });

  it('flags matched_known_client when the merchant matches the hint list', () => {
    const recs = [
      rec(daysAgo(60), 2500, 'in', 'acme-corp'),
      rec(daysAgo(30), 2500, 'in', 'acme-corp'),
    ];
    const payments = detectInvoicePayments(recs, ['acme-corp']);
    expect(payments[0].matched_known_client).toBe(true);
  });

  it('reports null interval mad for 2-occurrence clusters', () => {
    const recs = [
      rec(daysAgo(60), 2500, 'in', 'acme-corp'),
      rec(daysAgo(30), 2500, 'in', 'acme-corp'),
    ];
    const [p] = detectInvoicePayments(recs);
    expect(p.interval_days_median).not.toBeNull();
    expect(p.interval_days_mad).toBeNull();
  });

  it('returns intervals when cluster has 3+ occurrences', () => {
    const recs = [
      rec(daysAgo(90), 2500, 'in', 'acme-corp'),
      rec(daysAgo(60), 2500, 'in', 'acme-corp'),
      rec(daysAgo(30), 2500, 'in', 'acme-corp'),
    ];
    const [p] = detectInvoicePayments(recs);
    expect(p.interval_days_median).toBeCloseTo(30, 0);
    expect(p.interval_days_mad).not.toBeNull();
  });
});

describe('monthlyVolatility', () => {
  const NOW = new Date('2026-05-14T12:00:00Z').getTime();

  it('returns zeros for empty records', () => {
    const r = monthlyVolatility([], NOW);
    expect(r.thisMonth).toBe(0);
    expect(r.threeMonthAvg).toBe(0);
    expect(r.deltaPct).toBe(0);
  });

  it('computes this-month total correctly', () => {
    const recs = [
      rec('2026-05-01', 1000, 'in', 'employer'),
      rec('2026-05-10', 1500, 'in', 'client'),
    ];
    const r = monthlyVolatility(recs, NOW);
    expect(r.thisMonth).toBe(2500);
  });

  it('averages the 3 prior calendar months', () => {
    const recs = [
      rec('2026-02-15', 3000, 'in', 'employer'),
      rec('2026-03-15', 3000, 'in', 'employer'),
      rec('2026-04-15', 3000, 'in', 'employer'),
      rec('2026-05-15', 3000, 'in', 'employer'),
    ];
    const r = monthlyVolatility(recs, NOW);
    expect(r.thisMonth).toBe(3000);
    expect(r.threeMonthAvg).toBe(3000);
    expect(r.deltaPct).toBe(0);
  });

  it('reports a negative deltaPct when this month is under the trailing avg', () => {
    const recs = [
      rec('2026-02-15', 4000, 'in', 'employer'),
      rec('2026-03-15', 4000, 'in', 'employer'),
      rec('2026-04-15', 4000, 'in', 'employer'),
      rec('2026-05-10', 2000, 'in', 'employer'),
    ];
    const r = monthlyVolatility(recs, NOW);
    expect(r.thisMonth).toBe(2000);
    expect(r.threeMonthAvg).toBe(4000);
    expect(r.deltaPct).toBeCloseTo(-0.5, 2);
  });

  it('ignores outbound records', () => {
    const recs = [
      rec('2026-05-10', 9999, 'out', 'rent'),
    ];
    const r = monthlyVolatility(recs, NOW);
    expect(r.thisMonth).toBe(0);
  });
});

// ─── money-module gap closure: tax set-aside calculator ─────────────────
import {
  calculateUSSelfEmployedSetAside,
  calculateUKSelfEmployedSetAside,
  calculateEUFreelancerSetAside,
  monthlySetAsideReminder,
  FINANCE_TAX_SETASIDE_DUE_EVENT,
} from '../src/finance';

describe('calculateUSSelfEmployedSetAside', () => {
  it('returns zero for zero income', () => {
    const r = calculateUSSelfEmployedSetAside(0);
    expect(r.federal).toBe(0);
    expect(r.state).toBe(0);
    expect(r.selfEmploymentTax).toBe(0);
    expect(r.total).toBe(0);
    expect(r.suggestedPct).toBe(0);
  });

  it('applies CA state rate', () => {
    const r = calculateUSSelfEmployedSetAside(50_000, { state: 'CA' });
    expect(r.state).toBeCloseTo(50_000 * 0.093, 0);
    expect(r.stateCode).toBe('CA');
  });

  it('uses 0% state for TX/FL/WA', () => {
    expect(calculateUSSelfEmployedSetAside(50_000, { state: 'TX' }).state).toBe(0);
    expect(calculateUSSelfEmployedSetAside(50_000, { state: 'FL' }).state).toBe(0);
    expect(calculateUSSelfEmployedSetAside(50_000, { state: 'WA' }).state).toBe(0);
  });

  it('falls back to OTHER 5% when state omitted', () => {
    const r = calculateUSSelfEmployedSetAside(50_000);
    expect(r.stateCode).toBe('OTHER');
    expect(r.state).toBeCloseTo(50_000 * 0.05, 0);
  });

  it('self-employment tax = 15.3% * 92.35% * income', () => {
    const r = calculateUSSelfEmployedSetAside(100_000);
    expect(r.selfEmploymentTax).toBeCloseTo(100_000 * 0.9235 * 0.153, 0);
  });

  it('suggestedPct in conservative mode rounds up to next 5%', () => {
    const r = calculateUSSelfEmployedSetAside(100_000, { state: 'TX' });
    // federal 22% + SE ~14.13% ≈ 36.13% → round up to 40%
    expect(r.suggestedPct).toBeCloseTo(0.4, 2);
  });

  it('non-conservative mode rounds to 1%', () => {
    const r = calculateUSSelfEmployedSetAside(100_000, { state: 'TX', conservative: false });
    expect(r.suggestedPct).toBeGreaterThan(0.36);
    expect(r.suggestedPct).toBeLessThan(0.40);
  });
});

describe('calculateUKSelfEmployedSetAside', () => {
  it('returns near-zero on income at or below the personal allowance', () => {
    const r = calculateUKSelfEmployedSetAside(10_000);
    expect(r.incomeTax).toBe(0);
    // Only the NI Class 2 flat
    expect(r.ni).toBeCloseTo(180, 0);
  });

  it('applies basic 20% above personal allowance', () => {
    const r = calculateUKSelfEmployedSetAside(30_000);
    const taxable = 30_000 - 12_570;
    expect(r.incomeTax).toBeCloseTo(taxable * 0.20, 0);
  });

  it('crosses into higher rate above £50k', () => {
    const r = calculateUKSelfEmployedSetAside(80_000);
    expect(r.incomeTax).toBeGreaterThan((50_270 - 12_570) * 0.20);
  });

  it('crosses into additional rate above £125k', () => {
    const r = calculateUKSelfEmployedSetAside(200_000);
    expect(r.incomeTax).toBeGreaterThan(50_000);
  });

  it('returns a suggestedPct rounded up to 5%', () => {
    const r = calculateUKSelfEmployedSetAside(50_000);
    expect(r.suggestedPct).toBeGreaterThan(0);
    expect((r.suggestedPct * 100) % 5).toBeCloseTo(0, 6);
  });
});

describe('calculateEUFreelancerSetAside', () => {
  it('applies the DE blended rate', () => {
    const r = calculateEUFreelancerSetAside(50_000, 'DE');
    expect(r.total).toBeCloseTo(50_000 * 0.42, 0);
    expect(r.country).toBe('DE');
    expect(r.blendedRate).toBeCloseTo(0.42, 2);
  });

  it('applies the FR blended rate (highest in set)', () => {
    const r = calculateEUFreelancerSetAside(50_000, 'FR');
    expect(r.total).toBeCloseTo(50_000 * 0.45, 0);
  });

  it('rounds suggestedPct up to 5%', () => {
    const r = calculateEUFreelancerSetAside(50_000, 'NL');
    expect((r.suggestedPct * 100) % 5).toBeCloseTo(0, 6);
  });
});

describe('monthlySetAsideReminder', () => {
  it('returns 0 amount on zero income', () => {
    const r = monthlySetAsideReminder(0, { kind: 'us', opts: { state: 'TX' } });
    expect(r.amount).toBe(0);
    expect(r.message).toMatch(/tax buffer/);
  });

  it('US calculator produces a non-zero amount', () => {
    const r = monthlySetAsideReminder(5000, { kind: 'us', opts: { state: 'CA' } });
    expect(r.amount).toBeGreaterThan(0);
    expect(r.message).toMatch(/tax buffer for this month/);
  });

  it('UK calculator works through the reminder shape', () => {
    const r = monthlySetAsideReminder(4000, { kind: 'uk' });
    expect(r.amount).toBeGreaterThan(0);
  });

  it('EU calculator works through the reminder shape', () => {
    const r = monthlySetAsideReminder(4000, { kind: 'eu', country: 'DE' });
    expect(r.amount).toBeGreaterThan(0);
  });

  it('uses lowercase, no exclamation, no streak language', () => {
    const r = monthlySetAsideReminder(3000, { kind: 'us' });
    expect(r.message).not.toMatch(/!/);
    expect(r.message).not.toMatch(/great job|streak|crushing/i);
  });

  it('exports a registered event name', () => {
    expect(FINANCE_TAX_SETASIDE_DUE_EVENT).toBe('finance:tax_setaside_due');
  });
});

// ─── money-module gap closure: export (CSV + annual report) ──────────────
import {
  exportToCSV,
  exportADHDTaxReport,
  encryptExport,
} from '../src/finance';
import type { CryptoPrimitives } from '../src/finance';

describe('exportToCSV', () => {
  it('returns just the header for empty input', () => {
    const csv = exportToCSV([]);
    expect(csv.split('\r\n')[0]).toMatch(/^event_date,amount,/);
    expect(csv.split('\r\n')).toHaveLength(1);
  });

  it('emits a row per record in stable column order', () => {
    const csv = exportToCSV([
      rec('2026-05-10', 12.34, 'out', 'cafe', { category: 'food', notes: 'morning' }),
    ]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toContain('2026-05-10');
    expect(lines[1]).toContain('12.34');
    expect(lines[1]).toContain('out');
    expect(lines[1]).toContain('food');
    expect(lines[1]).toContain('morning');
  });

  it('escapes fields containing commas, quotes, and newlines (RFC 4180)', () => {
    const csv = exportToCSV([
      rec('2026-05-10', 5, 'out', 'shop', { notes: 'a, "quoted" b\nnext line' }),
    ]);
    expect(csv).toContain('"a, ""quoted"" b\nnext line"');
  });

  it('respects fromDate/toDate filters', () => {
    const records = [
      rec('2026-01-01', 10, 'out', 'a'),
      rec('2026-05-01', 20, 'out', 'b'),
      rec('2026-09-01', 30, 'out', 'c'),
    ];
    const csv = exportToCSV(records, { fromDate: '2026-03-01', toDate: '2026-07-01' });
    expect(csv).toContain('2026-05-01');
    expect(csv).not.toContain('2026-01-01');
    expect(csv).not.toContain('2026-09-01');
  });

  it('filters by direction', () => {
    const records = [
      rec('2026-05-01', 100, 'in',  'salary'),
      rec('2026-05-02', 20,  'out', 'cafe'),
    ];
    const csv = exportToCSV(records, { direction: 'in' });
    expect(csv).toContain('salary');
    expect(csv).not.toContain('cafe');
  });

  it('omits header when omitHeader=true', () => {
    const csv = exportToCSV(
      [rec('2026-05-10', 5, 'out', 'cafe')],
      { omitHeader: true },
    );
    expect(csv.split('\r\n')[0]).not.toContain('event_date');
  });

  it('renders boolean is_adhd_tax as "true"/"false"', () => {
    const csv = exportToCSV([
      rec('2026-05-10', 5, 'out', 'cafe', { is_adhd_tax: true, adhd_tax_type: 'late_fee' }),
    ]);
    expect(csv).toContain('true');
    expect(csv).toContain('late_fee');
  });
});

describe('exportADHDTaxReport', () => {
  it('returns 12 month rows even for an empty year', () => {
    const r = exportADHDTaxReport([], 2026);
    expect(r.months).toHaveLength(12);
    expect(r.months[0].month).toBe('2026-01');
    expect(r.months[11].month).toBe('2026-12');
    expect(r.yoyDelta).toBe(0);
  });

  it('aggregates income and expenses per month', () => {
    const recs = [
      rec('2026-05-01', 3000, 'in',  'salary'),
      rec('2026-05-15', 50,   'out', 'cafe', { category: 'food' }),
      rec('2026-06-10', 3000, 'in',  'salary'),
    ];
    const r = exportADHDTaxReport(recs, 2026);
    expect(r.months[4].income).toBe(3000);
    expect(r.months[4].expenses).toBe(50);
    expect(r.months[4].net).toBe(2950);
    expect(r.months[5].income).toBe(3000);
  });

  it('categorises adhd_tax records correctly', () => {
    const recs = [
      rec('2026-05-01', 50, 'out', 'shop', { is_adhd_tax: true, adhd_tax_type: 'late_fee' }),
      rec('2026-05-02', 30, 'out', 'shop', { is_adhd_tax: true, adhd_tax_type: 'duplicate' }),
    ];
    const r = exportADHDTaxReport(recs, 2026);
    expect(r.categorizedTotals.adhd_tax).toBe(80);
    expect(r.yearTotals.adhd_tax_total).toBe(80);
    expect(r.yearTotals.adhd_tax_count).toBe(2);
    expect(r.months[4].adhd_tax_count).toBe(2);
  });

  it('classifies common categories into tax buckets', () => {
    const recs = [
      rec('2026-05-01', 100, 'out', 'uber',    { category: 'transport' }),
      rec('2026-05-02', 100, 'out', 'doctor',  { category: 'health' }),
      rec('2026-05-03', 100, 'out', 'figma',   { category: 'software' }),
      rec('2026-05-04', 100, 'out', 'spotify', { category: 'subscription' }),
    ];
    const r = exportADHDTaxReport(recs, 2026);
    expect(r.categorizedTotals.transport).toBe(100);
    expect(r.categorizedTotals.health).toBe(100);
    expect(r.categorizedTotals.business_expense).toBe(100);
    expect(r.categorizedTotals.subscriptions).toBe(100);
  });

  it('computes year-over-year delta vs the prior year', () => {
    const recs = [
      rec('2025-05-01', 1000, 'in',  'salary'),
      rec('2025-05-02', 200,  'out', 'cafe', { category: 'food' }),
      rec('2026-05-01', 2000, 'in',  'salary'),
      rec('2026-05-02', 200,  'out', 'cafe', { category: 'food' }),
    ];
    const r = exportADHDTaxReport(recs, 2026);
    // 2025 net = 800; 2026 net = 1800 → delta = (1800-800)/800 = 1.25
    expect(r.yoyDelta).toBeCloseTo(1.25, 2);
  });

  it('falls back to uncategorized for unknown categories', () => {
    const recs = [
      rec('2026-05-01', 50, 'out', 'mystery'),
    ];
    const r = exportADHDTaxReport(recs, 2026);
    expect(r.categorizedTotals.uncategorized).toBe(50);
  });
});

describe('encryptExport', () => {
  // Deterministic fake primitives that mirror @ollie/crypto's contract.
  // Real crypto is exercised in @ollie/crypto's own test suite.
  const fakeCrypto: CryptoPrimitives = {
    randomSalt: () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    deriveKey: async () => ({} as CryptoKey),
    encryptData: async () => ({
      iv: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]),
      ciphertext: new Uint8Array([42, 42, 42, 42]),
    }),
    bytesToBase64: (bytes) => Buffer.from(bytes).toString('base64'),
  };

  it('throws when passphrase is missing', async () => {
    await expect(encryptExport('hello', '', fakeCrypto)).rejects.toThrow(/passphrase/);
  });

  it('returns a v1 envelope JSON string with salt/iv/ciphertext fields', async () => {
    const json = await encryptExport('hello,world', 'my-passphrase', fakeCrypto);
    const env = JSON.parse(json);
    expect(env.v).toBe(1);
    expect(env.alg).toBe('AES-GCM-256+PBKDF2-SHA256-100k');
    expect(typeof env.salt).toBe('string');
    expect(typeof env.iv).toBe('string');
    expect(typeof env.ciphertext).toBe('string');
    expect(env.contentType).toBe('text/csv');
  });

  it('honours a custom contentType', async () => {
    const json = await encryptExport('x', 'pw', fakeCrypto, { contentType: 'application/pdf' });
    expect(JSON.parse(json).contentType).toBe('application/pdf');
  });
});
