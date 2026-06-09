/**
 * pushTrigger.test.ts — gating logic for shouldPushReminder().
 *
 * Locks Plan B push gate (Serra, 2026-05-30):
 *   - remind_me OFF → no fire
 *   - no prediction → no fire
 *   - before window (> 1d ahead of predicted out) → no fire
 *   - after window (< 6h ahead, or past predicted out) → no fire
 *   - already pushed this cycle → no fire
 *   - quiet hours → no fire
 *   - inside [predictedOut - 24h, predictedOut - 6h] AND 8-22 local → FIRE
 */

import { describe, it, expect } from 'vitest';
import {
  shouldPushReminder,
  isWithinDailyWindow,
  PUSH_TRIGGER_DAY_MS,
  PUSH_TRIGGER_HOUR_MS,
} from './pushTrigger';

const DAY = PUSH_TRIGGER_DAY_MS;
const HOUR = PUSH_TRIGGER_HOUR_MS;

/** Stub local-hour function — keeps tests deterministic across timezones. */
function fixedHour(h: number): (ms: number) => number {
  return () => h;
}

/** Base row: remind enabled, predicted out at TS, never pushed. */
const TS = 1_700_000_000_000;
function baseRow(overrides: Partial<{
  remindMe: boolean;
  predictedOutAtMs: number | null;
  pushedAtMs: number | null;
}> = {}) {
  return {
    remindMe: true,
    predictedOutAtMs: TS,
    pushedAtMs: null,
    ...overrides,
  };
}

describe('shouldPushReminder · happy path', () => {
  it('fires when in the window AND outside quiet hours', () => {
    // 12 hours before predictedOut, 10am local
    const now = TS - 12 * HOUR;
    expect(
      shouldPushReminder(baseRow(), now, { localHourOf: fixedHour(10) }),
    ).toBe(true);
  });

  it('fires at the leading edge (exactly 24h before)', () => {
    const now = TS - 24 * HOUR;
    expect(
      shouldPushReminder(baseRow(), now, { localHourOf: fixedHour(10) }),
    ).toBe(true);
  });

  it('fires at the trailing edge minus 1ms (6h + 1ms before)', () => {
    const now = TS - 6 * HOUR - 1;
    expect(
      shouldPushReminder(baseRow(), now, { localHourOf: fixedHour(10) }),
    ).toBe(true);
  });
});

describe('shouldPushReminder · remind_me gate', () => {
  it('remindMe=false blocks fire even in window', () => {
    const now = TS - 12 * HOUR;
    expect(
      shouldPushReminder(
        baseRow({ remindMe: false }),
        now,
        { localHourOf: fixedHour(10) },
      ),
    ).toBe(false);
  });
});

describe('shouldPushReminder · prediction gate', () => {
  it('null predictedOutAtMs blocks fire', () => {
    expect(
      shouldPushReminder(
        baseRow({ predictedOutAtMs: null }),
        TS,
        { localHourOf: fixedHour(10) },
      ),
    ).toBe(false);
  });

  it('non-finite predictedOutAtMs blocks fire', () => {
    expect(
      shouldPushReminder(
        baseRow({ predictedOutAtMs: NaN }),
        TS,
        { localHourOf: fixedHour(10) },
      ),
    ).toBe(false);
  });
});

describe('shouldPushReminder · window gates', () => {
  it('before window (2d ahead) blocks fire', () => {
    const now = TS - 2 * DAY;
    expect(
      shouldPushReminder(baseRow(), now, { localHourOf: fixedHour(10) }),
    ).toBe(false);
  });

  it('after window (4h before predictedOut) blocks fire', () => {
    const now = TS - 4 * HOUR;
    expect(
      shouldPushReminder(baseRow(), now, { localHourOf: fixedHour(10) }),
    ).toBe(false);
  });

  it('at predictedOut blocks fire', () => {
    expect(
      shouldPushReminder(baseRow(), TS, { localHourOf: fixedHour(10) }),
    ).toBe(false);
  });

  it('1 day past predictedOut blocks fire', () => {
    const now = TS + DAY;
    expect(
      shouldPushReminder(baseRow(), now, { localHourOf: fixedHour(10) }),
    ).toBe(false);
  });
});

describe('shouldPushReminder · already-pushed gate', () => {
  it('pushedAtMs non-null blocks fire even mid-window', () => {
    const now = TS - 12 * HOUR;
    expect(
      shouldPushReminder(
        baseRow({ pushedAtMs: now - HOUR }),
        now,
        { localHourOf: fixedHour(10) },
      ),
    ).toBe(false);
  });

  it('pushedAtMs=0 still blocks (a legitimate epoch sentinel from tests)', () => {
    const now = TS - 12 * HOUR;
    expect(
      shouldPushReminder(
        baseRow({ pushedAtMs: 0 }),
        now,
        { localHourOf: fixedHour(10) },
      ),
    ).toBe(false);
  });
});

describe('shouldPushReminder · quiet hours', () => {
  const now = TS - 12 * HOUR;

  it('07:59 local → blocked', () => {
    expect(
      shouldPushReminder(baseRow(), now, { localHourOf: fixedHour(7) }),
    ).toBe(false);
  });

  it('08:00 local → allowed (inclusive start)', () => {
    expect(
      shouldPushReminder(baseRow(), now, { localHourOf: fixedHour(8) }),
    ).toBe(true);
  });

  it('21:59 local → allowed', () => {
    expect(
      shouldPushReminder(baseRow(), now, { localHourOf: fixedHour(21) }),
    ).toBe(true);
  });

  it('22:00 local → blocked (exclusive end)', () => {
    expect(
      shouldPushReminder(baseRow(), now, { localHourOf: fixedHour(22) }),
    ).toBe(false);
  });

  it('03:00 local → blocked (deep quiet)', () => {
    expect(
      shouldPushReminder(baseRow(), now, { localHourOf: fixedHour(3) }),
    ).toBe(false);
  });

  it('custom quiet hours override the defaults', () => {
    expect(
      shouldPushReminder(baseRow(), now, {
        localHourOf: fixedHour(7),
        quietStartHour: 6,
        quietEndHour: 23,
      }),
    ).toBe(true);
  });
});

describe('isWithinDailyWindow · standalone', () => {
  it('matches default 08:00-22:00', () => {
    expect(isWithinDailyWindow(0, 8, 22, fixedHour(8))).toBe(true);
    expect(isWithinDailyWindow(0, 8, 22, fixedHour(21))).toBe(true);
    expect(isWithinDailyWindow(0, 8, 22, fixedHour(22))).toBe(false);
    expect(isWithinDailyWindow(0, 8, 22, fixedHour(7))).toBe(false);
  });

  it('non-finite hour returns false defensively', () => {
    expect(isWithinDailyWindow(0, 8, 22, () => NaN)).toBe(false);
    expect(isWithinDailyWindow(0, 8, 22, () => Infinity)).toBe(false);
  });
});

describe('shouldPushReminder · custom window overrides', () => {
  it('shortened leadMs (e.g. 12h) shifts the fire-start later', () => {
    const now = TS - 18 * HOUR;
    // default 24h lead would FIRE; 12h lead means we're outside (too early)
    expect(
      shouldPushReminder(baseRow(), now, {
        leadMs: 12 * HOUR,
        localHourOf: fixedHour(10),
      }),
    ).toBe(false);
  });

  it('extended tailMs (e.g. 0h) lets fire happen at the predicted-out moment', () => {
    const now = TS - HOUR;
    // default 6h tail blocks; 0h tail lets it fire right up to predictedOut
    expect(
      shouldPushReminder(baseRow(), now, {
        tailMs: 0,
        localHourOf: fixedHour(10),
      }),
    ).toBe(true);
  });
});
