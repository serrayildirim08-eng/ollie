/**
 * sleep-v2 · selectors — unit tests
 *
 * The selectors are the real-data bridge: pure fns turning the live
 * `sleep.*` slices into the v2 view-models. These tests verify the
 * bridge, including the cold-start branch the v2 face depends on for its
 * two states. Mirrors cycle-v2/selectors.test.ts in spirit.
 */
import { describe, it, expect } from 'vitest';
import type { SleepRecord } from '@ollie/logic/sleep';
import {
  fmtDuration,
  weekdayOf,
  weekdayShort,
  isoDay,
  usableRecords,
  faceVM,
  windDownVM,
  historyVM,
  patternsVM,
  patternSummary,
  insomniaBandIndex,
  insomniaBandReading,
  logSheetSubline,
  FORECAST_COLD_NIGHTS,
  WIND_DOWN_STEPS,
  type SleepSlices,
} from './selectors';

const NOW = new Date('2026-05-18T12:00:00Z').getTime();
const DAY = 86_400_000;

function emptySlices(): SleepSlices {
  return {
    records: [],
    settings: {},
    tonightForecast: null,
    patterns: [],
    windDown: null,
    insomniaResult: null,
    epworthResult: null,
  };
}

/** a logged night `daysAgo` before NOW, with the given total sleep minutes */
function night(daysAgo: number, tstMin: number, extra: Partial<SleepRecord> = {}): SleepRecord {
  const d = new Date(NOW - daysAgo * DAY);
  const nightOf = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  return {
    night_of: nightOf,
    bedtime: '23:30',
    wake_time: '07:00',
    onset_latency_min: 15,
    wakings_count: 0,
    wakings_total_min: 0,
    tst_min: tstMin,
    efficiency: 0.92,
    quality: 4,
    quality_text: null,
    notes: null,
    tokens: [],
    is_skipped: false,
    is_partial: false,
    is_disputed: false,
    ...extra,
  };
}

describe('format helpers', () => {
  it('fmtDuration renders hours and minutes', () => {
    expect(fmtDuration(440)).toBe('7h 20m');
    expect(fmtDuration(45)).toBe('45m');
    expect(fmtDuration(0)).toBe('0m');
  });
  it('fmtDuration clamps negatives to zero', () => {
    expect(fmtDuration(-30)).toBe('0m');
  });
  it('weekdayOf / weekdayShort render a weekday name', () => {
    expect(weekdayOf('2026-05-18')).toBe('monday');
    expect(weekdayShort('2026-05-18')).toBe('mon');
  });
  it('isoDay renders a local YYYY-MM-DD', () => {
    expect(isoDay(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('logSheetSubline names last night → this morning', () => {
    expect(logSheetSubline(NOW)).toMatch(/^\w+ → \w+$/);
  });
});

describe('usableRecords', () => {
  it('drops skipped + duration-less records', () => {
    const records = [
      night(2, 420),
      night(1, 400, { is_skipped: true }),
      night(0, 0, { tst_min: null }),
    ];
    expect(usableRecords(records)).toHaveLength(1);
  });
  it('tolerates a non-array', () => {
    expect(usableRecords(undefined as unknown as SleepRecord[])).toEqual([]);
  });
});

describe('faceVM', () => {
  it('cold-start with no data — never a blank, the week is all empty slots', () => {
    const vm = faceVM(emptySlices(), NOW);
    expect(vm.hasData).toBe(false);
    expect(vm.coldStart).toBe(true);
    expect(vm.lastNightMin).toBeNull();
    expect(vm.week).toHaveLength(7);
    expect(vm.week.every((b) => b.empty)).toBe(true);
    expect(vm.tonightHours).toBeNull();
    expect(vm.confidenceFill).toBe(0);
  });

  it('a few logged nights stay cold-start, last night reads through', () => {
    const slices = emptySlices();
    slices.records = [night(2, 410), night(1, 430), night(0, 440)];
    const vm = faceVM(slices, NOW);
    expect(vm.hasData).toBe(true);
    expect(vm.coldStart).toBe(true);
    expect(vm.nightsLogged).toBe(3);
    expect(vm.lastNightMin).toBe(440);
    // 3 real bars + 4 dashed empty slots, newest last + amber
    expect(vm.week.filter((b) => b.empty)).toHaveLength(4);
    expect(vm.week[vm.week.length - 1].isLast).toBe(true);
  });

  it('warms up past the cold threshold and surfaces the forecast', () => {
    const slices = emptySlices();
    slices.records = Array.from({ length: FORECAST_COLD_NIGHTS + 1 }, (_, i) =>
      night(FORECAST_COLD_NIGHTS - i, 420),
    );
    slices.tonightForecast = {
      mean_h: 7,
      ci95_h: [6, 8],
      mean_min: 420,
      ci95_min: [360, 480],
      tier: 'medium',
      method: 'heuristic',
      nights_counted: 6,
    };
    const vm = faceVM(slices, NOW);
    expect(vm.coldStart).toBe(false);
    expect(vm.tonightHours).toBe(7);
    expect(vm.week).toHaveLength(7);
  });
});

describe('windDownVM', () => {
  it('no persisted state — cursor at the first step, nothing done', () => {
    const vm = windDownVM(emptySlices(), NOW);
    expect(vm.steps).toHaveLength(6);
    expect(vm.completed).toHaveLength(0);
    expect(vm.cursor).toBe(0);
    expect(vm.allDone).toBe(false);
  });

  it('honours today\'s persisted run state', () => {
    const slices = emptySlices();
    slices.windDown = {
      date: isoDay(NOW),
      completed: ['phone_away', 'drink_water', 'supplement'],
      startedAt: NOW,
      finished: false,
      dismissed: false,
    };
    const vm = windDownVM(slices, NOW);
    expect(vm.cursor).toBe(3);
    expect(vm.allDone).toBe(false);
  });

  it('ignores a stale (different-day) run state — day-boundary reset', () => {
    const slices = emptySlices();
    slices.windDown = {
      date: isoDay(NOW - DAY),
      completed: WIND_DOWN_STEPS.map((s) => s.id),
      startedAt: NOW - DAY,
      finished: true,
      dismissed: false,
    };
    const vm = windDownVM(slices, NOW);
    expect(vm.completed).toHaveLength(0);
    expect(vm.cursor).toBe(0);
  });
});

describe('historyVM', () => {
  it('empty state — honest, no nights', () => {
    const vm = historyVM(emptySlices(), NOW);
    expect(vm.hasData).toBe(false);
    expect(vm.meanMin).toBeNull();
    expect(vm.nights).toHaveLength(0);
  });

  it('windows the last 14 nights and derives mean + shortest', () => {
    const slices = emptySlices();
    slices.records = Array.from({ length: 20 }, (_, i) => night(19 - i, 360 + i * 6));
    const vm = historyVM(slices, NOW);
    expect(vm.hasData).toBe(true);
    expect(vm.count).toBe(14);
    expect(vm.nights).toHaveLength(14);
    expect(vm.nights[vm.nights.length - 1].isLast).toBe(true);
    expect(vm.meanMin).not.toBeNull();
    expect(vm.shortestMin).toBe(360 + 6 * 6); // the 7th-oldest (last 14 of 20)
  });
});

describe('patternsVM', () => {
  it('no records — no patterns, no summary line', () => {
    expect(patternsVM(emptySlices()).patterns).toHaveLength(0);
    expect(patternSummary(emptySlices())).toBeNull();
  });

  it('folds an orchestrator-written wind-down friction pattern in', () => {
    const slices = emptySlices();
    slices.patterns = [
      {
        pattern: 'wind_down_friction',
        median_total_minutes: 40,
        stuck_step_id: 'phone_away',
        stuck_step_label: 'phone away',
        median_stuck_minutes: 18,
        n_nights: 12,
        confidence: 'medium',
        copy: '',
        source: { citation: 'hvolby 2015', url: 'https://example.test' },
      },
    ];
    const vm = patternsVM(slices);
    const friction = vm.patterns.find((p) => p.id === 'wind-down-friction');
    expect(friction).toBeDefined();
    expect(friction?.group).toBe('winddown');
    expect(patternSummary(slices)).not.toBeNull();
  });
});

describe('insomnia result helpers', () => {
  it('maps each band to its segment index', () => {
    expect(insomniaBandIndex('none')).toBe(0);
    expect(insomniaBandIndex('subthreshold')).toBe(1);
    expect(insomniaBandIndex('moderate')).toBe(2);
    expect(insomniaBandIndex('severe')).toBe(3);
  });
  it('reads a band plainly, calm and reassuring', () => {
    const reading = insomniaBandReading(11, 'subthreshold');
    expect(reading).toContain('11');
    expect(reading).toContain('sub-threshold');
    // the sub-threshold reading explicitly de-escalates
    expect(reading).toContain('not a cause for alarm');
  });
  it('a none-band read needs nothing done', () => {
    const reading = insomniaBandReading(4, 'none');
    expect(reading).toContain('nothing here needs doing');
  });
});
