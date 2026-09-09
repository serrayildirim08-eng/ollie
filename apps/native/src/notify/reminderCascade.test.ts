/**
 * notify/reminderCascade — manual-reminder cascade logic.
 *
 * Covers the four behaviours the manual-reminder done-definition pins:
 *   1. explicit time → that time today,
 *   2. past time → rolls forward to tomorrow (never schedules in the past),
 *   3. 7pm dismiss fallback → today 19:00 (or tomorrow if past 19:00),
 *   4. the quick-pick presets resolve sanely.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveTimeOfDayFireAt,
  fallbackFireAt,
  FALLBACK_HHMM,
  WHEN_PRESETS,
} from './reminderCascade';

/** Build a local Date at the given local wall-clock for deterministic tests. */
function at(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

describe('resolveTimeOfDayFireAt — explicit time', () => {
  it('schedules 6pm today when dumped in the morning', () => {
    const now = at(2026, 6, 28, 9, 0); // 9am
    const fire = resolveTimeOfDayFireAt('18:00', now)!;
    const d = new Date(fire);
    expect(d.getDate()).toBe(28); // same day
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(0);
    expect(fire).toBeGreaterThan(now.getTime());
  });

  it('parses am/pm-style hours via the HH:MM the router emits (09:00, 12:00)', () => {
    const now = at(2026, 6, 28, 6, 0);
    expect(new Date(resolveTimeOfDayFireAt('09:00', now)!).getHours()).toBe(9);
    expect(new Date(resolveTimeOfDayFireAt('12:00', now)!).getHours()).toBe(12);
  });

  it('returns null for a malformed time string', () => {
    expect(resolveTimeOfDayFireAt('6pm')).toBeNull();
    expect(resolveTimeOfDayFireAt('25:00')).toBeNull();
    expect(resolveTimeOfDayFireAt('')).toBeNull();
  });
});

describe('resolveTimeOfDayFireAt — past-time roll-forward (done-def #3)', () => {
  it('rolls to tomorrow when the time already passed today', () => {
    const now = at(2026, 6, 28, 20, 0); // 8pm — "at 6pm" already gone
    const fire = resolveTimeOfDayFireAt('18:00', now)!;
    const d = new Date(fire);
    expect(d.getDate()).toBe(29); // next day
    expect(d.getHours()).toBe(18);
    expect(fire).toBeGreaterThan(now.getTime());
  });

  it('rolls forward when the time equals now exactly (never schedules == now)', () => {
    const now = at(2026, 6, 28, 18, 0);
    const fire = resolveTimeOfDayFireAt('18:00', now)!;
    expect(new Date(fire).getDate()).toBe(29);
    expect(fire).toBeGreaterThan(now.getTime());
  });
});

describe('fallbackFireAt — 7pm dismiss fallback (done-def #2)', () => {
  it('falls back to 7pm TODAY when dumped before 7pm', () => {
    const now = at(2026, 6, 28, 14, 0); // 2pm
    const fire = fallbackFireAt(now);
    const d = new Date(fire);
    expect(d.getDate()).toBe(28);
    expect(d.getHours()).toBe(19);
    expect(d.getMinutes()).toBe(0);
  });

  it('rolls to 7pm tomorrow when dumped after 7pm (never the past)', () => {
    const now = at(2026, 6, 28, 21, 30); // 9:30pm
    const fire = fallbackFireAt(now);
    const d = new Date(fire);
    expect(d.getDate()).toBe(29);
    expect(d.getHours()).toBe(19);
    expect(fire).toBeGreaterThan(now.getTime());
  });

  it('uses the documented 7pm constant', () => {
    expect(FALLBACK_HHMM).toBe('19:00');
  });
});

describe('WHEN_PRESETS', () => {
  it('every preset resolves to a future fire time', () => {
    const now = at(2026, 6, 28, 8, 0);
    for (const preset of WHEN_PRESETS) {
      const fire = resolveTimeOfDayFireAt(preset.hhmm, now);
      expect(fire).not.toBeNull();
      expect(fire!).toBeGreaterThan(now.getTime());
    }
  });

  it('includes the 7pm "tonight" default', () => {
    expect(WHEN_PRESETS.some((p) => p.hhmm === FALLBACK_HHMM)).toBe(true);
  });
});
