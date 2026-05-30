/**
 * predict.test.ts — boundary tests for predictOutAt().
 *
 * Locks in the Plan B priority chain (observed cadence > shelf life > null)
 * and the stale-cap behaviour that suppresses meaningless "you'll need salt
 * in 365 days" predictions.
 */

import { describe, it, expect } from 'vitest';
import { predictOutAt, PREDICT_DAY_MS } from './predict';

const DAY = PREDICT_DAY_MS;
const LAST = 1_700_000_000_000; // arbitrary anchor

describe('predictOutAt · observed cadence wins over shelf life', () => {
  it('returns last + cadenceDays when cadenceDays is finite > 0', () => {
    const out = predictOutAt({
      lastPurchaseMs: LAST,
      cadenceDays: 10,
      shelfLifeDays: 7,
    });
    expect(out).toBe(LAST + 10 * DAY);
  });

  it('cadence beats a longer shelf life', () => {
    const out = predictOutAt({
      lastPurchaseMs: LAST,
      cadenceDays: 5,
      shelfLifeDays: 60,
    });
    expect(out).toBe(LAST + 5 * DAY);
  });
});

describe('predictOutAt · shelf-life fallback', () => {
  it('uses shelfLifeDays when cadenceDays is null', () => {
    const out = predictOutAt({
      lastPurchaseMs: LAST,
      cadenceDays: null,
      shelfLifeDays: 7,
    });
    expect(out).toBe(LAST + 7 * DAY);
  });

  it('uses shelfLifeDays when cadenceDays is 0 (low-data tier signal)', () => {
    const out = predictOutAt({
      lastPurchaseMs: LAST,
      cadenceDays: 0,
      shelfLifeDays: 14,
    });
    expect(out).toBe(LAST + 14 * DAY);
  });

  it('uses shelfLifeDays when cadenceDays is NaN', () => {
    const out = predictOutAt({
      lastPurchaseMs: LAST,
      cadenceDays: NaN,
      shelfLifeDays: 21,
    });
    expect(out).toBe(LAST + 21 * DAY);
  });

  it('uses shelfLifeDays when cadenceDays is negative', () => {
    const out = predictOutAt({
      lastPurchaseMs: LAST,
      cadenceDays: -3,
      shelfLifeDays: 9,
    });
    expect(out).toBe(LAST + 9 * DAY);
  });
});

describe('predictOutAt · null inputs', () => {
  it('returns null when both cadenceDays and shelfLifeDays are null', () => {
    expect(
      predictOutAt({
        lastPurchaseMs: LAST,
        cadenceDays: null,
        shelfLifeDays: null,
      }),
    ).toBeNull();
  });

  it('returns null when lastPurchaseMs is 0 (sentinel)', () => {
    expect(
      predictOutAt({
        lastPurchaseMs: 0,
        cadenceDays: 7,
        shelfLifeDays: 14,
      }),
    ).toBeNull();
  });

  it('returns null when lastPurchaseMs is negative', () => {
    expect(
      predictOutAt({
        lastPurchaseMs: -1,
        cadenceDays: 7,
        shelfLifeDays: 14,
      }),
    ).toBeNull();
  });

  it('returns null when lastPurchaseMs is non-finite', () => {
    expect(
      predictOutAt({
        lastPurchaseMs: NaN,
        cadenceDays: 7,
        shelfLifeDays: 14,
      }),
    ).toBeNull();
    expect(
      predictOutAt({
        lastPurchaseMs: Infinity,
        cadenceDays: 7,
        shelfLifeDays: 14,
      }),
    ).toBeNull();
  });
});

describe('predictOutAt · stale-cap', () => {
  it('returns null when chosen days exceed the default stale cap (180d)', () => {
    // honey-style "indefinite, capped at 365" shouldn't predict
    expect(
      predictOutAt({
        lastPurchaseMs: LAST,
        cadenceDays: null,
        shelfLifeDays: 365,
      }),
    ).toBeNull();
  });

  it('returns a value when chosen days are exactly at the cap', () => {
    expect(
      predictOutAt({
        lastPurchaseMs: LAST,
        cadenceDays: null,
        shelfLifeDays: 180,
      }),
    ).toBe(LAST + 180 * DAY);
  });

  it('observed cadence beyond cap also returns null', () => {
    // pathological: user buys salt every 365d. We still hide it.
    expect(
      predictOutAt({
        lastPurchaseMs: LAST,
        cadenceDays: 200,
        shelfLifeDays: 30,
      }),
    ).toBeNull();
  });

  it('staleAtDays override raises the cap', () => {
    expect(
      predictOutAt({
        lastPurchaseMs: LAST,
        cadenceDays: null,
        shelfLifeDays: 365,
        staleAtDays: 400,
      }),
    ).toBe(LAST + 365 * DAY);
  });

  it('staleAtDays=Infinity disables the cap', () => {
    expect(
      predictOutAt({
        lastPurchaseMs: LAST,
        cadenceDays: null,
        shelfLifeDays: 365,
        staleAtDays: Infinity,
      }),
    ).toBe(LAST + 365 * DAY);
  });
});

describe('predictOutAt · realistic scenarios', () => {
  it('milk (observed 5d cadence): predicts 5 days out', () => {
    const out = predictOutAt({
      lastPurchaseMs: LAST,
      cadenceDays: 5,
      shelfLifeDays: 7,
    });
    expect(out).toBe(LAST + 5 * DAY);
  });

  it('tampons (low-data, shelf life 1825d): clamps to null (over cap)', () => {
    const out = predictOutAt({
      lastPurchaseMs: LAST,
      cadenceDays: null,
      shelfLifeDays: 1825,
    });
    expect(out).toBeNull();
  });

  it('eggs (low-data tier, USDA 28d shelf life): predicts 28d out', () => {
    const out = predictOutAt({
      lastPurchaseMs: LAST,
      cadenceDays: null,
      shelfLifeDays: 28,
    });
    expect(out).toBe(LAST + 28 * DAY);
  });
});
