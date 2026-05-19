import { describe, it, expect } from 'vitest';
import {
  parseTimeOfDay,
  bedtimeRelativeMinutes,
  minutesInBed,
  formatTime,
  isoDate,
  bedtimeEpochFor,
  parseSleepDump,
  mergeRecord,
  sleepEfficiency,
  resolveTarget,
  deriveSleepStats,
  computeSleepDebt,
  detectBedtimeDrift,
  detectDSPSPattern,
  detectShortSleepRun,
  detectRevengeBedtime,
  detectCaffeineCutoff,
  detectSleepOnsetGap,
  detectWeekendRecoveryIllusion,
  detectCyclePhaseSleepCoupling,
  detectStimulantSleepDebt,
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
