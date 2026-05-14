/**
 * @ollie/logic · finance · subscription dormancy tests
 *
 * Heuristic scoring + alias / cancel URL catalog coverage.
 */

import { describe, it, expect } from 'vitest';
import {
  scoreDormancy,
  summarize,
  type StoredSubLike,
  type BrainDumpEntry,
} from '../src/finance/subscription-dormancy';
import {
  matchAliasKey,
  SUBSCRIPTION_ALIAS_COUNT,
  scanMentions,
} from '../src/finance/subscription-aliases';
import {
  getCancelUrl,
  isAppleManaged,
  APPLE_SUBSCRIPTIONS_DEEP_LINK,
  SUBSCRIPTION_CANCEL_URL_COUNT,
} from '../src/finance/cancel-urls';
import type { FinanceRecord } from '../src/finance/types';

const DAY = 86_400_000;
const NOW = Date.parse('2026-05-14T12:00:00Z');

function tx(daysAgo: number, amount: number, merchant: string): FinanceRecord {
  const ts = NOW - daysAgo * DAY;
  return {
    id: `tx-${merchant}-${daysAgo}`,
    created_at: ts,
    event_date: new Date(ts).toISOString().slice(0, 10),
    amount,
    currency: 'USD',
    merchant,
    merchant_normalized: merchant.toLowerCase(),
    direction: 'out',
  };
}

function sub(
  name: string,
  amount: number,
  opts: Partial<StoredSubLike> = {},
): StoredSubLike {
  return {
    id: `sub-${name}`,
    name,
    amount,
    period: 'monthly',
    ts: NOW - 120 * DAY,
    ...opts,
  };
}

function dump(daysAgo: number, text: string): BrainDumpEntry {
  return { ts: NOW - daysAgo * DAY, text };
}

describe('finance/subscription-aliases · catalog shape', () => {
  it('has 60+ services in the catalog', () => {
    expect(SUBSCRIPTION_ALIAS_COUNT).toBeGreaterThanOrEqual(60);
  });

  it('matches netflix from a stored sub name', () => {
    expect(matchAliasKey('Netflix')).toBe('netflix');
    expect(matchAliasKey('NETFLIX premium')).toBe('netflix');
  });

  it('matches multi-word phrases for apple music', () => {
    expect(matchAliasKey('Apple Music Family')).toBe('apple-music');
  });

  it('does not match "music" alone as apple music', () => {
    // "music" alone is too generic; the catalog requires "apple music"
    expect(matchAliasKey('Music app')).toBeNull();
  });

  it('returns null for unknown service names', () => {
    expect(matchAliasKey('My Custom Local Gym')).toBeNull();
  });

  it('respects word boundaries — netflixed should not match netflix', () => {
    expect(matchAliasKey('netflixed')).toBeNull();
  });
});

describe('finance/subscription-aliases · scanMentions', () => {
  it('counts brain-dump mentions within window', () => {
    const dumps: BrainDumpEntry[] = [
      dump(5,  'watched netflix tonight, the queens gambit again'),
      dump(20, 'netflix kept autoplaying'),
      dump(40, 'cancelled netflix would have been good but i wont'),
      dump(200, 'old netflix mention way outside window'),
    ];
    const result = scanMentions('netflix', dumps, NOW - 90 * DAY);
    expect(result).not.toBeNull();
    expect(result!.countInWindow).toBe(3);
    expect(result!.lastMentionAt).toBe(NOW - 5 * DAY);
  });

  it('returns null for unknown alias key', () => {
    expect(scanMentions('not-a-real-service', [], NOW - 90 * DAY)).toBeNull();
  });

  it('returns zero count when window is empty', () => {
    const result = scanMentions('netflix', [], NOW - 90 * DAY);
    expect(result).toEqual({ lastMentionAt: null, countInWindow: 0 });
  });
});

describe('finance/cancel-urls · catalog shape', () => {
  it('has 40+ services in the catalog', () => {
    expect(SUBSCRIPTION_CANCEL_URL_COUNT).toBeGreaterThanOrEqual(40);
  });

  it('returns the netflix cancel URL', () => {
    const url = getCancelUrl('netflix');
    expect(url).toBe('https://www.netflix.com/youraccount/cancelplan');
  });

  it('returns the apple subscriptions deep-link for apple-managed subs', () => {
    expect(getCancelUrl('apple-music')).toBe(APPLE_SUBSCRIPTIONS_DEEP_LINK);
    expect(getCancelUrl('icloud')).toBe(APPLE_SUBSCRIPTIONS_DEEP_LINK);
    expect(isAppleManaged('apple-music')).toBe(true);
    expect(isAppleManaged('netflix')).toBe(false);
  });

  it('returns null for unknown keys', () => {
    expect(getCancelUrl('not-a-thing')).toBeNull();
    expect(getCancelUrl(null)).toBeNull();
  });
});

describe('finance/subscription-dormancy · scoreDormancy', () => {
  it('3 charges + 0 mentions => cancel_candidate, score 80+', () => {
    const subs = [sub('Netflix', 15.49)];
    const records = [tx(7, 15.49, 'Netflix'), tx(37, 15.49, 'Netflix'), tx(67, 15.49, 'Netflix')];
    const signals = scoreDormancy(subs, records, [], NOW);
    expect(signals).toHaveLength(1);
    expect(signals[0].recommendation).toBe('cancel_candidate');
    expect(signals[0].dormancyScore).toBeGreaterThanOrEqual(80);
    expect(signals[0].chargesIn90d).toBe(3);
    expect(signals[0].mentionsIn90d).toBe(0);
    expect(signals[0].evidence).toContain('paid 3 times');
  });

  it('3 charges + 5 mentions => active, score <= 30', () => {
    const subs = [sub('Spotify', 10.99)];
    const records = [tx(5, 10.99, 'Spotify'), tx(35, 10.99, 'Spotify'), tx(65, 10.99, 'Spotify')];
    const dumps: BrainDumpEntry[] = [
      dump(2,  'spotify wrapped this year'),
      dump(7,  'spotify queue is a mess'),
      dump(15, 'discovered a new song on spotify'),
      dump(40, 'spotify playlist for working'),
      dump(60, 'spotify recommended sleep music'),
    ];
    const signals = scoreDormancy(subs, records, dumps, NOW);
    expect(signals).toHaveLength(1);
    expect(signals[0].recommendation).toBe('active');
    expect(signals[0].dormancyScore).not.toBeNull();
    expect(signals[0].dormancyScore!).toBeLessThanOrEqual(30);
    expect(signals[0].mentionsIn90d).toBe(5);
  });

  it('0 charges => inconclusive (probably already cancelled)', () => {
    const subs = [sub('Hulu', 7.99)];
    const records: FinanceRecord[] = []; // no charges
    const signals = scoreDormancy(subs, records, [], NOW);
    expect(signals[0].recommendation).toBe('inconclusive');
    expect(signals[0].evidence).toMatch(/no charges/);
    expect(signals[0].dormancyScore).toBeNull();
  });

  it('unknown sub name (no alias match) => inconclusive with manual prompt', () => {
    const subs = [sub('Local Yoga Studio Monthly', 89)];
    const records = [tx(7, 89, 'Local Yoga Studio'), tx(37, 89, 'Local Yoga Studio')];
    const signals = scoreDormancy(subs, records, [], NOW);
    expect(signals[0].recommendation).toBe('inconclusive');
    expect(signals[0].aliasKey).toBeNull();
    expect(signals[0].evidence).toMatch(/couldn't match/);
    expect(signals[0].dormancyScore).toBeNull();
  });

  it('sub created < 7 days ago => too_soon, no score, no cancel button affordance', () => {
    const subs = [sub('Netflix', 15.49, { ts: NOW - 3 * DAY })];
    const records = [tx(1, 15.49, 'Netflix')];
    const signals = scoreDormancy(subs, records, [], NOW);
    expect(signals[0].recommendation).toBe('too_soon');
    expect(signals[0].dormancyScore).toBeNull();
    expect(signals[0].evidence).toMatch(/too soon to tell/);
  });

  it('snoozed subs are filtered out entirely', () => {
    const subs = [
      sub('Netflix', 15.49, { snoozeUntil: NOW + 2 * DAY }),
      sub('Spotify', 10.99),
    ];
    const records = [tx(7, 10.99, 'Spotify'), tx(37, 10.99, 'Spotify'), tx(67, 10.99, 'Spotify')];
    const signals = scoreDormancy(subs, records, [], NOW);
    expect(signals).toHaveLength(1);
    expect(signals[0].subscriptionName).toBe('Spotify');
  });

  it('apple-managed sub still scores correctly and resolves to deep-link', () => {
    const subs = [sub('Apple Music Family', 16.99)];
    const records = [tx(7, 16.99, 'Apple Music'), tx(37, 16.99, 'Apple'), tx(67, 16.99, 'Apple Music')];
    const signals = scoreDormancy(subs, records, [], NOW);
    expect(signals[0].aliasKey).toBe('apple-music');
    expect(signals[0].recommendation).toBe('cancel_candidate');
    expect(getCancelUrl(signals[0].aliasKey)).toBe(APPLE_SUBSCRIPTIONS_DEEP_LINK);
  });

  it('cancel_candidate above $20/mo gets a cost-weighted score bump', () => {
    const cheap = sub('Spotify', 10.99);
    const pricey = sub('Adobe Creative Cloud', 54.99);
    const records = [
      tx(7, 10.99, 'Spotify'), tx(37, 10.99, 'Spotify'), tx(67, 10.99, 'Spotify'),
      tx(5, 54.99, 'Adobe'), tx(35, 54.99, 'Adobe'), tx(65, 54.99, 'Adobe'),
    ];
    const signals = scoreDormancy([cheap, pricey], records, [], NOW);
    // pricey should rank first
    expect(signals[0].subscriptionName).toBe('Adobe Creative Cloud');
    expect(signals[0].dormancyScore!).toBeGreaterThan(signals[1].dormancyScore!);
  });

  it('1-2 mentions => review band, score 40..70', () => {
    const subs = [sub('Headspace', 12.99)];
    const records = [tx(7, 12.99, 'Headspace'), tx(37, 12.99, 'Headspace'), tx(67, 12.99, 'Headspace')];
    const dumps = [dump(20, 'tried headspace for sleep, didnt work for me')];
    const signals = scoreDormancy(subs, records, dumps, NOW);
    expect(signals[0].recommendation).toBe('review');
    expect(signals[0].dormancyScore).not.toBeNull();
    expect(signals[0].dormancyScore!).toBeGreaterThanOrEqual(40);
    expect(signals[0].dormancyScore!).toBeLessThanOrEqual(70);
  });
});

describe('finance/subscription-dormancy · summarize', () => {
  it('counts buckets and sums monthly total across all subs', () => {
    const subs = [
      sub('Netflix', 15.49),
      sub('Spotify', 10.99),
      sub('Annual Service', 120, { period: 'yearly' }), // 10/mo
    ];
    const records = [
      tx(7, 15.49, 'Netflix'), tx(37, 15.49, 'Netflix'), tx(67, 15.49, 'Netflix'),
      tx(7, 10.99, 'Spotify'),
    ];
    const dumps = [dump(2, 'spotify on repeat today')];
    const signals = scoreDormancy(subs, records, dumps, NOW);
    const sum = summarize(signals, subs);
    expect(sum.totalSubs).toBe(3);
    expect(sum.monthlyTotal).toBeCloseTo(15.49 + 10.99 + 10, 2);
    expect(sum.candidateCount).toBe(1); // netflix
  });
});
