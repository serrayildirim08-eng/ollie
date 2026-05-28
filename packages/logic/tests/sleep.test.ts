import { describe, it, expect } from 'vitest';
import {
  parseTimeOfDay,
  bedtimeRelativeMinutes,
  minutesInBed,
  formatTime,
  isoDate,
  parseSleepDump,
  mergeRecord,
  sleepEfficiency,
  resolveTarget,
  deriveSleepStats,
  computeSleepDebt,
  detectSleepOnsetGap,
  detectWeekendRecoveryIllusion,
  detectCyclePhaseSleepCoupling,
  detectStimulantSleepDebt,
  detectBedtimeDrift,
  detectDSPSPattern,
  detectShortSleepRun,
  detectRevengeBedtime,
  detectCaffeineCutoff,
  detectBedtimeMindRacing,
  detectWindDownFriction,
  detectMedicationTimingDrift,
  detectChronotherapyProgress,
  detectSleepCyclePattern,
  detectSleepFocusPattern,
  detectSleepDumpMoodPattern,
  forecastTonightHeuristic,
  scoreInsomniaSurvey,
  insomniaSeverityBand,
  INSOMNIA_SURVEY_QUESTIONS,
  INSOMNIA_SURVEY_LENGTH,
  type SleepRecord,
} from '../src/sleep';

// ─── helpers ─────────────────────────────────────────────────────────

describe('parseTimeOfDay', () => {
  it('parses HH:MM format', () => {
    expect(parseTimeOfDay('22:30')).toBe(22 * 60 + 30);
  });
  it('parses 12-hour am', () => {
    expect(parseTimeOfDay('2am')).toBe(2 * 60);
  });
  it('parses 12-hour pm', () => {
    expect(parseTimeOfDay('10pm')).toBe(22 * 60);
  });
  it('handles midnight 12am', () => {
    expect(parseTimeOfDay('12am')).toBe(0);
  });
  it('returns null for invalid', () => {
    expect(parseTimeOfDay('notadate')).toBeNull();
    expect(parseTimeOfDay(null)).toBeNull();
  });
});

describe('bedtimeRelativeMinutes', () => {
  it('afternoon stays positive', () => {
    expect(bedtimeRelativeMinutes(23 * 60)).toBe(23 * 60 - 1440);
  });
  it('morning wraps to negative', () => {
    expect(bedtimeRelativeMinutes(1 * 60)).toBe(60);
  });
  it('null passthrough', () => {
    expect(bedtimeRelativeMinutes(null)).toBeNull();
  });
});

describe('minutesInBed', () => {
  it('same-day span', () => {
    expect(minutesInBed(22 * 60, 23 * 60 + 30)).toBe(90);
  });
  it('crosses midnight', () => {
    // bedtime 23:00, wake 07:00 = 8h
    expect(minutesInBed(23 * 60, 7 * 60)).toBe(8 * 60);
  });
  it('null inputs', () => {
    expect(minutesInBed(null, 420)).toBeNull();
  });
});

describe('formatTime', () => {
  it('zero-pads hours and minutes', () => {
    expect(formatTime(2 * 60 + 5)).toBe('02:05');
    expect(formatTime(23 * 60 + 59)).toBe('23:59');
  });
});

describe('isoDate', () => {
  it('formats a known epoch', () => {
    // 2000-01-01 UTC noon
    const ts = new Date('2000-01-01T12:00:00').getTime();
    expect(isoDate(ts)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── parse / merge ───────────────────────────────────────────────────

describe('parseSleepDump', () => {
  const NOW = new Date('2026-05-01T08:00:00').getTime();

  it('returns null record for non-sleep text', () => {
    const r = parseSleepDump('went to the gym today', NOW);
    expect(r.record).toBeNull();
  });

  it('extracts bedtime and wake from text', () => {
    const r = parseSleepDump('in bed at 11pm, woke up at 7am', NOW);
    expect(r.record).not.toBeNull();
    expect(r.record!.bedtime).toBe('23:00');
    expect(r.record!.wake_time).toBe('07:00');
  });

  it('extracts onset latency', () => {
    const r = parseSleepDump("couldn't sleep for 45 minutes last night", NOW);
    expect(r.record!.onset_latency_min).toBe(45);
  });

  it('extracts quality tokens', () => {
    const r = parseSleepDump('sleep was terrible last night, bed at 12am', NOW);
    expect(r.record!.quality).toBe(1);
  });

  it('marks is_skipped correctly', () => {
    const r = parseSleepDump("didn't sleep at all", NOW);
    expect(r.record!.is_skipped).toBe(true);
  });
});

describe('mergeRecord', () => {
  const NOW = 1_700_000_000_000;

  it('creates a new record when prev is null', () => {
    const r = mergeRecord(null, { night_of: '2026-01-01', bedtime: '23:00', wake_time: '07:00' }, NOW);
    expect(r.night_of).toBe('2026-01-01');
    expect(r.time_in_bed_min).toBe(8 * 60);
    expect(r.tst_min).toBe(8 * 60);
  });

  it('computes efficiency', () => {
    const r = mergeRecord(null, {
      night_of: '2026-01-01',
      bedtime: '23:00',
      wake_time: '07:00',
      onset_latency_min: 30,
    }, NOW);
    expect(r.efficiency).toBeCloseTo((8 * 60 - 30) / (8 * 60), 3);
  });

  it('merges tokens without duplicates', () => {
    const prev = mergeRecord(null, { night_of: '2026-01-01', tokens: ['caffeine:coffee'] }, NOW);
    const next = mergeRecord(prev, { tokens: ['caffeine:coffee', 'screens:phone'] }, NOW);
    expect(next.tokens).toHaveLength(2);
  });
});

describe('sleepEfficiency', () => {
  it('returns null for insufficient data', () => {
    expect(sleepEfficiency(null)).toBeNull();
    expect(sleepEfficiency({ time_in_bed_min: 30 } as SleepRecord)).toBeNull();
  });

  it('computes ratio correctly', () => {
    const r = { time_in_bed_min: 480, tst_min: 420 } as SleepRecord;
    expect(sleepEfficiency(r)).toBeCloseTo(420 / 480, 4);
  });
});

describe('resolveTarget', () => {
  it('returns 7.5 default', () => {
    expect(resolveTarget(null)).toBe(7.5);
  });
  it('clamps to [4, 12]', () => {
    expect(resolveTarget({ target_hours: 2 })).toBe(4);
    expect(resolveTarget({ target_hours: 15 })).toBe(12);
    expect(resolveTarget({ target_hours: 8 })).toBe(8);
  });
});

// ─── stats ───────────────────────────────────────────────────────────

function makeRecord(nightOf: string, tstMin: number, bedtime = '23:00', wakeTime?: string): SleepRecord {
  const wt = wakeTime ?? formatTime((23 * 60 + tstMin) % 1440);
  return {
    night_of: nightOf,
    bedtime,
    wake_time: wt,
    tst_min: tstMin,
    time_in_bed_min: tstMin + 10,
    efficiency: tstMin / (tstMin + 10),
    onset_latency_min: 10,
    wakings_count: 0,
    wakings_total_min: 0,
    quality: 4,
    quality_text: 'good',
    notes: null,
    tokens: [],
    is_skipped: false,
    is_partial: false,
    is_disputed: false,
  };
}

describe('deriveSleepStats', () => {
  it('returns null for fewer than 5 records', () => {
    const recs = [1, 2, 3, 4].map((i) => makeRecord(`2026-01-0${i}`, 420));
    expect(deriveSleepStats(recs)).toBeNull();
  });

  it('computes mean and sd', () => {
    const recs = Array.from({ length: 10 }, (_, i) =>
      makeRecord(`2026-01-${String(i + 1).padStart(2, '0')}`, 420),
    );
    const s = deriveSleepStats(recs)!;
    expect(s.nights_counted).toBe(10);
    expect(s.tst_mean_min).toBe(420);
    expect(s.tst_sd_min).toBe(0);
  });
});

describe('computeSleepDebt', () => {
  it('returns 0 debt for 8h nights against 7.5h target', () => {
    const recs = Array.from({ length: 5 }, (_, i) =>
      makeRecord(`2026-01-0${i + 1}`, 8 * 60),
    );
    const d = computeSleepDebt(recs, 7.5);
    expect(d.totalDeficitHours).toBe(0);
  });

  it('accumulates deficit correctly', () => {
    // 5 nights at 6h vs 8h target = 2h deficit each = 10h total
    const recs = Array.from({ length: 5 }, (_, i) =>
      makeRecord(`2026-01-0${i + 1}`, 6 * 60),
    );
    const d = computeSleepDebt(recs, 8);
    expect(d.totalDeficitHours).toBeCloseTo(10, 1);
  });
});

// ─── pattern detectors ───────────────────────────────────────────────

describe('detectSleepOnsetGap', () => {
  it('fires when median onset >= 30 and low-efficiency nights >= 5', () => {
    const now = Date.now();
    const recs: SleepRecord[] = Array.from({ length: 14 }, (_, i) => ({
      ...makeRecord(`2026-01-${String(i + 1).padStart(2, '0')}`, 360),
      time_in_bed_min: 480,
      tst_min: 360,
      onset_latency_min: 45,
      efficiency: 360 / 480,
    }));
    const result = detectSleepOnsetGap({ now, sleepRecords: recs });
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe('sleep_onset_gap');
  });

  it('returns null with too few records', () => {
    const now = Date.now();
    const recs = Array.from({ length: 5 }, (_, i) =>
      makeRecord(`2026-01-0${i + 1}`, 300),
    );
    expect(detectSleepOnsetGap({ now, sleepRecords: recs })).toBeNull();
  });
});

describe('detectWeekendRecoveryIllusion', () => {
  it('fires when weekday sleep short and weekend sleep 90+ min more', () => {
    const now = Date.now();
    // Build 28 records: weekdays ~5h, weekends ~7.5h
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const recs: SleepRecord[] = [];
    const base = new Date('2026-01-05'); // Monday
    for (let i = 0; i < 28; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const day = dayNames[d.getDay()];
      const tst = ['fri', 'sat'].includes(day) ? 450 : 300; // 7.5h vs 5h
      recs.push(makeRecord(iso, tst));
    }
    const result = detectWeekendRecoveryIllusion({ now, sleepRecords: recs });
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe('weekend_recovery_illusion');
  });
});

describe('detectCyclePhaseSleepCoupling', () => {
  it('fires when luteal onset significantly higher than other phases', () => {
    const now = Date.now();
    const baseMs = new Date('2026-01-01').getTime();
    // 20 luteal nights with onset=45, 20 other nights with onset=10
    const lutealPhase: Array<{ start: number; end: number; name: string }> = [{
      start: baseMs,
      end: baseMs + 20 * 86400000,
      name: 'luteal',
    }];
    const otherPhase = [{
      start: baseMs + 20 * 86400000,
      end: baseMs + 40 * 86400000,
      name: 'follicular',
    }];
    const phases = [...lutealPhase, ...otherPhase];

    const recs: SleepRecord[] = [];
    for (let i = 0; i < 20; i++) {
      const d = new Date(baseMs + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      recs.push({ ...makeRecord(iso, 420), onset_latency_min: 45 });
    }
    for (let i = 20; i < 40; i++) {
      const d = new Date(baseMs + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      recs.push({ ...makeRecord(iso, 420), onset_latency_min: 10 });
    }

    const result = detectCyclePhaseSleepCoupling({
      now,
      sleepRecords: recs,
      cyclePhases: phases,
      opted_in: true,
    });
    expect(result).not.toBeNull();
    expect(result!.delta_min).toBeGreaterThan(8);
  });
});

describe('detectStimulantSleepDebt', () => {
  it('fires when stim-day onset significantly higher than baseline', () => {
    const now = new Date('2026-02-28').getTime();
    const baseMs = new Date('2026-01-01').getTime();
    const recs: SleepRecord[] = [];
    const dumps: Array<{ ts: number; text: string }> = [];

    for (let i = 0; i < 30; i++) {
      const dayMs = baseMs + i * 86400000;
      const iso = new Date(dayMs).toISOString().slice(0, 10);
      const isStimDay = i < 10;
      recs.push({ ...makeRecord(iso, 420), onset_latency_min: isStimDay ? 60 : 15 });
      if (isStimDay) {
        dumps.push({ ts: dayMs + 8 * 3600000, text: 'took vyvanse this morning' });
      }
    }

    const result = detectStimulantSleepDebt({
      now,
      sleepRecords: recs,
      dumps,
      opted_in: true,
    });
    expect(result).not.toBeNull();
    expect(result!.delta_min).toBeGreaterThanOrEqual(10);
  });
});

// ─── forecastTonightHeuristic ────────────────────────────────────────

describe('forecastTonightHeuristic', () => {
  const NOW = new Date('2026-05-15T20:00:00').getTime();

  it('returns null with fewer than 3 usable nights', () => {
    const recs = [
      makeRecord('2026-05-13', 420),
      makeRecord('2026-05-14', 420),
    ];
    expect(forecastTonightHeuristic(recs, NOW)).toBeNull();
  });

  it('returns null for non-array input', () => {
    // @ts-expect-error — exercising the runtime guard
    expect(forecastTonightHeuristic(null, NOW)).toBeNull();
  });

  it('forecasts the mean for a stable history', () => {
    const recs = Array.from({ length: 10 }, (_, i) =>
      makeRecord(`2026-05-${String(i + 1).padStart(2, '0')}`, 420),
    );
    const f = forecastTonightHeuristic(recs, NOW)!;
    expect(f).not.toBeNull();
    expect(f.mean_h).toBeCloseTo(7, 1);
    expect(f.nights_counted).toBe(10);
    expect(f.method).toBe('recency_weighted_dow');
    // CI brackets the mean and stays inside the [3h,11h] clamp.
    expect(f.ci95_h[0]).toBeLessThanOrEqual(f.mean_h);
    expect(f.ci95_h[1]).toBeGreaterThanOrEqual(f.mean_h);
    expect(f.ci95_h[0]).toBeGreaterThanOrEqual(3);
    expect(f.ci95_h[1]).toBeLessThanOrEqual(11);
  });

  it('weights recent nights more heavily than old ones', () => {
    // first 10 nights at 5h, last 10 at 8h → recency-weighted > simple mean (6.5h).
    const recs: SleepRecord[] = [];
    for (let i = 0; i < 20; i++) {
      const iso = `2026-04-${String(i + 1).padStart(2, '0')}`;
      recs.push(makeRecord(iso, i < 10 ? 300 : 480));
    }
    const f = forecastTonightHeuristic(recs, NOW)!;
    expect(f.mean_h).toBeGreaterThan(6.5);
  });

  it('skips skipped nights and zero-TST rows', () => {
    const recs = [
      makeRecord('2026-05-10', 420),
      { ...makeRecord('2026-05-11', 0), is_skipped: true },
      makeRecord('2026-05-12', 420),
      makeRecord('2026-05-13', 420),
    ];
    const f = forecastTonightHeuristic(recs, NOW)!;
    expect(f.nights_counted).toBe(3);
  });

  it('day-of-week adjustment pulls toward the matching weekday subgroup', () => {
    // 2026-05-15 is a Friday. Build a history where Fridays are short (4h)
    // and every other day is long (8h). Forecasting for a Friday should land
    // below the un-adjusted recency mean.
    const recs: SleepRecord[] = [];
    const base = new Date('2026-04-03'); // a Friday
    for (let i = 0; i < 21; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const isFriday = d.getDay() === 5;
      recs.push(makeRecord(iso, isFriday ? 240 : 480));
    }
    const withDow = forecastTonightHeuristic(recs, NOW, 5)!;     // Friday
    const withoutDow = forecastTonightHeuristic(recs, NOW)!;     // no dow
    expect(withDow.mean_h).toBeLessThan(withoutDow.mean_h);
  });

  it('reports tier by sample size', () => {
    const short = Array.from({ length: 4 }, (_, i) =>
      makeRecord(`2026-05-1${i}`, 420),
    );
    expect(forecastTonightHeuristic(short, NOW)!.tier).toBe('low');
    const long = Array.from({ length: 16 }, (_, i) =>
      makeRecord(`2026-04-${String(i + 1).padStart(2, '0')}`, 420),
    );
    expect(forecastTonightHeuristic(long, NOW)!.tier).toBe('high');
  });
});

// ─── insomnia severity survey ────────────────────────────────────────

describe('insomniaSeverityBand', () => {
  it('maps scores to the standard ISI bands', () => {
    expect(insomniaSeverityBand(0)).toBe('none');
    expect(insomniaSeverityBand(7)).toBe('none');
    expect(insomniaSeverityBand(8)).toBe('subthreshold');
    expect(insomniaSeverityBand(14)).toBe('subthreshold');
    expect(insomniaSeverityBand(15)).toBe('moderate');
    expect(insomniaSeverityBand(21)).toBe('moderate');
    expect(insomniaSeverityBand(22)).toBe('severe');
    expect(insomniaSeverityBand(28)).toBe('severe');
  });
});

describe('scoreInsomniaSurvey', () => {
  const NOW = 1_700_000_000_000;

  it('exposes exactly 7 questions, each with 5 options', () => {
    expect(INSOMNIA_SURVEY_LENGTH).toBe(7);
    expect(INSOMNIA_SURVEY_QUESTIONS).toHaveLength(7);
    for (const q of INSOMNIA_SURVEY_QUESTIONS) {
      expect(q.options).toHaveLength(5);
      expect(typeof q.id).toBe('string');
    }
  });

  it('sums a complete answer set and bands it', () => {
    const r = scoreInsomniaSurvey([3, 3, 3, 3, 3, 3, 3], NOW)!;
    expect(r.score).toBe(21);
    expect(r.band).toBe('moderate');
    expect(r.answered).toBe(7);
    expect(r.scored_at).toBe(NOW);
  });

  it('scores an all-zero survey as none', () => {
    const r = scoreInsomniaSurvey([0, 0, 0, 0, 0, 0, 0], NOW)!;
    expect(r.score).toBe(0);
    expect(r.band).toBe('none');
  });

  it('scores a maxed survey as severe', () => {
    const r = scoreInsomniaSurvey([4, 4, 4, 4, 4, 4, 4], NOW)!;
    expect(r.score).toBe(28);
    expect(r.band).toBe('severe');
  });

  it('returns null for the wrong answer count', () => {
    expect(scoreInsomniaSurvey([1, 2, 3], NOW)).toBeNull();
    expect(scoreInsomniaSurvey([0, 0, 0, 0, 0, 0, 0, 0], NOW)).toBeNull();
  });

  it('returns null for out-of-range or non-integer answers', () => {
    expect(scoreInsomniaSurvey([0, 0, 0, 0, 0, 0, 5], NOW)).toBeNull();
    expect(scoreInsomniaSurvey([0, 0, 0, 0, 0, 0, -1], NOW)).toBeNull();
    expect(scoreInsomniaSurvey([0, 0, 0, 0, 0, 0, 2.5], NOW)).toBeNull();
  });

  it('returns null for non-array / nullish input', () => {
    expect(scoreInsomniaSurvey(null, NOW)).toBeNull();
    expect(scoreInsomniaSurvey(undefined, NOW)).toBeNull();
  });
});

// ─── previously-untested detectors ───────────────────────────────────

/** Build a YYYY-MM-DD key `n` consecutive days after 2026-01-01. */
function nightKey(dayIndex: number): string {
  const d = new Date(Date.UTC(2026, 0, 1));
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d.toISOString().slice(0, 10);
}

// ─── detectBedtimeDrift ───────────────────────────────────────────────

describe('detectBedtimeDrift', () => {
  it('returns null for empty / too few records', () => {
    expect(detectBedtimeDrift([])).toBeNull();
    const recs = Array.from({ length: 4 }, (_, i) => makeRecord(nightKey(i), 420, '23:00'));
    expect(detectBedtimeDrift(recs)).toBeNull();
  });

  it('surfaces a steady "later" drift when bedtime climbs each night', () => {
    // 14 nights, bedtime walks from 22:00 → ~23:30 (clean linear trend)
    const recs = Array.from({ length: 14 }, (_, i) => {
      const min = 22 * 60 + i * 7;
      const hh = String(Math.floor(min / 60)).padStart(2, '0');
      const mm = String(min % 60).padStart(2, '0');
      return makeRecord(nightKey(i), 420, `${hh}:${mm}`);
    });
    const result = detectBedtimeDrift(recs);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe('later');
    expect(result?.slope).toBeGreaterThan(0);
    expect(result?.r2).toBeGreaterThanOrEqual(0.3);
  });

  it('returns null when bedtime is flat (no linear trend / low r2)', () => {
    const recs = Array.from({ length: 14 }, (_, i) => makeRecord(nightKey(i), 420, '23:00'));
    expect(detectBedtimeDrift(recs)).toBeNull();
  });
});

// ─── detectDSPSPattern ────────────────────────────────────────────────

describe('detectDSPSPattern', () => {
  it('returns null with fewer than 14 usable records', () => {
    const recs = Array.from({ length: 10 }, (_, i) => makeRecord(nightKey(i), 480, '03:00', '11:00'));
    expect(detectDSPSPattern(recs)).toBeNull();
  });

  it('surfaces when most nights have a very late bedtime and late wake', () => {
    // 16 nights: bedtime 03:00 (after midnight → < 360 min), wake 11:00 (>= 600)
    const recs = Array.from({ length: 16 }, (_, i) => makeRecord(nightKey(i), 480, '03:00', '11:00'));
    const result = detectDSPSPattern(recs);
    expect(result).not.toBeNull();
    expect(result?.lateBedtimeFraction).toBeGreaterThanOrEqual(0.5);
  });

  it('returns null when wake time is early (no phase delay)', () => {
    // late bedtime but wake 07:00 (< 600 min) → not DSPS
    const recs = Array.from({ length: 16 }, (_, i) => makeRecord(nightKey(i), 240, '03:00', '07:00'));
    expect(detectDSPSPattern(recs)).toBeNull();
  });
});

// ─── detectShortSleepRun ──────────────────────────────────────────────

describe('detectShortSleepRun', () => {
  it('returns null for empty input', () => {
    expect(detectShortSleepRun([])).toBeNull();
  });

  it('surfaces the longest run of consecutive sub-threshold nights', () => {
    // 6 nights at 4h (< 5h threshold) → run of 6
    const recs = Array.from({ length: 6 }, (_, i) => makeRecord(nightKey(i), 4 * 60));
    const result = detectShortSleepRun(recs, 5, 5);
    expect(result).not.toBeNull();
    expect(result?.runNights).toBe(6);
  });

  it('threshold: a 4-night run is below minRun=5 → null', () => {
    const recs = Array.from({ length: 4 }, (_, i) => makeRecord(nightKey(i), 4 * 60));
    expect(detectShortSleepRun(recs, 5, 5)).toBeNull();
  });

  it('a normal night resets the run counter', () => {
    // 3 short, 1 normal, 3 short → longest run is 3, below minRun=5
    const tst = [240, 240, 240, 480, 240, 240, 240];
    const recs = tst.map((m, i) => makeRecord(nightKey(i), m));
    expect(detectShortSleepRun(recs, 5, 5)).toBeNull();
  });
});

// ─── detectRevengeBedtime ─────────────────────────────────────────────

describe('detectRevengeBedtime', () => {
  it('returns null for malformed history (missing logs)', () => {
    expect(detectRevengeBedtime({
      now: Date.now(), sleepRecords: [], actionLog: [], targetBedtime: '23:00',
    })).toBeNull();
    // @ts-expect-error intentional missing now
    expect(detectRevengeBedtime({ sleepRecords: [], actionLog: [], targetBedtime: '23:00' })).toBeNull();
  });

  it('surfaces sustained post-target activity across the window', () => {
    const W = 14;
    const recs: SleepRecord[] = [];
    const actionLog: Array<{ ts: number }> = [];
    // For each night: target 23:00, actual bedtime 00:30, with phone events
    // every 4 min from 23:05 → 00:25 (sustained activity ~30 min+).
    for (let i = 0; i < W; i++) {
      const night = nightKey(i);
      recs.push(makeRecord(night, 360, '00:30'));
      const dayStart = new Date(night + 'T00:00:00').getTime();
      const targetTs = dayStart + 23 * 60 * 60000;
      for (let t = 5; t <= 80; t += 4) actionLog.push({ ts: targetTs + t * 60000 });
    }
    const now = new Date(nightKey(W) + 'T12:00:00').getTime();
    const result = detectRevengeBedtime({ now, sleepRecords: recs, actionLog, targetBedtime: '23:00' });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('revenge_bedtime');
    expect(result?.median_delay_min).toBeGreaterThanOrEqual(30);
  });

  it('returns null when there is no post-target activity', () => {
    const W = 14;
    const recs = Array.from({ length: W }, (_, i) => makeRecord(nightKey(i), 420, '23:05'));
    const now = new Date(nightKey(W) + 'T12:00:00').getTime();
    expect(detectRevengeBedtime({
      now, sleepRecords: recs, actionLog: [], targetBedtime: '23:00',
    })).toBeNull();
  });
});

// ─── detectCaffeineCutoff ─────────────────────────────────────────────

describe('detectCaffeineCutoff', () => {
  it('returns null for malformed history', () => {
    // @ts-expect-error intentional missing now
    expect(detectCaffeineCutoff({ dumps: [], sleepRecords: [] })).toBeNull();
  });

  it('surfaces when caffeine repeatedly lands within the cutoff gap', () => {
    const recs: SleepRecord[] = [];
    const dumps: Array<{ ts: number; text: string }> = [];
    // 16 nights: bedtime 23:00, coffee logged at 20:00 same evening → 3h gap
    for (let i = 0; i < 16; i++) {
      const night = nightKey(i);
      recs.push(makeRecord(night, 420, '23:00'));
      const dayStart = new Date(night + 'T00:00:00').getTime();
      dumps.push({ ts: dayStart + 20 * 60 * 60000, text: 'late coffee again' });
    }
    const now = new Date(nightKey(17) + 'T12:00:00').getTime();
    const result = detectCaffeineCutoff({ now, sleepRecords: recs, dumps });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('caffeine_cutoff');
    expect(result?.median_gap_hours).toBeLessThan(6);
  });

  it('returns null when caffeine is always well before the cutoff', () => {
    const recs: SleepRecord[] = [];
    const dumps: Array<{ ts: number; text: string }> = [];
    // coffee at 08:00, bedtime 23:00 → 15h gap, no violation
    for (let i = 0; i < 16; i++) {
      const night = nightKey(i);
      recs.push(makeRecord(night, 420, '23:00'));
      const dayStart = new Date(night + 'T00:00:00').getTime();
      dumps.push({ ts: dayStart + 8 * 60 * 60000, text: 'morning coffee' });
    }
    const now = new Date(nightKey(17) + 'T12:00:00').getTime();
    expect(detectCaffeineCutoff({ now, sleepRecords: recs, dumps })).toBeNull();
  });
});

// ─── detectBedtimeMindRacing ──────────────────────────────────────────

describe('detectBedtimeMindRacing', () => {
  it('returns null for malformed history', () => {
    // @ts-expect-error intentional missing dumps
    expect(detectBedtimeMindRacing({ now: Date.now(), sleepRecords: [] })).toBeNull();
  });

  it('surfaces when ruminative dumps cluster around bedtime', () => {
    const recs: SleepRecord[] = [];
    const dumps: Array<{ ts: number; text: string }> = [];
    for (let i = 0; i < 14; i++) {
      const night = nightKey(i);
      recs.push(makeRecord(night, 420, '23:00'));
      // bedtime epoch: night 23:00
      const dayStart = new Date(night + 'T00:00:00').getTime();
      const bedtimeMs = dayStart + 23 * 60 * 60000;
      dumps.push({ ts: bedtimeMs - 20 * 60000, text: 'kafamda dön. susmuyo. kapanmıyor.' });
    }
    const now = new Date(nightKey(15) + 'T12:00:00').getTime();
    const result = detectBedtimeMindRacing({ now, sleepRecords: recs, dumps });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('bedtime_mind_racing');
  });

  it('returns null when bedtime dumps are calm / non-ruminative', () => {
    const recs: SleepRecord[] = [];
    const dumps: Array<{ ts: number; text: string }> = [];
    for (let i = 0; i < 14; i++) {
      const night = nightKey(i);
      recs.push(makeRecord(night, 420, '23:00'));
      const dayStart = new Date(night + 'T00:00:00').getTime();
      const bedtimeMs = dayStart + 23 * 60 * 60000;
      dumps.push({ ts: bedtimeMs - 20 * 60000, text: 'good day. tired. goodnight.' });
    }
    const now = new Date(nightKey(15) + 'T12:00:00').getTime();
    expect(detectBedtimeMindRacing({ now, sleepRecords: recs, dumps })).toBeNull();
  });
});

// ─── detectWindDownFriction ───────────────────────────────────────────

describe('detectWindDownFriction', () => {
  it('returns null when opted_in is not true', () => {
    const r = detectWindDownFriction({
      // @ts-expect-error opted_in must be true for this detector
      opted_in: false, now: Date.now(), sleepRecords: [], windDownLog: [], targetBedtime: '23:00',
    });
    expect(r).toBeNull();
  });

  it('surfaces the stuck step when wind-down routinely overshoots', () => {
    const recs: SleepRecord[] = [];
    const windDownLog: Array<{ ts: number; step_id: string; step_label: string; action: 'checked' }> = [];
    // 14 nights: target 22:00, actual bedtime 23:30; one 'shower' step
    // checked at 22:10 every night → ~80 min total wind-down.
    for (let i = 0; i < 14; i++) {
      const night = nightKey(i);
      recs.push(makeRecord(night, 420, '23:30'));
      const dayStart = new Date(night + 'T00:00:00').getTime();
      windDownLog.push({
        ts: dayStart + 22 * 60 * 60000 + 10 * 60000,
        step_id: 'shower', step_label: 'shower', action: 'checked',
      });
    }
    const now = new Date(nightKey(15) + 'T12:00:00').getTime();
    const result = detectWindDownFriction({
      opted_in: true, now, sleepRecords: recs, windDownLog, targetBedtime: '22:00',
    });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('wind_down_friction');
    expect(result?.stuck_step_id).toBe('shower');
  });
});

// ─── detectMedicationTimingDrift ──────────────────────────────────────

describe('detectMedicationTimingDrift', () => {
  it('returns null when opted_in is not true', () => {
    const r = detectMedicationTimingDrift({
      // @ts-expect-error opted_in must be true
      opted_in: false, now: Date.now(), sleepRecords: [], medsLog: [],
    });
    expect(r).toBeNull();
  });

  it('surfaces a widening med-to-bedtime gap over three weeks', () => {
    const recs: SleepRecord[] = [];
    const medsLog: Array<{ ts: number }> = [];
    // 20 nights. Meds taken at a fixed morning time; bedtime walks LATER
    // each night so the meds→bedtime gap widens.
    for (let i = 0; i < 20; i++) {
      const night = nightKey(i);
      const btMin = 22 * 60 + i * 12;          // 22:00 → drifting later
      const hh = String(Math.floor(btMin / 60) % 24).padStart(2, '0');
      const mm = String(btMin % 60).padStart(2, '0');
      recs.push(makeRecord(night, 360, `${hh}:${mm}`));
      const dayStart = new Date(night + 'T00:00:00').getTime();
      medsLog.push({ ts: dayStart + 8 * 60 * 60000 });
    }
    const now = new Date(nightKey(21) + 'T12:00:00').getTime();
    const result = detectMedicationTimingDrift({
      opted_in: true, now, sleepRecords: recs, medsLog,
    });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('medication_timing_drift');
    expect(result?.direction).toBe('widening');
  });

  it('returns null when too few paired nights', () => {
    const recs = Array.from({ length: 5 }, (_, i) => makeRecord(nightKey(i), 420, '23:00'));
    const medsLog = recs.map((_, i) => ({
      ts: new Date(nightKey(i) + 'T00:00:00').getTime() + 8 * 60 * 60000,
    }));
    const now = new Date(nightKey(7) + 'T12:00:00').getTime();
    expect(detectMedicationTimingDrift({
      opted_in: true, now, sleepRecords: recs, medsLog,
    })).toBeNull();
  });
});

// ─── detectChronotherapyProgress ──────────────────────────────────────

describe('detectChronotherapyProgress', () => {
  it('returns null when opted_in is not true', () => {
    const r = detectChronotherapyProgress({
      // @ts-expect-error opted_in must be true
      opted_in: false, now: Date.now(), sleepRecords: [],
      chronotherapy: { active: true, target_bedtime: '22:00' },
    });
    expect(r).toBeNull();
  });

  it('returns null when chronotherapy is inactive', () => {
    const recs = Array.from({ length: 16 }, (_, i) => makeRecord(nightKey(i), 420, '23:00'));
    expect(detectChronotherapyProgress({
      opted_in: true, now: Date.now(), sleepRecords: recs,
      chronotherapy: { active: false, target_bedtime: '22:00' },
    })).toBeNull();
  });

  it('reports a "forward" shift when bedtime moves earlier toward target', () => {
    // 16 nights: first 7 around 00:30, last 7 around 23:00 → moved earlier.
    const recs: SleepRecord[] = [];
    for (let i = 0; i < 16; i++) {
      const btMin = i < 8 ? 30 : 23 * 60;     // 00:30 early nights, 23:00 later
      const hh = String(Math.floor(btMin / 60)).padStart(2, '0');
      const mm = String(btMin % 60).padStart(2, '0');
      recs.push(makeRecord(nightKey(i), 420, `${hh}:${mm}`));
    }
    const result = detectChronotherapyProgress({
      opted_in: true, now: Date.now(), sleepRecords: recs,
      chronotherapy: { active: true, target_bedtime: '22:00' },
    });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('chronotherapy_progress');
    expect(result?.direction).toBe('forward');
  });
});

// ─── detectSleepCyclePattern ──────────────────────────────────────────

describe('detectSleepCyclePattern', () => {
  it('returns null when opted_in is not true', () => {
    const r = detectSleepCyclePattern({
      // @ts-expect-error opted_in must be true
      opted_in: false, now: Date.now(), sleepRecords: [], cycles: [],
    });
    expect(r).toBeNull();
  });

  it('surfaces a luteal-vs-follicular bedtime shift', () => {
    // One 28-day cycle starting 2026-01-01, ovulation day 14.
    // Days 1-14 follicular (bedtime 22:30), days 15-28 luteal (bedtime 00:00).
    const cycles = [{ start_date: nightKey(0), length_days: 28, ovulation_day: 14 }];
    const recs: SleepRecord[] = [];
    for (let i = 0; i < 28; i++) {
      const isLuteal = i >= 14;
      recs.push(makeRecord(nightKey(i), 420, isLuteal ? '00:00' : '22:30'));
    }
    const result = detectSleepCyclePattern({
      opted_in: true, now: Date.now(), sleepRecords: recs, cycles,
    }, { window_cycles: 1 });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('sleep_cycle_phase_shift');
    expect(result?.shift_minutes).toBeGreaterThanOrEqual(30);
  });

  it('returns null when fewer than minCycles cycles are present', () => {
    const cycles = [{ start_date: nightKey(0), length_days: 28, ovulation_day: 14 }];
    const recs = Array.from({ length: 28 }, (_, i) => makeRecord(nightKey(i), 420, '23:00'));
    expect(detectSleepCyclePattern({
      opted_in: true, now: Date.now(), sleepRecords: recs, cycles,
    })).toBeNull();
  });
});

// ─── detectSleepFocusPattern ──────────────────────────────────────────

describe('detectSleepFocusPattern', () => {
  it('returns null when opted_in is not true', () => {
    const r = detectSleepFocusPattern({
      // @ts-expect-error opted_in must be true
      opted_in: false, now: Date.now(), sleepRecords: [], focusLog: [],
    });
    expect(r).toBeNull();
  });

  it('surfaces a peak-focus-hour shift after short-sleep nights', () => {
    const recs: SleepRecord[] = [];
    const focusLog: Array<{ at: number }> = [];
    // 30 nights. Even-index nights short (4h), odd normal (8h). Focus the
    // next day peaks at 16:00 after short nights, 10:00 after normal.
    for (let i = 0; i < 30; i++) {
      const isShort = i % 2 === 0;
      recs.push(makeRecord(nightKey(i), isShort ? 4 * 60 : 8 * 60));
      const nextDayStart = new Date(nightKey(i + 1) + 'T00:00:00').getTime();
      focusLog.push({ at: nextDayStart + (isShort ? 16 : 10) * 60 * 60000 });
    }
    const result = detectSleepFocusPattern({
      opted_in: true, now: Date.now(), sleepRecords: recs, focusLog,
    });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('sleep_focus_shift');
    expect(result?.hour_shift).toBeGreaterThanOrEqual(2);
  });

  it('returns null when peak focus hours barely move', () => {
    const recs: SleepRecord[] = [];
    const focusLog: Array<{ at: number }> = [];
    for (let i = 0; i < 30; i++) {
      const isShort = i % 2 === 0;
      recs.push(makeRecord(nightKey(i), isShort ? 4 * 60 : 8 * 60));
      const nextDayStart = new Date(nightKey(i + 1) + 'T00:00:00').getTime();
      focusLog.push({ at: nextDayStart + 11 * 60 * 60000 });
    }
    expect(detectSleepFocusPattern({
      opted_in: true, now: Date.now(), sleepRecords: recs, focusLog,
    })).toBeNull();
  });
});

// ─── detectSleepDumpMoodPattern ───────────────────────────────────────

describe('detectSleepDumpMoodPattern', () => {
  it('returns null when opted_in is not true', () => {
    const r = detectSleepDumpMoodPattern({
      // @ts-expect-error opted_in must be true
      opted_in: false, now: Date.now(), sleepRecords: [], dumps: [],
    });
    expect(r).toBeNull();
  });

  it('surfaces heavier overwhelm language after poor-sleep nights', () => {
    const recs: SleepRecord[] = [];
    const dumps: Array<{ ts: number; text: string }> = [];
    // 30 nights. Even short (5h → poor), odd 8h (normal). The day after a
    // poor night, the dump is overwhelmed; after a normal night it's calm.
    for (let i = 0; i < 30; i++) {
      const isPoor = i % 2 === 0;
      recs.push(makeRecord(nightKey(i), isPoor ? 5 * 60 : 8 * 60, '23:00'));
      // dump window opens 24h after bedtime
      const dayStart = new Date(nightKey(i) + 'T00:00:00').getTime();
      const dumpTs = dayStart + 23 * 60 * 60000 + 30 * 60 * 60000; // bedtime + 30h
      dumps.push({
        ts: dumpTs,
        text: isPoor
          ? 'overwhelmed. so much. too much. drowning.'
          : 'calm day. steady. fine.',
      });
    }
    const result = detectSleepDumpMoodPattern({
      opted_in: true, now: Date.now(), sleepRecords: recs, dumps,
    });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('sleep_dump_mood_shift');
    expect(result?.poor_sleep_overwhelm_ratio).toBeGreaterThan(result!.normal_sleep_overwhelm_ratio);
  });

  it('returns null when there are too few paired dumps', () => {
    const recs = Array.from({ length: 4 }, (_, i) => makeRecord(nightKey(i), 5 * 60, '23:00'));
    const dumps = [{ ts: Date.now(), text: 'overwhelmed too much' }];
    expect(detectSleepDumpMoodPattern({
      opted_in: true, now: Date.now(), sleepRecords: recs, dumps,
    })).toBeNull();
  });
});
