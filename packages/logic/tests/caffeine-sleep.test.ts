/**
 * @ollie/logic · body · caffeine-sleep correlator tests
 *
 * Covers:
 *   - merchant allowlist detection from FinanceRecord[]
 *   - braindump keyword detection
 *   - standard caffeine doses
 *   - correlation runs on >= 14 paired entries
 *   - null/empty guards at < 14
 *   - threshold detection on synthetic after-3pm-bad data
 *   - copy passes the banned-phrase scanner (literal output)
 */

import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scanForBanned } = require('../../../tools/banned-phrases.cjs') as {
  scanForBanned: (text: string, scope?: string | string[]) => Array<{ id: string; why: string }>;
};

import {
  inferCaffeineFromTransactions,
  correlateCaffeineAndSleep,
  CAFFEINE_STANDARD_MG,
  CAFFEINE_MERCHANTS,
  type CaffeineEntry,
} from '../src/body';
import type { FinanceRecord } from '../src/finance';
import type { BrainDumpEntry } from '../src/finance';
import type { SleepRecord } from '../src/sleep';

// ─── helpers ─────────────────────────────────────────────────────────

function txn(eventDate: string, merchantNormalized: string, amount = 5.5): FinanceRecord {
  return {
    id: `t-${eventDate}-${Math.random().toString(36).slice(2, 6)}`,
    event_date: eventDate,
    amount,
    currency: 'USD',
    merchant: merchantNormalized,
    merchant_normalized: merchantNormalized,
    direction: 'out',
    tokens: [],
    is_adhd_tax: false,
    adhd_tax_type: null,
  };
}

function dump(ts: number, text: string): BrainDumpEntry {
  return { ts, text };
}

/** Build a SleepRecord with a given quality (1–5) for night_of. */
function night(nightOf: string, quality: number, bedtime = '23:00'): SleepRecord {
  return {
    night_of: nightOf,
    bedtime,
    wake_time: '07:00',
    onset_latency_min: 15,
    wakings_count: 0,
    wakings_total_min: 0,
    quality,
    quality_text: null,
    notes: null,
    tokens: [],
    is_skipped: false,
    is_partial: false,
    is_disputed: false,
  };
}

/** Epoch ms for local-time YYYY-MM-DD HH:MM. */
function localTs(date: string, hh: number, mm: number): number {
  const [y, mo, d] = date.split('-').map((s) => parseInt(s, 10));
  return new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
}

function buildDateRange(startKey: string, days: number): string[] {
  const [y, mo, d] = startKey.split('-').map((s) => parseInt(s, 10));
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(y, mo - 1, d + i);
    out.push(
      dt.getFullYear() +
        '-' +
        String(dt.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(dt.getDate()).padStart(2, '0'),
    );
  }
  return out;
}

// ─── inference: txns ─────────────────────────────────────────────────

describe('inferCaffeineFromTransactions · finance merchant allowlist', () => {
  it('detects starbucks as caffeine', () => {
    const out = inferCaffeineFromTransactions([txn('2026-05-01', 'starbucks')], []);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('finance');
    expect(out[0].amountMg).toBe(95);
  });

  it('detects blue bottle, peets, dunkin, philz', () => {
    const txns = [
      txn('2026-05-01', 'blue bottle'),
      txn('2026-05-02', "peet's"),
      txn('2026-05-03', 'dunkin donuts'),
      txn('2026-05-04', 'philz coffee'),
    ];
    const out = inferCaffeineFromTransactions(txns, []);
    expect(out).toHaveLength(4);
    for (const e of out) expect(e.source).toBe('finance');
  });

  it('skips non-caffeine merchants', () => {
    const out = inferCaffeineFromTransactions(
      [txn('2026-05-01', 'cvs pharmacy'), txn('2026-05-02', 'amazon')],
      [],
    );
    expect(out).toHaveLength(0);
  });

  it('skips income (direction=in) even with caffeine merchant', () => {
    const r = txn('2026-05-01', 'starbucks');
    r.direction = 'in';
    const out = inferCaffeineFromTransactions([r], []);
    expect(out).toHaveLength(0);
  });

  it('rejects malformed records gracefully', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const garbage = [null, undefined, { event_date: 'not-a-date', merchant_normalized: 'starbucks', direction: 'out' }] as any;
    const out = inferCaffeineFromTransactions(garbage, []);
    expect(out).toHaveLength(0);
  });
});

// ─── inference: dumps ────────────────────────────────────────────────

describe('inferCaffeineFromTransactions · braindump keywords', () => {
  it('detects "coffee" keyword', () => {
    const t = localTs('2026-05-01', 9, 30);
    const out = inferCaffeineFromTransactions([], [dump(t, 'had a coffee this morning')]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('brain_dump');
    expect(out[0].amountMg).toBe(CAFFEINE_STANDARD_MG.drip_coffee);
  });

  it('detects "matcha" and uses its dose', () => {
    const t = localTs('2026-05-01', 14, 0);
    const out = inferCaffeineFromTransactions([], [dump(t, 'matcha latte after lunch')]);
    expect(out[0].amountMg).toBe(CAFFEINE_STANDARD_MG.matcha);
  });

  it('detects "cold brew" before "brew" generic', () => {
    const t = localTs('2026-05-01', 11, 0);
    const out = inferCaffeineFromTransactions([], [dump(t, 'cold brew today')]);
    expect(out[0].amountMg).toBe(CAFFEINE_STANDARD_MG.cold_brew);
  });

  it('detects espresso, americano, cappuccino, latte', () => {
    const tsBase = localTs('2026-05-01', 10, 0);
    const out = inferCaffeineFromTransactions(
      [],
      [
        dump(tsBase + 1, 'espresso pls'),
        dump(tsBase + 2, 'americano break'),
        dump(tsBase + 3, 'cappuccino time'),
        dump(tsBase + 4, 'oat latte'),
      ],
    );
    expect(out).toHaveLength(4);
  });

  it('skips dumps without caffeine keywords', () => {
    const t = localTs('2026-05-01', 9, 30);
    const out = inferCaffeineFromTransactions([], [dump(t, 'just water')]);
    expect(out).toHaveLength(0);
  });

  it('merges finance + braindump entries', () => {
    const t = localTs('2026-05-01', 9, 30);
    const out = inferCaffeineFromTransactions(
      [txn('2026-05-01', 'starbucks')],
      [dump(t, 'second coffee in afternoon')],
    );
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.source).sort()).toEqual(['brain_dump', 'finance']);
  });
});

// ─── standard amounts ────────────────────────────────────────────────

describe('CAFFEINE_STANDARD_MG · doses', () => {
  it('drip coffee = 95mg', () => expect(CAFFEINE_STANDARD_MG.drip_coffee).toBe(95));
  it('espresso = 63mg', () => expect(CAFFEINE_STANDARD_MG.espresso).toBe(63));
  it('matcha = 70mg', () => expect(CAFFEINE_STANDARD_MG.matcha).toBe(70));
  it('cold brew = 200mg', () => expect(CAFFEINE_STANDARD_MG.cold_brew).toBe(200));
  it('black tea = 47mg', () => expect(CAFFEINE_STANDARD_MG.black_tea).toBe(47));
  it('green tea = 28mg', () => expect(CAFFEINE_STANDARD_MG.green_tea).toBe(28));
});

describe('CAFFEINE_MERCHANTS · allowlist size', () => {
  it('contains 10+ merchants (sanity)', () => {
    expect(CAFFEINE_MERCHANTS.length).toBeGreaterThanOrEqual(10);
  });
});

// ─── correlation ─────────────────────────────────────────────────────

describe('correlateCaffeineAndSleep · sample size guards', () => {
  it('returns sampleSize 0 + empty copy with no input', () => {
    const r = correlateCaffeineAndSleep([], []);
    expect(r.sampleSize).toBe(0);
    expect(r.copy).toBe('');
    expect(r.threshold).toBeNull();
  });

  it('returns sampleSize < 14 + empty copy on small data', () => {
    const dates = buildDateRange('2026-04-01', 10);
    const sleep = dates.map((d) => night(d, 4));
    const caffeine: CaffeineEntry[] = dates.map((d) => ({
      consumedAt: localTs(d, 10, 0),
      amountMg: 95,
      source: 'finance' as const,
    }));
    const r = correlateCaffeineAndSleep(caffeine, sleep);
    expect(r.sampleSize).toBeLessThan(14);
    expect(r.copy).toBe('');
    expect(r.threshold).toBeNull();
  });

  it('respects opts.minSampleSize override', () => {
    const dates = buildDateRange('2026-04-01', 6);
    const sleep = dates.map((d) => night(d, 4));
    const caffeine: CaffeineEntry[] = dates.map((d) => ({
      consumedAt: localTs(d, 10, 0),
      amountMg: 95,
      source: 'finance' as const,
    }));
    const r = correlateCaffeineAndSleep(caffeine, sleep, { minSampleSize: 4 });
    expect(r.sampleSize).toBe(6);
  });
});

describe('correlateCaffeineAndSleep · runs on 14+ pairs', () => {
  it('produces a non-null correlation when sample meets floor', () => {
    const dates = buildDateRange('2026-04-01', 21);
    // Flat data: same time every day, same quality. Pearson is 0.
    const sleep = dates.map((d) => night(d, 4));
    const caffeine: CaffeineEntry[] = dates.map((d) => ({
      consumedAt: localTs(d, 9, 0),
      amountMg: 95,
      source: 'finance' as const,
    }));
    const r = correlateCaffeineAndSleep(caffeine, sleep);
    expect(r.sampleSize).toBe(21);
    expect(typeof r.correlation).toBe('number');
  });
});

describe('correlateCaffeineAndSleep · threshold detection', () => {
  it('detects ~3pm threshold on synthetic late-caffeine-bad data', () => {
    // 21 nights. Even days: 9am caffeine, sleep quality 5.
    //          Odd days:  4pm caffeine, sleep quality 2.
    const dates = buildDateRange('2026-04-01', 21);
    const caffeine: CaffeineEntry[] = [];
    const sleep: SleepRecord[] = [];
    for (let i = 0; i < dates.length; i++) {
      const isLate = i % 2 === 1;
      const hour = isLate ? 16 : 9;
      const quality = isLate ? 2 : 5;
      caffeine.push({
        consumedAt: localTs(dates[i], hour, 0),
        amountMg: 95,
        source: 'finance',
      });
      sleep.push(night(dates[i], quality));
    }
    const r = correlateCaffeineAndSleep(caffeine, sleep);
    expect(r.sampleSize).toBeGreaterThanOrEqual(14);
    expect(r.threshold).not.toBeNull();
    if (r.threshold) {
      // The earliest negative-flip should land at 15:00 or 16:00.
      expect(r.threshold.hours).toBeGreaterThanOrEqual(13);
      expect(r.threshold.hours).toBeLessThanOrEqual(16);
    }
    expect(r.correlation).toBeLessThan(0);
    expect(r.copy.length).toBeGreaterThan(0);
  });

  it('returns null threshold + empty copy when correlation is flat', () => {
    const dates = buildDateRange('2026-04-01', 21);
    const caffeine: CaffeineEntry[] = dates.map((d) => ({
      consumedAt: localTs(d, 10, 0),
      amountMg: 95,
      source: 'finance' as const,
    }));
    const sleep = dates.map((d, i) => night(d, ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5));
    const r = correlateCaffeineAndSleep(caffeine, sleep);
    expect(r.threshold).toBeNull();
    expect(r.copy).toBe('');
  });

  it('threshold weeks-of-data label matches sample size', () => {
    const dates = buildDateRange('2026-04-01', 21);
    const caffeine: CaffeineEntry[] = [];
    const sleep: SleepRecord[] = [];
    for (let i = 0; i < dates.length; i++) {
      const isLate = i % 2 === 1;
      caffeine.push({
        consumedAt: localTs(dates[i], isLate ? 16 : 9, 0),
        amountMg: 95,
        source: 'finance',
      });
      sleep.push(night(dates[i], isLate ? 2 : 5));
    }
    const r = correlateCaffeineAndSleep(caffeine, sleep);
    expect(r.copy).toMatch(/3 weeks of data/);
  });
});

// ─── copy passes banned-phrase scanner ───────────────────────────────

describe('correlateCaffeineAndSleep · copy is voice-library-safe', () => {
  it('synthetic late-caffeine copy has zero banned-phrase hits', () => {
    const dates = buildDateRange('2026-04-01', 21);
    const caffeine: CaffeineEntry[] = [];
    const sleep: SleepRecord[] = [];
    for (let i = 0; i < dates.length; i++) {
      const isLate = i % 2 === 1;
      caffeine.push({
        consumedAt: localTs(dates[i], isLate ? 16 : 9, 0),
        amountMg: 95,
        source: 'finance',
      });
      sleep.push(night(dates[i], isLate ? 2 : 5));
    }
    const r = correlateCaffeineAndSleep(caffeine, sleep);
    expect(r.copy.length).toBeGreaterThan(0);
    const hits = scanForBanned(r.copy);
    expect(hits).toEqual([]);
  });

  it('copy contains "correlates with" + "-N% sleep quality" pattern', () => {
    const dates = buildDateRange('2026-04-01', 21);
    const caffeine: CaffeineEntry[] = [];
    const sleep: SleepRecord[] = [];
    for (let i = 0; i < dates.length; i++) {
      const isLate = i % 2 === 1;
      caffeine.push({
        consumedAt: localTs(dates[i], isLate ? 16 : 9, 0),
        amountMg: 95,
        source: 'finance',
      });
      sleep.push(night(dates[i], isLate ? 2 : 5));
    }
    const r = correlateCaffeineAndSleep(caffeine, sleep);
    expect(r.copy).toMatch(/correlates with -\d+% sleep quality/);
  });

  it('copy does not contain "!" or shame language', () => {
    const dates = buildDateRange('2026-04-01', 21);
    const caffeine: CaffeineEntry[] = [];
    const sleep: SleepRecord[] = [];
    for (let i = 0; i < dates.length; i++) {
      const isLate = i % 2 === 1;
      caffeine.push({
        consumedAt: localTs(dates[i], isLate ? 16 : 9, 0),
        amountMg: 95,
        source: 'finance',
      });
      sleep.push(night(dates[i], isLate ? 2 : 5));
    }
    const r = correlateCaffeineAndSleep(caffeine, sleep);
    expect(r.copy).not.toContain('!');
    expect(r.copy.toLowerCase()).not.toContain('should');
    expect(r.copy.toLowerCase()).not.toContain('streak');
  });
});
