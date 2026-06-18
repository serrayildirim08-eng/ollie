/**
 * isoWeekKey consolidation (#146).
 *
 * There used to be three divergent impls (body-weekly = LOCAL, body-correlations
 * + goals = UTC) used as cross-module dedupe keys, so the same instant could
 * map to two different week keys depending on which detector computed it.
 * They are now one shared UTC-based impl exported from the package root.
 *
 * These assertions are TZ-independent: a stable, UTC-anchored key means the
 * suite passes identically under TZ=UTC and TZ=America/Los_Angeles (the CI
 * runs both for this finding).
 */

import { describe, expect, it } from 'vitest';
import { isoWeekKey } from '../src/index';

describe('isoWeekKey · single UTC-based impl (#146)', () => {
  it('is computed in UTC (independent of the runtime timezone)', () => {
    // A fixed UTC instant must yield the same key whatever TZ the test runs in.
    // 2026-05-13T12:00:00Z is a Wednesday in ISO week 20 of 2026.
    const ts = Date.UTC(2026, 4, 13, 12, 0, 0);
    expect(isoWeekKey(ts)).toBe('2026-W20');
  });

  it('same ISO week → same key; adjacent week → different key', () => {
    const w20 = Date.UTC(2026, 4, 13, 0, 0, 0); // Wed W20
    const w20b = Date.UTC(2026, 4, 15, 23, 0, 0); // Fri W20
    const w21 = Date.UTC(2026, 4, 18, 12, 0, 0); // Mon W21
    expect(isoWeekKey(w20)).toBe(isoWeekKey(w20b));
    expect(isoWeekKey(w20)).not.toBe(isoWeekKey(w21));
  });

  it('a UTC-midnight Monday belongs to its own ISO week', () => {
    // Mon 2026-05-18T00:00:00Z is the first day of ISO week 21.
    expect(isoWeekKey(Date.UTC(2026, 4, 18, 0, 0, 0))).toBe('2026-W21');
    // The instant one ms earlier is still the prior week (Sun W20).
    expect(isoWeekKey(Date.UTC(2026, 4, 18, 0, 0, 0) - 1)).toBe('2026-W20');
  });

  it('handles the year-boundary week correctly (ISO week belongs to Thursday year)', () => {
    // 2026-01-01 is a Thursday → ISO week 1 of 2026.
    expect(isoWeekKey(Date.UTC(2026, 0, 1, 12, 0, 0))).toBe('2026-W01');
    // 2025-12-29 (Mon) is in the same ISO week as 2026-01-01 → also 2026-W01.
    expect(isoWeekKey(Date.UTC(2025, 11, 29, 12, 0, 0))).toBe('2026-W01');
  });
});
