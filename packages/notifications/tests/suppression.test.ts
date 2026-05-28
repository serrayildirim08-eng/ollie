/**
 * @ollie/notifications · suppression logic tests
 *
 * Covers quiet-hours window math (incl. the midnight wrap) and the
 * focus-session deferral rule. All times are constructed in the local TZ
 * via `new Date(y, m, d, h, mm)` so window-of-day math is stable.
 */

import { describe, it, expect } from 'vitest';
import {
  parseHHMM,
  resolveTargetHours,
  resolveQuietWindow,
  isInQuietWindow,
  deferPastQuietWindow,
  shouldDeferForFocus,
  applySuppression,
  DEFAULT_TARGET_HOURS,
} from '../src/suppression';

/** Local-time ms epoch for a given Y-M-D H:MM. month is 1-based for sanity. */
function at(y: number, mon: number, d: number, h: number, mm = 0): number {
  return new Date(y, mon - 1, d, h, mm, 0, 0).getTime();
}

describe('parseHHMM', () => {
  it('parses valid times to minutes-since-midnight', () => {
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('06:30')).toBe(390);
    expect(parseHHMM('23:00')).toBe(1380);
    expect(parseHHMM('23:59')).toBe(1439);
    expect(parseHHMM('9:05')).toBe(545); // single-digit hour ok
  });

  it('rejects malformed / out-of-range input', () => {
    expect(parseHHMM(null)).toBeNull();
    expect(parseHHMM(undefined)).toBeNull();
    expect(parseHHMM('')).toBeNull();
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('12:60')).toBeNull();
    expect(parseHHMM('noon')).toBeNull();
    expect(parseHHMM('12-30')).toBeNull();
  });
});

describe('resolveTargetHours', () => {
  it('defaults when absent or invalid', () => {
    expect(resolveTargetHours(null)).toBe(DEFAULT_TARGET_HOURS);
    expect(resolveTargetHours(undefined)).toBe(DEFAULT_TARGET_HOURS);
    expect(resolveTargetHours(Number.NaN)).toBe(DEFAULT_TARGET_HOURS);
  });

  it('clamps to [4, 12]', () => {
    expect(resolveTargetHours(2)).toBe(4);
    expect(resolveTargetHours(20)).toBe(12);
    expect(resolveTargetHours(8)).toBe(8);
  });
});

describe('resolveQuietWindow', () => {
  it('returns null when target_bedtime is null → quiet hours OFF', () => {
    expect(resolveQuietWindow({ target_bedtime: null })).toBeNull();
    expect(resolveQuietWindow({})).toBeNull();
    expect(resolveQuietWindow(null)).toBeNull();
    expect(resolveQuietWindow({ target_bedtime: 'garbage' })).toBeNull();
  });

  it('builds a wrapping window for a late bedtime', () => {
    // 23:00 + 7.5h = 06:30 → wraps midnight.
    const w = resolveQuietWindow({ target_bedtime: '23:00', target_hours: 7.5 });
    expect(w).toEqual({ startMin: 23 * 60, endMin: 6 * 60 + 30, wrapsMidnight: true });
  });

  it('builds a non-wrapping window for an after-midnight bedtime', () => {
    // 01:00 + 7h = 08:00 → same calendar day.
    const w = resolveQuietWindow({ target_bedtime: '01:00', target_hours: 7 });
    expect(w).toEqual({ startMin: 60, endMin: 8 * 60, wrapsMidnight: false });
  });

  it('uses the default target_hours when absent', () => {
    const w = resolveQuietWindow({ target_bedtime: '22:00' });
    // 22:00 + 7.5h = 05:30.
    expect(w).toEqual({ startMin: 22 * 60, endMin: 5 * 60 + 30, wrapsMidnight: true });
  });
});

describe('isInQuietWindow — wrapping window (23:00 → 06:30)', () => {
  const w = resolveQuietWindow({ target_bedtime: '23:00', target_hours: 7.5 })!;

  it('is inside late at night (post-bedtime, pre-midnight)', () => {
    expect(isInQuietWindow(at(2026, 5, 18, 23, 30), w)).toBe(true);
    expect(isInQuietWindow(at(2026, 5, 18, 23, 0), w)).toBe(true); // start inclusive
  });

  it('is inside in the small hours (post-midnight, pre-wake)', () => {
    expect(isInQuietWindow(at(2026, 5, 18, 0, 1), w)).toBe(true);
    expect(isInQuietWindow(at(2026, 5, 18, 3, 0), w)).toBe(true);
    expect(isInQuietWindow(at(2026, 5, 18, 6, 29), w)).toBe(true);
  });

  it('is outside during the day', () => {
    expect(isInQuietWindow(at(2026, 5, 18, 6, 30), w)).toBe(false); // end exclusive
    expect(isInQuietWindow(at(2026, 5, 18, 12, 0), w)).toBe(false);
    expect(isInQuietWindow(at(2026, 5, 18, 22, 59), w)).toBe(false);
  });
});

describe('isInQuietWindow — non-wrapping window (01:00 → 08:00)', () => {
  const w = resolveQuietWindow({ target_bedtime: '01:00', target_hours: 7 })!;

  it('is inside between start and end', () => {
    expect(isInQuietWindow(at(2026, 5, 18, 1, 0), w)).toBe(true);
    expect(isInQuietWindow(at(2026, 5, 18, 5, 0), w)).toBe(true);
    expect(isInQuietWindow(at(2026, 5, 18, 7, 59), w)).toBe(true);
  });

  it('is outside before start and at/after end', () => {
    expect(isInQuietWindow(at(2026, 5, 18, 0, 59), w)).toBe(false);
    expect(isInQuietWindow(at(2026, 5, 18, 8, 0), w)).toBe(false);
    expect(isInQuietWindow(at(2026, 5, 18, 23, 0), w)).toBe(false);
  });
});

describe('deferPastQuietWindow — midnight wrap', () => {
  const w = resolveQuietWindow({ target_bedtime: '23:00', target_hours: 7.5 })!;

  it('post-bedtime, pre-midnight fire → defers to NEXT-day wake time', () => {
    const fire = at(2026, 5, 18, 23, 30);
    const out = deferPastQuietWindow(fire, w);
    expect(out).toBe(at(2026, 5, 19, 6, 30));
  });

  it('small-hours fire → defers to SAME-day wake time', () => {
    const fire = at(2026, 5, 18, 2, 15);
    const out = deferPastQuietWindow(fire, w);
    expect(out).toBe(at(2026, 5, 18, 6, 30));
  });

  it('a fire just before wake defers to wake the same morning', () => {
    const fire = at(2026, 5, 18, 6, 29);
    expect(deferPastQuietWindow(fire, w)).toBe(at(2026, 5, 18, 6, 30));
  });

  it('a fire during the day is returned unchanged', () => {
    const fire = at(2026, 5, 18, 14, 0);
    expect(deferPastQuietWindow(fire, w)).toBe(fire);
  });
});

describe('deferPastQuietWindow — non-wrapping window (01:00 → 08:00)', () => {
  const w = resolveQuietWindow({ target_bedtime: '01:00', target_hours: 7 })!;

  it('a fire inside defers to wake on the same day', () => {
    const fire = at(2026, 5, 18, 3, 0);
    expect(deferPastQuietWindow(fire, w)).toBe(at(2026, 5, 18, 8, 0));
  });

  it('never moves the fire backwards', () => {
    const fire = at(2026, 5, 18, 7, 30);
    expect(deferPastQuietWindow(fire, w)).toBeGreaterThanOrEqual(fire);
  });
});

describe('shouldDeferForFocus', () => {
  const now = at(2026, 5, 18, 10, 0);
  const focus = { startedAt: at(2026, 5, 18, 9, 45), endsAt: at(2026, 5, 18, 11, 15) };

  it('defers PATTERN_ALERT firing during an active session', () => {
    expect(shouldDeferForFocus(at(2026, 5, 18, 10, 30), 'PATTERN_ALERT', focus, now)).toBe(true);
  });

  it('defers CONTENT_DELIVERY firing during an active session', () => {
    expect(shouldDeferForFocus(at(2026, 5, 18, 10, 30), 'CONTENT_DELIVERY', focus, now)).toBe(true);
  });

  it('lets REMINDER through even mid-session (deadlines may interrupt)', () => {
    expect(shouldDeferForFocus(at(2026, 5, 18, 10, 30), 'REMINDER', focus, now)).toBe(false);
  });

  it('does nothing when there is no focus session', () => {
    expect(shouldDeferForFocus(at(2026, 5, 18, 10, 30), 'PATTERN_ALERT', null, now)).toBe(false);
  });

  it('does nothing when the session is not currently active', () => {
    const stale = { startedAt: at(2026, 5, 18, 7, 0), endsAt: at(2026, 5, 18, 8, 0) };
    expect(shouldDeferForFocus(at(2026, 5, 18, 10, 30), 'PATTERN_ALERT', stale, now)).toBe(false);
  });

  it('does not defer a notification that fires after the session ends', () => {
    expect(shouldDeferForFocus(at(2026, 5, 18, 12, 0), 'PATTERN_ALERT', focus, now)).toBe(false);
  });

  it('does not defer a fire exactly at session end (end-exclusive)', () => {
    expect(shouldDeferForFocus(focus.endsAt, 'PATTERN_ALERT', focus, now)).toBe(false);
  });
});

describe('applySuppression — composition', () => {
  it('no rules apply → unchanged, not deferred', () => {
    const out = applySuppression({
      fireAt: at(2026, 5, 18, 14, 0),
      category: 'PATTERN_ALERT',
      now: at(2026, 5, 18, 14, 0),
      sleepSettings: null,
      activeFocus: null,
    });
    expect(out.deferred).toBe(false);
    expect(out.reasons).toEqual([]);
    expect(out.fireAt).toBe(at(2026, 5, 18, 14, 0));
  });

  it('quiet hours alone defers an immediate small-hours notification', () => {
    const out = applySuppression({
      fireAt: at(2026, 5, 18, 3, 0),
      category: 'REMINDER',
      now: at(2026, 5, 18, 3, 0),
      sleepSettings: { target_bedtime: '23:00', target_hours: 7.5 },
      activeFocus: null,
    });
    expect(out.deferred).toBe(true);
    expect(out.reasons).toEqual(['quiet-hours']);
    expect(out.fireAt).toBe(at(2026, 5, 18, 6, 30));
  });

  it('focus suppression alone defers a PATTERN_ALERT to session end', () => {
    const focus = { startedAt: at(2026, 5, 18, 10, 0), endsAt: at(2026, 5, 18, 11, 30) };
    const out = applySuppression({
      fireAt: at(2026, 5, 18, 10, 30),
      category: 'PATTERN_ALERT',
      now: at(2026, 5, 18, 10, 15),
      sleepSettings: null,
      activeFocus: focus,
    });
    expect(out.deferred).toBe(true);
    expect(out.reasons).toEqual(['focus-session']);
    expect(out.fireAt).toBe(focus.endsAt);
  });

  it('REMINDER ignores focus but still obeys quiet hours', () => {
    const focus = { startedAt: at(2026, 5, 18, 10, 0), endsAt: at(2026, 5, 18, 11, 30) };
    const out = applySuppression({
      fireAt: at(2026, 5, 18, 10, 30),
      category: 'REMINDER',
      now: at(2026, 5, 18, 10, 15),
      sleepSettings: { target_bedtime: '23:00', target_hours: 7.5 },
      activeFocus: focus,
    });
    // 10:30 is outside quiet hours and REMINDER skips focus → unchanged.
    expect(out.deferred).toBe(false);
    expect(out.fireAt).toBe(at(2026, 5, 18, 10, 30));
  });

  it('both rules compose: focus end lands in quiet hours → final = wake time', () => {
    // Late-night focus session ending at 23:40, inside a 23:00→06:30 window.
    const focus = { startedAt: at(2026, 5, 18, 22, 30), endsAt: at(2026, 5, 18, 23, 40) };
    const out = applySuppression({
      fireAt: at(2026, 5, 18, 23, 0),
      category: 'CONTENT_DELIVERY',
      now: at(2026, 5, 18, 23, 10),
      sleepSettings: { target_bedtime: '23:00', target_hours: 7.5 },
      activeFocus: focus,
    });
    expect(out.deferred).toBe(true);
    expect(out.reasons).toEqual(['focus-session', 'quiet-hours']);
    // focus pushes to 23:40, still in quiet hours → wake next morning 06:30.
    expect(out.fireAt).toBe(at(2026, 5, 19, 6, 30));
  });

  it('always defers, never drops — output fireAt is monotonic', () => {
    const inputFire = at(2026, 5, 18, 2, 0);
    const out = applySuppression({
      fireAt: inputFire,
      category: 'CONTENT_DELIVERY',
      now: at(2026, 5, 18, 2, 0),
      sleepSettings: { target_bedtime: '00:30', target_hours: 8 },
      activeFocus: null,
    });
    expect(out.fireAt).toBeGreaterThanOrEqual(inputFire);
  });
});
