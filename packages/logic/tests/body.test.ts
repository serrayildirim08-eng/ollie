/**
 * @ollie/logic · body tests
 *
 * 25 cases across all feature families.
 */

import { describe, it, expect } from 'vitest';
import {
  // math
  dayKey,
  pearson,
  spearman,
  nextDayKey,
  // patterns
  detectHeadacheHydration,
  detectInteroceptionDrift,
  detectAfternoonCrashWindow,
  detectSupplementDrift,
  detectHungerThirstConfusion,
  detectMovementGap,
  detectVasomotorPattern,
  detectPatterns,
  detectHyperfocusDehydration,
  detectMultiSymptomRecurrence,
  detectCaffeineWaterTradeoff,
  detectMealSkipPattern,
  detectGISymptomCyclePhase,
  detectSymptomPhaseCoupling,
  detectSleepDebtSymptomLag,
  envelopeCopy,
  // episodes
  openEpisode,
  startEpisode,
  normalizeEpisode,
  isWellFormedEpisode,
  logSeverity,
  closeEpisode,
  activeEpisode,
  summarizeEpisode,
  detectDurationDistribution,
  detectMedicationAdherence,
  detectTriggerCorrelation,
  detectRecurrenceRhythm,
  detectMentalEpisodePattern,
  generateDoctorSummary,
  // signals
  detectSleepDebtFocusQuality,
  detectCyclePhaseEnergy,
  detectBodySignals,
  // pacing
  detectBreachSession,
  newBreachEpisode,
  isBreachExpired,
  autoCloseExpiredBreaches,
  hasOpenBreachForSession,
  // treatments
  newTreatmentPlan,
  cyclePosition,
  detectSideEffectPattern,
} from '../src/body';

// ─── helpers ─────────────────────────────────────────────────────────────────

const DAY = 86400000;
const HOUR = 3600000;
const MIN = 60000;

/** Build a fake "now" anchored to a fixed epoch. */
const NOW = new Date('2026-01-15T12:00:00Z').getTime();

// ─── math ────────────────────────────────────────────────────────────────────

describe('dayKey', () => {
  it('formats epoch ms as YYYY-MM-DD', () => {
    expect(dayKey(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('pearson', () => {
  it('returns -1 for perfectly anti-correlated vectors', () => {
    const r = pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
    expect(r).toBeCloseTo(-1, 5);
  });
  it('returns 0 for degenerate (< 3 values)', () => {
    expect(pearson([1, 2], [2, 1])).toBe(0);
  });
});

describe('spearman', () => {
  it('returns -1 for monotonically anti-correlated vectors', () => {
    expect(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1, 5);
  });
});

describe('nextDayKey', () => {
  it('advances by one day', () => {
    expect(nextDayKey('2026-01-15')).toBe('2026-01-16');
  });
  it('rolls over month boundary', () => {
    expect(nextDayKey('2026-01-31')).toBe('2026-02-01');
  });
  it('returns null for invalid key', () => {
    expect(nextDayKey('not-a-date')).toBeNull();
  });
});

// ─── detectHeadacheHydration ──────────────────────────────────────────────────

describe('detectHeadacheHydration', () => {
  it('returns null when sample < minSampleDays', () => {
    const result = detectHeadacheHydration({ now: NOW, dumps: [], waterLog: [] });
    expect(result).toBeNull();
  });

  it('surfaces pattern when negative r is strong enough', () => {
    // 20 days: low AM water → headache; high AM water → no headache
    const dumps = [];
    const waterLog = [];
    for (let i = 0; i < 20; i++) {
      const ts = NOW - (20 - i) * DAY;
      const lowWater = i % 2 === 0;
      if (lowWater) {
        // Only 1 AM glass
        waterLog.push(ts - 8 * HOUR); // ~4am
        dumps.push({ ts, rawText: 'başım ağrıyor headache' });
      } else {
        // 4 AM glasses
        for (let g = 0; g < 4; g++) waterLog.push(ts - (9 - g) * HOUR);
      }
    }
    const result = detectHeadacheHydration({ now: NOW, dumps, waterLog }, { minSampleDays: 14, minRunLength: 3, minAbsR: 0.2 });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('headache-hydration');
    expect(result?.r).toBeLessThan(0);
  });
});

// ─── detectInteroceptionDrift ─────────────────────────────────────────────────

describe('detectInteroceptionDrift', () => {
  it('returns null when fewer than minEntries water logs', () => {
    const result = detectInteroceptionDrift({ now: NOW, waterLog: [NOW - 1000, NOW - 2000] });
    expect(result).toBeNull();
  });

  it('surfaces pattern with wildly uneven intervals', () => {
    const waterLog = [
      NOW - 13 * DAY,
      NOW - 13 * DAY + 2 * MIN,      // gap: 2m
      NOW - 13 * DAY + 3 * HOUR,     // gap: ~3h
      NOW - 10 * DAY,                 // gap: ~3d
      NOW - 10 * DAY + 5 * MIN,
      NOW - 10 * DAY + 6 * HOUR,
      NOW - 5 * DAY,
      NOW - 5 * DAY + 3 * MIN,
      NOW - 5 * DAY + 4 * HOUR,
      NOW - 1 * DAY,                  // big gap again
    ];
    const result = detectInteroceptionDrift(
      { now: NOW, waterLog },
      { minEntries: 8, cvThreshold: 1.0, minRunLength: 2 },
    );
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('interoception_drift');
    expect(result?.cv).toBeGreaterThan(1.0);
  });
});

// ─── detectAfternoonCrashWindow ───────────────────────────────────────────────

describe('detectAfternoonCrashWindow', () => {
  it('returns null when sample < minSampleN', () => {
    const result = detectAfternoonCrashWindow({ now: NOW, dumps: [] });
    expect(result).toBeNull();
  });

  it('surfaces afternoon block when 14:00–16:00 is dominant', () => {
    const dumps = [];
    for (let d = 0; d < 20; d++) {
      const base = NOW - (20 - d) * DAY;
      // 15 crashes at 14:30, 5 elsewhere
      const hour = d < 15 ? 14 : 10;
      dumps.push({ ts: base + hour * HOUR + 30 * MIN, rawText: 'tükendim' });
    }
    const result = detectAfternoonCrashWindow(
      { now: NOW, dumps },
      { minSampleN: 8, peakShareThreshold: 0.4, minRunLength: 3 },
    );
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('afternoon_crash_window');
    expect(result?.peak_block.start_hour).toBeLessThanOrEqual(14);
  });
});

// ─── detectSupplementDrift ────────────────────────────────────────────────────

describe('detectSupplementDrift', () => {
  it('returns null when prior window has < priorMinDays', () => {
    const result = detectSupplementDrift({ now: NOW, supplementLog: [] });
    expect(result).toBeNull();
  });

  it('surfaces when recent adherence drops 50%+ vs prior', () => {
    const log = [];
    // Prior 2 weeks (days 28-15 ago): 12 days logged
    for (let i = 15; i < 28; i++) log.push({ ts: NOW - i * DAY });
    // Recent 2 weeks (days 14-1 ago): only 3 days logged
    for (let i = 1; i <= 3; i++) log.push({ ts: NOW - i * DAY });

    const result = detectSupplementDrift({ now: NOW, supplementLog: log }, { priorMinDays: 7 });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('supplement_drift');
    expect(result?.drop_ratio).toBeGreaterThanOrEqual(0.3);
  });
});

// ─── detectHungerThirstConfusion ──────────────────────────────────────────────

describe('detectHungerThirstConfusion', () => {
  it('surfaces when water is followed by food within burstWindow', () => {
    const waterLog: number[] = [];
    const dumps: Array<{ ts: number; rawText: string }> = [];
    for (let i = 0; i < 10; i++) {
      const base = NOW - (10 - i) * DAY;
      waterLog.push(base);
      dumps.push({ ts: base + 15 * MIN, rawText: 'acıktım yedim snack' });
    }
    const result = detectHungerThirstConfusion(
      { now: NOW, waterLog, dumps },
      { minBursts: 5, burstWindowMin: 20 },
    );
    expect(result).not.toBeNull();
    expect(result?.burst_count).toBeGreaterThanOrEqual(5);
  });
});

// ─── detectMovementGap ────────────────────────────────────────────────────────

describe('detectMovementGap', () => {
  it('surfaces when almost no movement logged in 14 days', () => {
    const dumps = [];
    // 8 days of logs, only 1 movement day
    for (let i = 1; i <= 8; i++) {
      dumps.push({ ts: NOW - i * DAY, rawText: i === 3 ? 'gym workout' : 'random stuff' });
    }
    const result = detectMovementGap(
      { now: NOW, dumps },
      { movementCeiling: 4, minObservedDays: 5 },
    );
    expect(result).not.toBeNull();
    expect(result?.movement_days).toBe(1);
  });

  it('returns null when movement is above ceiling', () => {
    const dumps = [];
    for (let i = 1; i <= 8; i++) {
      dumps.push({ ts: NOW - i * DAY, rawText: 'gym workout' });
    }
    const result = detectMovementGap({ now: NOW, dumps }, { movementCeiling: 4 });
    expect(result).toBeNull();
  });
});

// ─── detectVasomotorPattern ───────────────────────────────────────────────────

describe('detectVasomotorPattern', () => {
  it('returns null when menstruation != not_anymore', () => {
    const result = detectVasomotorPattern({ now: NOW, dumps: [], settings: {} });
    expect(result).toBeNull();
  });

  it('surfaces when ≥ minDays have vasomotor mentions', () => {
    const dumps = [];
    for (let i = 1; i <= 10; i++) {
      dumps.push({ ts: NOW - i * DAY, rawText: 'gece terlemesi ve sıcak basma' });
    }
    const result = detectVasomotorPattern(
      { now: NOW, dumps, settings: { menstruation: 'not_anymore' } },
      { minDays: 6 },
    );
    expect(result).not.toBeNull();
    expect(result?.symptom_days).toBe(10);
  });
});

// ─── detectPatterns (integration) ────────────────────────────────────────────

describe('detectPatterns', () => {
  it('returns an array (may be empty) for empty history', () => {
    const result = detectPatterns({ now: NOW });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── episodes ────────────────────────────────────────────────────────────────

describe('episode CRUD', () => {
  it('openEpisode creates a valid episode', () => {
    const ep = openEpisode('grip', 'acute', { now: NOW });
    expect(ep.id).toMatch(/^ep_/);
    expect(ep.started_at).toBe(NOW);
    expect(ep.ended_at).toBeUndefined();
  });

  it('logSeverity appends entry immutably', () => {
    const ep = openEpisode('grip', 'acute', { now: NOW });
    const ep2 = logSeverity(ep, 3, { now: NOW + HOUR, note: 'still bad' });
    expect(ep.severity_log).toHaveLength(0);
    expect(ep2.severity_log).toHaveLength(1);
    expect(ep2.severity_log[0].note).toBe('still bad');
  });

  it('closeEpisode sets ended_at', () => {
    const ep = openEpisode('grip', 'acute', { now: NOW });
    const closed = closeEpisode(ep, { now: NOW + 2 * DAY });
    expect(closed.ended_at).toBe(NOW + 2 * DAY);
  });

  it('activeEpisode returns the most recent open episode', () => {
    const ep1 = openEpisode('old', 'acute', { now: NOW - 5 * DAY });
    const ep2 = openEpisode('new', 'acute', { now: NOW - DAY });
    const closed = closeEpisode(openEpisode('closed', 'acute', { now: NOW - 10 * DAY }), { now: NOW - 9 * DAY });
    expect(activeEpisode([ep1, ep2, closed])?.label).toBe('new');
  });

  it('summarizeEpisode computes duration and severity correctly', () => {
    const ep = openEpisode('test', 'acute', { now: NOW });
    const ep2 = logSeverity(ep, 4, { now: NOW + HOUR });
    const ep3 = logSeverity(ep2, 2, { now: NOW + 2 * HOUR });
    const ep4 = closeEpisode(ep3, { now: NOW + 3 * DAY });
    const s = summarizeEpisode(ep4, { now: NOW + 3 * DAY });
    expect(s.max_severity).toBe(4);
    expect(s.mean_severity).toBe(3);
    expect(s.duration_days).toBe(3);
  });
});

// ─── detectDurationDistribution ───────────────────────────────────────────────

describe('detectDurationDistribution', () => {
  it('returns null when no open episode is outlier-long', () => {
    // 4 closed 2-day episodes, open episode also 2 days → not outlier
    const eps = [];
    for (let i = 0; i < 4; i++) {
      const start = NOW - (10 + i * 5) * DAY;
      eps.push({ ...openEpisode('grip', 'acute', { now: start }), ended_at: start + 2 * DAY });
    }
    eps.push(openEpisode('grip', 'acute', { now: NOW - 2 * DAY }));
    expect(detectDurationDistribution(eps, { now: NOW })).toBeNull();
  });

  it('surfaces when open episode is >> mean + 1.5sd', () => {
    const eps = [];
    for (let i = 0; i < 4; i++) {
      const start = NOW - (10 + i * 5) * DAY;
      eps.push({ ...openEpisode('grip', 'acute', { now: start }), ended_at: start + 2 * DAY });
    }
    // Open episode started 20 days ago (well past mean + 1.5sd for 2-day history)
    eps.push(openEpisode('grip', 'acute', { now: NOW - 20 * DAY }));
    const result = detectDurationDistribution(eps, { now: NOW });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('episode_duration_distribution');
  });
});

// ─── detectMedicationAdherence ────────────────────────────────────────────────

describe('detectMedicationAdherence', () => {
  it('surfaces when current gap >> median interval', () => {
    const ep = openEpisode('grip', 'acute', { now: NOW - 10 * DAY });
    // Log med every 8h for 4 times, then nothing for 24h
    const medEp = [
      { ts: NOW - 10 * DAY, name: 'ibuprofen' },
      { ts: NOW - 10 * DAY + 8 * HOUR, name: 'ibuprofen' },
      { ts: NOW - 10 * DAY + 16 * HOUR, name: 'ibuprofen' },
      { ts: NOW - 9 * DAY + 0 * HOUR, name: 'ibuprofen' },
    ] as const;
    const ep2 = { ...ep, meds: [...medEp] };
    // now is 24h after last log → ~3x median of 8h
    const result = detectMedicationAdherence(ep2, { now: NOW - 9 * DAY + 24 * HOUR, gapMultiplier: 1.5 });
    expect(result).not.toBeNull();
    expect(result?.med_name).toBe('ibuprofen');
  });
});

// ─── generateDoctorSummary ────────────────────────────────────────────────────

describe('generateDoctorSummary', () => {
  it('produces a string with episode label and dates', () => {
    const ep = openEpisode('migren', 'acute', { now: NOW - 3 * DAY });
    const ep2 = closeEpisode(ep, { now: NOW });
    const summary = generateDoctorSummary(ep2, {}, { now: NOW });
    expect(summary).toContain('migren');
    expect(summary).toContain('generated by ollie');
  });
});

// ─── pacing breach ────────────────────────────────────────────────────────────

describe('pacing breach', () => {
  it('detectBreachSession finds the longest qualifying session', () => {
    const sessions = [
      { start: NOW - 10 * HOUR, end: NOW - 2 * HOUR },  // 8h ✓
      { start: NOW - 12 * HOUR, end: NOW - 9 * HOUR },  // 3h ✗
    ];
    const ref = detectBreachSession(sessions, { now: NOW, minHours: 8 });
    expect(ref).not.toBeNull();
    expect(ref?.duration_hours).toBeCloseTo(8, 0);
  });

  it('isBreachExpired returns true after recovery window', () => {
    const ref = { start: NOW - 10 * HOUR, end: NOW - 2 * HOUR, duration_hours: 8 };
    const ep = newBreachEpisode(ref, { now: NOW - 73 * HOUR, recoveryHours: 72 });
    expect(isBreachExpired(ep, NOW)).toBe(true);
  });

  it('hasOpenBreachForSession prevents duplicates', () => {
    const ref = { start: 1000, end: 2000, duration_hours: 1 };
    const ep = newBreachEpisode(ref, { now: NOW });
    expect(hasOpenBreachForSession([ep], ref)).toBe(true);
    expect(hasOpenBreachForSession([ep], { ...ref, start: 999 })).toBe(false);
  });

  it('autoCloseExpiredBreaches closes expired episodes only', () => {
    const ref = { start: NOW - 10 * HOUR, end: NOW - 2 * HOUR, duration_hours: 8 };
    const old = newBreachEpisode(ref, { now: NOW - 100 * HOUR, recoveryHours: 72 });
    const fresh = newBreachEpisode(ref, { now: NOW - 10 * HOUR, recoveryHours: 72 });
    const result = autoCloseExpiredBreaches([old, fresh], NOW);
    expect(result[0].closed_at).toBe(NOW);
    expect(result[1].closed_at).toBeNull();
  });
});

// ─── treatment plans ──────────────────────────────────────────────────────────

describe('treatment plans', () => {
  it('newTreatmentPlan creates a valid plan', () => {
    const plan = newTreatmentPlan('kemo', { now: NOW, cycle_length_days: 21, total_cycles: 6 });
    expect(plan.id).toMatch(/^tx_/);
    expect(plan.cycle_length_days).toBe(21);
  });

  it('cyclePosition returns correct day in first cycle', () => {
    const plan = newTreatmentPlan('kemo', { now: NOW, cycle_starts: [NOW] });
    const pos = cyclePosition(plan, NOW + 5 * DAY);
    expect(pos?.day_of_cycle).toBe(6);
    expect(pos?.cycle_n).toBe(1);
  });

  it('detectSideEffectPattern surfaces hot days across cycles', () => {
    const cycleStart1 = NOW - 50 * DAY;
    const cycleStart2 = NOW - 29 * DAY;
    const plan = newTreatmentPlan('kemo', {
      now: cycleStart1,
      cycle_starts: [cycleStart1, cycleStart2],
      cycle_length_days: 21,
      total_cycles: 2,
    });
    // Dumps on day 3 of each cycle
    const dumps = [
      { ts: cycleStart1 + 2 * DAY, rawText: 'tükendim mide bulantısı' },
      { ts: cycleStart2 + 2 * DAY, rawText: 'exhausted nausea' },
    ];
    const result = detectSideEffectPattern(plan, dumps, { minCycles: 2, concThreshold: 0.5 });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('treatment_side_effect_cycle');
  });
});

// ─── envelopeCopy ────────────────────────────────────────────────────────────

describe('envelopeCopy', () => {
  it('returns dry copy when energy_envelope_on=false', () => {
    expect(envelopeCopy({ dry: 'short', envelope: 'long pacing' }, false)).toBe('short');
  });

  it('returns envelope copy when energy_envelope_on=true', () => {
    expect(envelopeCopy({ dry: 'short', envelope: 'long pacing' }, true)).toBe('long pacing');
  });

  it('falls back to dry when envelope key absent and flag true', () => {
    expect(envelopeCopy({ dry: 'only dry' }, true)).toBe('only dry');
  });

  it('falls back to envelope when dry key absent and flag false', () => {
    expect(envelopeCopy({ envelope: 'only envelope' }, false)).toBe('only envelope');
  });

  it('passes plain string through unchanged regardless of flag', () => {
    expect(envelopeCopy('plain string', false)).toBe('plain string');
    expect(envelopeCopy('plain string', true)).toBe('plain string');
  });

  it('returns empty string for null/undefined', () => {
    expect(envelopeCopy(null, false)).toBe('');
    expect(envelopeCopy(undefined, true)).toBe('');
  });
});

// ─── startEpisode ─────────────────────────────────────────────────────────────

describe('startEpisode', () => {
  it('appends a valid open episode to the array', () => {
    const next = startEpisode([], 'migraine', 'acute', { now: NOW });
    expect(next).toHaveLength(1);
    expect(next[0].label).toBe('migraine');
    expect(next[0].started_at).toBe(NOW);
    expect(next[0].ended_at).toBeUndefined();
    expect(isWellFormedEpisode(next[0])).toBe(true);
  });

  it('does not mutate the input array', () => {
    const existing = [openEpisode('old', 'acute', { now: NOW - 10 * DAY })];
    const next = startEpisode(existing, 'new', 'mental', { now: NOW });
    expect(existing).toHaveLength(1);
    expect(next).toHaveLength(2);
  });

  it('tolerates null/undefined episodes input', () => {
    expect(startEpisode(null, 'x', 'acute', { now: NOW })).toHaveLength(1);
    expect(startEpisode(undefined, 'x', 'acute', { now: NOW })).toHaveLength(1);
  });
});

// ─── normalizeEpisode / isWellFormedEpisode ──────────────────────────────────

describe('normalizeEpisode', () => {
  it('backfills a brain-dump-shaped {id,text,ts} object', () => {
    // This is exactly what braindump-dispatch currently writes.
    const raw = { id: 'bd_1', text: 'bad migraine all day', ts: NOW };
    const ep = normalizeEpisode(raw, { now: NOW });
    expect(ep.id).toBe('bd_1');
    expect(ep.started_at).toBe(NOW);
    expect(ep.label).toBe('bad migraine all day');
    expect(ep.kind).toBe('acute');
    expect(Array.isArray(ep.severity_log)).toBe(true);
    expect(Array.isArray(ep.meds)).toBe(true);
    expect(Array.isArray(ep.notes)).toBe(true);
    expect(Array.isArray(ep.symptoms)).toBe(true);
    expect(Array.isArray(ep.tags)).toBe(true);
    expect(isWellFormedEpisode(ep)).toBe(true);
  });

  it('truncates an over-long text into a label and keeps full text as a note', () => {
    const long = 'x'.repeat(120);
    const ep = normalizeEpisode({ id: 'a', text: long, ts: NOW }, { now: NOW });
    expect(ep.label.length).toBeLessThanOrEqual(60);
    expect(ep.label.endsWith('…')).toBe(true);
    expect(ep.notes[0]).toBe(long);
  });

  it('synthesizes id and started_at when both absent', () => {
    const ep = normalizeEpisode({ label: 'flare' }, { now: NOW });
    expect(ep.id).toMatch(/^ep_/);
    expect(ep.started_at).toBe(NOW);
  });

  it('preserves a valid Episode unchanged in shape', () => {
    const valid = openEpisode('grip', 'chronic', { now: NOW });
    const ep = normalizeEpisode(valid, { now: NOW });
    expect(ep.id).toBe(valid.id);
    expect(ep.label).toBe('grip');
    expect(ep.kind).toBe('chronic');
    expect(ep.started_at).toBe(NOW);
  });

  it('recovers started_at from opened_at then ts', () => {
    expect(normalizeEpisode({ opened_at: NOW }, { now: 0 }).started_at).toBe(NOW);
    expect(normalizeEpisode({ ts: NOW }, { now: 0 }).started_at).toBe(NOW);
  });

  it('keeps ended_at only when finite', () => {
    expect(normalizeEpisode({ ts: NOW, ended_at: NOW + DAY }).ended_at).toBe(NOW + DAY);
    expect(normalizeEpisode({ ts: NOW, ended_at: 'bad' }).ended_at).toBeUndefined();
  });

  it('handles non-object garbage without throwing', () => {
    expect(() => normalizeEpisode(null, { now: NOW })).not.toThrow();
    expect(() => normalizeEpisode(42, { now: NOW })).not.toThrow();
    expect(normalizeEpisode(null, { now: NOW }).label).toBe('episode');
  });
});

describe('isWellFormedEpisode', () => {
  it('true for openEpisode output', () => {
    expect(isWellFormedEpisode(openEpisode('x', 'acute', { now: NOW }))).toBe(true);
  });
  it('false for a brain-dump {id,text,ts} stub', () => {
    expect(isWellFormedEpisode({ id: 'a', text: 'migraine', ts: NOW })).toBe(false);
  });
  it('false for null / non-object', () => {
    expect(isWellFormedEpisode(null)).toBe(false);
    expect(isWellFormedEpisode('nope')).toBe(false);
  });
});

// ─── cross-module signals ─────────────────────────────────────────────────────

describe('detectSleepDebtFocusQuality', () => {
  // Build a fixture: 14 days. On even days the night before was short (300m),
  // odd days were rested (450m). Focus sessions complete fully when rested,
  // run ~50% when sleep-debted.
  function makeFixture(now: number) {
    const sleepNights: Array<{ night_of: string; tst_min: number }> = [];
    const focusSessions: Array<{ ts: number; duration_min: number; duration_ms: number }> = [];
    const dKey = (ts: number) => {
      const d = new Date(ts);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    for (let d = 14; d >= 1; d--) {
      const dayTs = now - d * DAY + 13 * HOUR; // 1pm session
      const prevNightTs = dayTs - DAY;
      const short = d % 2 === 0;
      sleepNights.push({ night_of: dKey(prevNightTs), tst_min: short ? 300 : 450 });
      // two focus sessions per day, 45-min planned
      for (let k = 0; k < 2; k++) {
        focusSessions.push({
          ts: dayTs + k * HOUR,
          duration_min: 45,
          duration_ms: short ? 45 * 60_000 * 0.5 : 45 * 60_000,
        });
      }
    }
    return { sleepNights, focusSessions };
  }

  it('surfaces when focus completion drops after short nights', () => {
    const { sleepNights, focusSessions } = makeFixture(NOW);
    const sig = detectSleepDebtFocusQuality({ now: NOW, sleepNights, focusSessions });
    expect(sig).not.toBeNull();
    expect(sig?.id).toBe('sleep_debt_focus_quality');
    expect(sig?.modules).toEqual(['sleep', 'work']);
    expect(sig?.modules.length).toBeGreaterThanOrEqual(2);
  });

  it('returns null with too few sessions per side', () => {
    const sig = detectSleepDebtFocusQuality({
      now: NOW,
      sleepNights: [{ night_of: '2026-05-01', tst_min: 300 }],
      focusSessions: [{ ts: NOW - DAY, duration_min: 45, duration_ms: 1000 }],
    });
    expect(sig).toBeNull();
  });

  it('returns null when there is no gap (focus quality unaffected)', () => {
    const { sleepNights } = makeFixture(NOW);
    // all sessions complete fully regardless of sleep
    const focusSessions: Array<{ ts: number; duration_min: number; duration_ms: number }> = [];
    for (let d = 14; d >= 1; d--) {
      const dayTs = NOW - d * DAY + 13 * HOUR;
      for (let k = 0; k < 2; k++) {
        focusSessions.push({ ts: dayTs + k * HOUR, duration_min: 45, duration_ms: 45 * 60_000 });
      }
    }
    expect(detectSleepDebtFocusQuality({ now: NOW, sleepNights, focusSessions })).toBeNull();
  });
});

describe('detectCyclePhaseEnergy', () => {
  it('surfaces a luteal-phase focus drop vs follicular', () => {
    // follicular: days -20..-11 ; luteal: days -8..-1
    const cyclePhases = [
      { ts: NOW - 21 * DAY, phase: 'follicular' },
      { ts: NOW - 10 * DAY, phase: 'luteal' },
    ];
    const focusSessions: Array<{ ts: number; duration_min: number; duration_ms: number }> = [];
    // follicular: 4h/day across 5 days
    for (let d = 20; d >= 16; d--) {
      focusSessions.push({ ts: NOW - d * DAY + 12 * HOUR, duration_min: 240, duration_ms: 4 * 3600_000 });
    }
    // luteal: 1.5h/day across 5 days
    for (let d = 8; d >= 4; d--) {
      focusSessions.push({ ts: NOW - d * DAY + 12 * HOUR, duration_min: 90, duration_ms: 1.5 * 3600_000 });
    }
    const sig = detectCyclePhaseEnergy({ now: NOW, cyclePhases, focusSessions });
    expect(sig).not.toBeNull();
    expect(sig?.id).toBe('cycle_phase_energy');
    expect(sig?.modules).toEqual(['cycle', 'work']);
  });

  it('returns null with fewer than 3 active days per phase', () => {
    const cyclePhases = [
      { ts: NOW - 21 * DAY, phase: 'follicular' },
      { ts: NOW - 10 * DAY, phase: 'luteal' },
    ];
    const focusSessions = [
      { ts: NOW - 18 * DAY, duration_min: 240, duration_ms: 4 * 3600_000 },
      { ts: NOW - 6 * DAY, duration_min: 90, duration_ms: 1.5 * 3600_000 },
    ];
    expect(detectCyclePhaseEnergy({ now: NOW, cyclePhases, focusSessions })).toBeNull();
  });
});

describe('detectBodySignals', () => {
  it('returns [] when no detector fires', () => {
    expect(detectBodySignals({ now: NOW })).toEqual([]);
  });

  it('every returned signal bridges ≥2 modules', () => {
    const cyclePhases = [
      { ts: NOW - 21 * DAY, phase: 'follicular' },
      { ts: NOW - 10 * DAY, phase: 'luteal' },
    ];
    const focusSessions: Array<{ ts: number; duration_min: number; duration_ms: number }> = [];
    for (let d = 20; d >= 16; d--) {
      focusSessions.push({ ts: NOW - d * DAY + 12 * HOUR, duration_min: 240, duration_ms: 4 * 3600_000 });
    }
    for (let d = 8; d >= 4; d--) {
      focusSessions.push({ ts: NOW - d * DAY + 12 * HOUR, duration_min: 90, duration_ms: 1.5 * 3600_000 });
    }
    const out = detectBodySignals({ now: NOW, cyclePhases, focusSessions });
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) expect(s.modules.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── detectHyperfocusDehydration ──────────────────────────────────────────────

describe('detectHyperfocusDehydration', () => {
  it('returns null when fewer than minSessions focus sessions', () => {
    expect(detectHyperfocusDehydration({ now: NOW, focusSessions: [], waterLog: [] })).toBeNull();
  });

  it('surfaces when in-focus drinking rate is far below out-of-focus rate', () => {
    // 12 short focus sessions inside one continuous 12h observation span.
    // out-of-focus span = 12h - 6h focus = 6h, holding 30 glasses → high rate.
    // in-focus = 12 glasses over 6h → far lower rate.
    const focusSessions = [];
    const waterLog = [];
    const base = NOW - 12 * HOUR;
    for (let i = 0; i < 12; i++) {
      const fStart = base + i * 60 * MIN;       // each focus session 30 min
      focusSessions.push({ start: fStart, end: fStart + 30 * MIN });
      waterLog.push(fStart + 10 * MIN);          // 1 glass per focus session
    }
    // Many glasses crammed into the gaps between sessions (out-of-focus) so
    // the out-of-focus drinking rate dwarfs the in-focus rate.
    for (let i = 0; i < 12; i++) {
      const gapStart = base + i * 60 * MIN + 32 * MIN;
      for (let g = 0; g < 6; g++) waterLog.push(gapStart + g * 4 * MIN);
    }
    const result = detectHyperfocusDehydration(
      { now: NOW, focusSessions, waterLog },
      { minSessions: 10 },
    );
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('hyperfocus_dehydration');
    expect(result?.in_focus_rate).toBeLessThan(result!.out_focus_rate);
  });

  it('returns null when in-focus drinking keeps pace with out-of-focus', () => {
    const focusSessions = [];
    const waterLog = [];
    const base = NOW - 12 * HOUR;
    for (let i = 0; i < 12; i++) {
      const fStart = base + i * 60 * MIN;
      focusSessions.push({ start: fStart, end: fStart + 30 * MIN });
      // even drinking: 3 glasses inside focus, 3 in the gap
      waterLog.push(fStart + 5 * MIN, fStart + 12 * MIN, fStart + 20 * MIN);
      const gapStart = fStart + 35 * MIN;
      for (let g = 0; g < 3; g++) waterLog.push(gapStart + g * 6 * MIN);
    }
    expect(detectHyperfocusDehydration(
      { now: NOW, focusSessions, waterLog },
      { minSessions: 10 },
    )).toBeNull();
  });
});

// ─── detectMultiSymptomRecurrence ─────────────────────────────────────────────

describe('detectMultiSymptomRecurrence', () => {
  it('returns [] for empty history', () => {
    expect(detectMultiSymptomRecurrence({ now: NOW })).toEqual([]);
  });

  it('surfaces a symptom recurring on >= standaloneN distinct days', () => {
    const dumps = [];
    // 8 distinct days; standaloneN lowered to 5 so a no-correlation symptom
    // still surfaces (default standaloneN=10 would suppress it).
    for (let d = 1; d <= 8; d++) {
      dumps.push({ ts: NOW - d * 5 * DAY, rawText: 'back pain again today' });
    }
    const result = detectMultiSymptomRecurrence(
      { now: NOW, dumps }, { minSampleDays: 5, standaloneN: 5 },
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].pattern).toBe('multi_symptom_recurrence');
  });

  it('returns [] when a symptom appears on fewer than minSampleDays', () => {
    const dumps = [
      { ts: NOW - 5 * DAY, rawText: 'back pain' },
      { ts: NOW - 10 * DAY, rawText: 'back pain' },
    ];
    expect(detectMultiSymptomRecurrence(
      { now: NOW, dumps }, { minSampleDays: 5, standaloneN: 5 },
    )).toEqual([]);
  });

  it('returns [] when an uncorrelated symptom stays below standaloneN', () => {
    // 8 days of a symptom with no sleep/water/phase correlation: under the
    // default standaloneN=10 floor → suppressed.
    const dumps = [];
    for (let d = 1; d <= 8; d++) {
      dumps.push({ ts: NOW - d * 5 * DAY, rawText: 'back pain again today' });
    }
    expect(detectMultiSymptomRecurrence({ now: NOW, dumps }, { minSampleDays: 5 })).toEqual([]);
  });

  it('de-dupes multiple mentions on the same day', () => {
    const dumps = [];
    for (let d = 1; d <= 6; d++) {
      const base = NOW - d * 6 * DAY;
      dumps.push({ ts: base + 2 * HOUR, rawText: 'stomach ache' });
      dumps.push({ ts: base + 8 * HOUR, rawText: 'stomach ache again' });
    }
    const result = detectMultiSymptomRecurrence(
      { now: NOW, dumps }, { minSampleDays: 5, standaloneN: 5 },
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].sample_n).toBe(6);
  });
});

// ─── detectCaffeineWaterTradeoff ──────────────────────────────────────────────

describe('detectCaffeineWaterTradeoff', () => {
  it('returns null when fewer than minDays of paired data', () => {
    expect(detectCaffeineWaterTradeoff({ now: NOW, waterLog: [], dumps: [] })).toBeNull();
  });

  it('surfaces a negative caffeine/water correlation', () => {
    // 24 days: high-caffeine days have low water, low-caffeine days have high water
    const waterLog = [];
    const dumps = [];
    for (let d = 1; d <= 24; d++) {
      const base = NOW - d * DAY + 9 * HOUR;
      const highCaf = d % 2 === 0;
      const cafCups = highCaf ? 3 : 1;
      const waterGlasses = highCaf ? 2 : 6;
      for (let c = 0; c < cafCups; c++) dumps.push({ ts: base + c * 30 * MIN, rawText: 'coffee' });
      for (let w = 0; w < waterGlasses; w++) waterLog.push(base + 4 * HOUR + w * 20 * MIN);
    }
    const result = detectCaffeineWaterTradeoff({ now: NOW, waterLog, dumps }, { minDays: 21 });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('caffeine_water_tradeoff');
    expect(result?.rho).toBeLessThanOrEqual(-0.3);
  });

  it('returns null when caffeine and water are uncorrelated/positive', () => {
    const waterLog = [];
    const dumps = [];
    for (let d = 1; d <= 24; d++) {
      const base = NOW - d * DAY + 9 * HOUR;
      dumps.push({ ts: base, rawText: 'coffee' });
      dumps.push({ ts: base + 30 * MIN, rawText: 'coffee' });
      waterLog.push(base + 4 * HOUR, base + 5 * HOUR, base + 6 * HOUR);
    }
    expect(detectCaffeineWaterTradeoff({ now: NOW, waterLog, dumps }, { minDays: 21 })).toBeNull();
  });
});

// ─── detectMealSkipPattern ────────────────────────────────────────────────────

describe('detectMealSkipPattern', () => {
  // Detector uses local getHours() with cutoffHour=14. Build timestamps at
  // explicit local hours so the morning/evening split is timezone-stable.
  const localTs = (daysAgo: number, hour: number): number => {
    const d = new Date(NOW);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };

  it('returns null when meal-timing tracking is disabled', () => {
    const dumps = [];
    for (let d = 1; d <= 14; d++) dumps.push({ ts: localTs(d, 18), rawText: 'random' });
    expect(detectMealSkipPattern({ now: NOW, dumps })).toBeNull();
  });

  it('surfaces when most observed days have no morning food log', () => {
    const dumps = [];
    // 14 observed days; food only ever logged at 20:00 (after cutoff 14:00)
    for (let d = 1; d <= 14; d++) {
      dumps.push({ ts: localTs(d, 20), rawText: 'dinner — akşam yemeği yedim' });
    }
    const result = detectMealSkipPattern(
      { now: NOW, dumps, settings: { tracking_meal_timing: true } },
    );
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('meal_skip');
    expect(result?.skip_days).toBeGreaterThanOrEqual(7);
  });

  it('returns null when morning food is logged most days', () => {
    const dumps = [];
    for (let d = 1; d <= 14; d++) {
      dumps.push({ ts: localTs(d, 8), rawText: 'breakfast — kahvaltı yaptım' });
    }
    expect(detectMealSkipPattern(
      { now: NOW, dumps, settings: { tracking_meal_timing: true } },
    )).toBeNull();
  });

  it('respects opts.tracking_meal_timing as an enable override', () => {
    const dumps = [];
    for (let d = 1; d <= 14; d++) dumps.push({ ts: localTs(d, 20), rawText: 'dinner' });
    const result = detectMealSkipPattern({ now: NOW, dumps }, { tracking_meal_timing: true });
    expect(result).not.toBeNull();
  });
});

// ─── detectGISymptomCyclePhase ────────────────────────────────────────────────

describe('detectGISymptomCyclePhase', () => {
  it('returns null when GI tracking is disabled', () => {
    expect(detectGISymptomCyclePhase({ now: NOW, dumps: [], cyclePhases: [] })).toBeNull();
  });

  it('returns null when there are no cycle phase markers', () => {
    expect(detectGISymptomCyclePhase(
      { now: NOW, dumps: [], cyclePhases: [], settings: { tracking_gi: true } },
    )).toBeNull();
  });

  it('surfaces when GI symptoms concentrate in one phase across enough cycles', () => {
    // 4 menstrual phase markers (cycle starts) + luteal markers between them.
    const cyclePhases: Array<{ ts: number; phase: string }> = [];
    const dumps = [];
    for (let c = 0; c < 4; c++) {
      const cycleStart = NOW - (80 - c * 25) * DAY;
      cyclePhases.push({ ts: cycleStart, phase: 'menstrual' });
      cyclePhases.push({ ts: cycleStart + 14 * DAY, phase: 'luteal' });
      // GI symptom dumps in the luteal window
      dumps.push({ ts: cycleStart + 16 * DAY, rawText: 'mide ağrısı çok kötü' });
      dumps.push({ ts: cycleStart + 18 * DAY, rawText: 'midem bulanıyor' });
    }
    const result = detectGISymptomCyclePhase(
      { now: NOW, dumps, cyclePhases, settings: { tracking_gi: true } },
      { minMentions: 5, minCycles: 3, concThreshold: 0.6 },
    );
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('gi_cycle_phase');
    expect(result?.phase_dominant).toBe('luteal');
  });
});

// ─── detectSymptomPhaseCoupling ───────────────────────────────────────────────

describe('detectSymptomPhaseCoupling', () => {
  it('returns null with empty dumps or phases', () => {
    expect(detectSymptomPhaseCoupling({ now: NOW, dumps: [], cyclePhases: [] })).toBeNull();
  });

  it('surfaces when symptoms cluster in luteal vs other phases', () => {
    // CyclePhaseRange shape: { start, end, name }
    const cyclePhases = [
      { start: NOW - 90 * DAY, end: NOW - 75 * DAY, name: 'other' },
      { start: NOW - 75 * DAY, end: NOW - 65 * DAY, name: 'luteal' },
      { start: NOW - 65 * DAY, end: NOW - 45 * DAY, name: 'other' },
      { start: NOW - 45 * DAY, end: NOW - 35 * DAY, name: 'luteal' },
      { start: NOW - 35 * DAY, end: NOW - 5 * DAY, name: 'other' },
    ];
    const dumps = [];
    // Heavy symptom load on luteal days, almost none on other days
    for (const p of cyclePhases) {
      if (p.name !== 'luteal') continue;
      for (let t = p.start; t < p.end; t += DAY) {
        dumps.push({ ts: t + 10 * HOUR, rawText: 'headache yine' });
      }
    }
    // a couple of non-symptom dumps on other days for observed-day coverage
    const result = detectSymptomPhaseCoupling(
      { now: NOW, dumps, cyclePhases },
      { minLutealDays: 5, minOtherDays: 10, minLift: 1.6 },
    );
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('symptom_phase_coupling');
    expect(result?.luteal_symptom_rate).toBeGreaterThan(result!.other_symptom_rate);
  });
});

// ─── detectSleepDebtSymptomLag ────────────────────────────────────────────────

describe('detectSleepDebtSymptomLag', () => {
  it('returns null with empty dumps or sleep records', () => {
    expect(detectSleepDebtSymptomLag({ now: NOW, dumps: [], sleepRecords: [] })).toBeNull();
  });

  it('surfaces when symptoms spike on days after short-sleep nights', () => {
    const sleepRecords = [];
    const dumps = [];
    // Local-day key, matching the detector's local dayKey().
    const dKey = (daysAgo: number): string => {
      const d = new Date(NOW);
      d.setDate(d.getDate() - daysAgo);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    // A symptom dump anchored to the day AFTER a given night.
    const followDumpTs = (nightDaysAgo: number): number => {
      const d = new Date(NOW);
      d.setDate(d.getDate() - (nightDaysAgo - 1));
      d.setHours(15, 0, 0, 0);
      return d.getTime();
    };
    // 8 short nights (each followed by a symptom day), within the 60d window.
    // Short uses 6-day spacing, baseline uses 4-day spacing offset by 1 →
    // no two records ever land on the same local day.
    for (let i = 0; i < 8; i++) {
      const nightDaysAgo = 4 + i * 6;     // 4,10,16,...,46 days ago
      sleepRecords.push({ night_of: dKey(nightDaysAgo), tst_min: 300 });
      dumps.push({ ts: followDumpTs(nightDaysAgo), rawText: 'headache, brutal day' });
    }
    // 12 baseline (rested) nights, no symptom dumps, still inside the window.
    for (let i = 0; i < 12; i++) {
      sleepRecords.push({ night_of: dKey(5 + i * 4), tst_min: 450 }); // 5,9,...,49
    }
    const result = detectSleepDebtSymptomLag(
      { now: NOW, dumps, sleepRecords },
      { minShortNights: 5, minBaselineNights: 10, minLift: 1.5 },
    );
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('sleep_debt_symptom_lag');
    expect(result?.short_symptom_rate).toBeGreaterThan(result!.baseline_symptom_rate);
  });
});

// ─── episode detectors: trigger / rhythm / mental ─────────────────────────────

describe('detectTriggerCorrelation', () => {
  it('returns null when fewer than minEpisodes episodes', () => {
    const eps = [openEpisode('migren', 'acute', { now: NOW - 5 * DAY })];
    expect(detectTriggerCorrelation(eps, {}, { now: NOW })).toBeNull();
  });

  it('surfaces low_sleep trigger when most episodes follow short-sleep weeks', () => {
    const dKey = (ts: number) => {
      const d = new Date(ts);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    const eps = [];
    const sleepRecords = [];
    for (let i = 0; i < 5; i++) {
      const epStart = NOW - (10 + i * 12) * DAY;
      eps.push(openEpisode('migren', 'acute', { now: epStart }));
      // 7 short nights before each episode
      for (let n = 1; n <= 7; n++) {
        sleepRecords.push({ night_of: dKey(epStart - n * DAY), tst_min: 300 });
      }
    }
    const result = detectTriggerCorrelation(eps, { sleepRecords }, { now: NOW, minEpisodes: 4 });
    expect(result).not.toBeNull();
    expect(result?.trigger).toBe('low_sleep');
    expect(result?.match_rate).toBeGreaterThanOrEqual(0.6);
  });

  it('returns null when no trigger reaches the 60% match rate', () => {
    const eps = [];
    for (let i = 0; i < 5; i++) {
      eps.push(openEpisode('migren', 'acute', { now: NOW - (10 + i * 12) * DAY }));
    }
    // no sleep / dump / phase history → all trigger counts 0
    expect(detectTriggerCorrelation(eps, {}, { now: NOW, minEpisodes: 4 })).toBeNull();
  });
});

describe('detectRecurrenceRhythm', () => {
  it('returns null when fewer than minEpisodes episodes', () => {
    const eps = [
      openEpisode('migren', 'acute', { now: NOW - 30 * DAY }),
      openEpisode('migren', 'acute', { now: NOW - 20 * DAY }),
    ];
    expect(detectRecurrenceRhythm(eps, { now: NOW })).toBeNull();
  });

  it('surfaces a regular rhythm when intervals are low-variance', () => {
    // 5 episodes ~14 days apart → low CV
    const eps = [];
    for (let i = 0; i < 5; i++) {
      eps.push(openEpisode('migren', 'acute', { now: NOW - (70 - i * 14) * DAY }));
    }
    const result = detectRecurrenceRhythm(eps, { now: NOW, minEpisodes: 4 });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('episode_recurrence_rhythm');
    expect(result?.mean_interval_days).toBeCloseTo(14, 0);
  });

  it('returns null when interval variance exceeds jitterTolerance', () => {
    // wildly irregular gaps
    const offsets = [80, 79, 50, 10, 9];
    const eps = offsets.map(o => openEpisode('migren', 'acute', { now: NOW - o * DAY }));
    expect(detectRecurrenceRhythm(eps, { now: NOW, minEpisodes: 4, jitterTolerance: 0.2 })).toBeNull();
  });
});

describe('detectMentalEpisodePattern', () => {
  it('returns [] when there are no mental-kind episodes', () => {
    const eps = [openEpisode('grip', 'acute', { now: NOW - 10 * DAY })];
    expect(detectMentalEpisodePattern(eps, {}, { now: NOW })).toEqual([]);
  });

  it('returns [] for empty / null episodes input', () => {
    expect(detectMentalEpisodePattern([], {}, { now: NOW })).toEqual([]);
  });

  it('emits a rhythm pattern for regularly-recurring mental episodes', () => {
    const eps = [];
    for (let i = 0; i < 5; i++) {
      eps.push(openEpisode('low spell', 'mental_episode', { now: NOW - (70 - i * 14) * DAY }));
    }
    const out = detectMentalEpisodePattern(eps, {}, { now: NOW, minEpisodes: 4 });
    expect(Array.isArray(out)).toBe(true);
    expect(out.some(p => p.pattern === 'mental_episode_rhythm')).toBe(true);
  });
});
