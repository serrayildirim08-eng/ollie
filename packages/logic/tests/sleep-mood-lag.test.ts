import { describe, it, expect } from 'vitest';
import { detectSleepMoodLag, type SleepSession, type DumpEntry } from '../src/patterns';

// Deterministic day grid anchored at a fixed UTC noon so the local dayKey is
// stable under both TZ=UTC and TZ=America/Los_Angeles.
const DAY = 86_400_000;
const BASE = Date.parse('2026-01-01T20:00:00Z'); // 12:00 PT / 20:00 UTC

function sleep(dayIdx: number, hours: number): SleepSession {
  return { ts: BASE + dayIdx * DAY, tstMinutes: Math.round(hours * 60) };
}
function dump(dayIdx: number, text: string): DumpEntry {
  return { ts: BASE + dayIdx * DAY, rawText: text };
}

describe('detectSleepMoodLag — post-selection bias control (#105)', () => {
  it('surfaces a strong, consistent same-day relationship', () => {
    // 30 days. Low sleep (<6h) → "exhausted" that day; high sleep → neutral.
    // A tight, real lag-0 association that should survive BH across 7 lags.
    const sleeps: SleepSession[] = [];
    const dumps: DumpEntry[] = [];
    for (let d = 0; d < 30; d++) {
      const low = d % 2 === 0; // alternate
      sleeps.push(sleep(d, low ? 4.5 : 8.5));
      dumps.push(dump(d, low ? 'totally exhausted today' : 'felt good and rested'));
    }
    const r = detectSleepMoodLag(sleeps, dumps, { seed: 7 });
    expect(r).not.toBeNull();
    expect(r?.type).toBe('sleep_mood_lag');
    // CI must exclude zero.
    expect(r?.ci_90).toBeDefined();
    expect((r!.ci_90[0] <= 0 && r!.ci_90[1] >= 0)).toBe(false);
  });

  it('does NOT surface a spurious peak from pure noise (false-positive guard)', () => {
    // 30 days of sleep with NO real link to "tired" mentions. A deterministic
    // pseudo-pattern that, scanned across 7 lags + a single naive CI, could
    // throw a false positive; BH across the family must suppress it.
    const sleeps: SleepSession[] = [];
    const dumps: DumpEntry[] = [];
    // Sleep follows one cycle; tired-mentions follow an unrelated, sparser one.
    for (let d = 0; d < 30; d++) {
      sleeps.push(sleep(d, 6 + ((d * 37) % 5) * 0.5)); // jittery, no trend
      const tired = (d * 13) % 7 === 0; // sparse, decoupled from sleep
      dumps.push(dump(d, tired ? 'so tired' : 'ordinary day, nothing much'));
    }
    const r = detectSleepMoodLag(sleeps, dumps, { seed: 7 });
    expect(r).toBeNull();
  });

  it('is deterministic for a given seed', () => {
    const sleeps: SleepSession[] = [];
    const dumps: DumpEntry[] = [];
    for (let d = 0; d < 30; d++) {
      const low = d % 2 === 0;
      sleeps.push(sleep(d, low ? 4.5 : 8.5));
      dumps.push(dump(d, low ? 'exhausted' : 'rested'));
    }
    const a = detectSleepMoodLag(sleeps, dumps, { seed: 11 });
    const b = detectSleepMoodLag(sleeps, dumps, { seed: 11 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
