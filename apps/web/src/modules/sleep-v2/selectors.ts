/**
 * sleep-v2 · selectors — pure view-models over the live sleep store
 *
 * Every screen of the v2 sleep preview derives its content here, from the
 * SAME `@ollie/logic/sleep` pure fns + `sleep.*` store slices the live
 * `SleepModule` uses. No rendering, no hooks — just `SleepSlices` in,
 * view-models out. This is the seam that keeps the redesign a UI rebuild.
 *
 * Mirrors cycle-v2/selectors.ts in spirit: small, tested, deterministic
 * (every fn that needs the wall clock takes an explicit `now`).
 */
import {
  resolveTarget,
  computeSleepDebt,
  detectBedtimeDrift,
  estimateChronotype,
  computeSocialJetlag,
  detectDSPSPattern,
} from '@ollie/logic/sleep';
import type {
  SleepRecord,
  SleepSettings,
  ForecastResult,
  AnySleepPattern,
  InsomniaSurveyResult,
  EpworthResult,
} from '@ollie/logic/sleep';

// ─── store shapes ────────────────────────────────────────────────────────────

/** the persisted wind-down run state the live WindDownChecklist writes */
export interface WindDownState {
  date: string;
  completed: string[];
  startedAt: number | null;
  finished: boolean;
  dismissed: boolean;
}

/** everything the v2 sleep screens read from the store */
export interface SleepSlices {
  /** the canonical night log — `sleep.records` */
  records: SleepRecord[];
  /** sleep settings — target hours, cross-module flags */
  settings: SleepSettings;
  /** orchestrator-written tonight forecast — `sleep.tonightForecast` */
  tonightForecast: ForecastResult | null;
  /** orchestrator-written pattern set — `sleep.patterns` */
  patterns: AnySleepPattern[];
  /** persisted wind-down run state — `sleep.wind_down_state` */
  windDown: WindDownState | null;
  /** scored insomnia-survey result, if taken — `sleep.insomnia_survey_result` */
  insomniaResult: InsomniaSurveyResult | null;
  /** scored Epworth result, if taken — `sleep.epworth_result` */
  epworthResult: EpworthResult | null;
}

// ─── small formatters ────────────────────────────────────────────────────────

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAYS_FULL = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** "7h 20m" — minutes to a calm duration string */
export function fmtDuration(min: number): string {
  const safe = Math.max(0, Math.round(min));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** "tuesday" for a `night_of` YYYY-MM-DD */
export function weekdayOf(nightOf: string): string {
  const d = new Date(nightOf + 'T12:00:00');
  return WEEKDAYS_FULL[d.getDay()] ?? '';
}

/** "tue" short weekday for a `night_of` YYYY-MM-DD */
export function weekdayShort(nightOf: string): string {
  const d = new Date(nightOf + 'T12:00:00');
  return WEEKDAYS[d.getDay()] ?? '';
}

/** local YYYY-MM-DD for a timestamp */
export function isoDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** the calm minimum night count before the forecast is trusted */
export const FORECAST_COLD_NIGHTS = 5;

// ─── usable records ──────────────────────────────────────────────────────────

/** logged, not-skipped, has a duration — the records the v2 face counts */
export function usableRecords(records: SleepRecord[]): SleepRecord[] {
  return (Array.isArray(records) ? records : []).filter(
    (r) => r && !r.is_skipped && typeof r.tst_min === 'number',
  );
}

// ─── face view-model ─────────────────────────────────────────────────────────

export interface FaceVM {
  /** has any night ever been logged with a duration? */
  hasData: boolean;
  /** still <5 nights — the forecast stays honest */
  coldStart: boolean;
  /** last night's duration in minutes, null until a night is logged */
  lastNightMin: number | null;
  /** the 7-night bar strip, oldest first, today last */
  week: WeekBar[];
  /** this-week sleep-debt minutes (positive = short), null cold */
  debtMin: number | null;
  /** tonight's forecast hours, null cold or until the orchestrator writes one */
  tonightHours: number | null;
  /** how many usable nights are logged */
  nightsLogged: number;
  /** 0..1 confidence fill for the cold-state meter */
  confidenceFill: number;
}

export interface WeekBar {
  /** YYYY-MM-DD */
  key: string;
  /** 0..1 height fill (0 = an empty/not-yet slot) */
  fill: number;
  /** is this the most recent logged night? */
  isLast: boolean;
  /** an empty "not yet" slot — a dashed placeholder, never a zero bar */
  empty: boolean;
}

/** the bar heights read ~3h..~10h of sleep; clamp keeps a short night visible */
function durationFill(min: number): number {
  const h = min / 60;
  return Math.max(0.18, Math.min(1, (h - 3) / 7));
}

export function faceVM(slices: SleepSlices, now: number): FaceVM {
  const usable = usableRecords(slices.records);
  const hasData = usable.length > 0;
  const nightsLogged = usable.length;
  const coldStart = nightsLogged < FORECAST_COLD_NIGHTS;

  const lastRec = usable.length > 0 ? usable[usable.length - 1] : null;
  const lastNightMin = lastRec ? (lastRec.tst_min as number) : null;

  // the 7-night strip — the last 7 usable nights, padded with empty slots
  const last7 = usable.slice(-7);
  const week: WeekBar[] = [];
  const emptyCount = Math.max(0, 7 - last7.length);
  for (let i = 0; i < emptyCount; i++) {
    week.push({ key: `empty-${i}`, fill: 0, isLast: false, empty: true });
  }
  last7.forEach((r, i) => {
    week.push({
      key: r.night_of,
      fill: durationFill(r.tst_min as number),
      isLast: i === last7.length - 1,
      empty: false,
    });
  });

  // sleep debt — only once there's enough to derive it honestly
  const target = resolveTarget(slices.settings);
  const debt =
    usable.length >= 3 ? computeSleepDebt(slices.records, target, 7, now) : null;
  const debtMin =
    debt && debt.nightsCounted > 0
      ? Math.round(debt.totalDeficitHours * 60)
      : null;

  // tonight's forecast — orchestrator-written, surfaced only when warmed up
  const tonightHours =
    !coldStart && slices.tonightForecast
      ? slices.tonightForecast.mean_h
      : null;

  // confidence climbs with logged nights; ~full by ~10 nights
  const confidenceFill = Math.min(1, nightsLogged / 10);

  return {
    hasData,
    coldStart,
    lastNightMin,
    week,
    debtMin,
    tonightHours,
    nightsLogged,
    confidenceFill,
  };
}

// ─── log-last-night sheet ────────────────────────────────────────────────────

/** the four calm quick-log feel options (sleep-log.html) */
export interface FeelOption {
  key: 'solid' | 'ok' | 'rough' | 'bad';
  /** the 1–5 quality value the live module's logFeel uses */
  quality: number;
}

export const FEEL_OPTIONS: FeelOption[] = [
  { key: 'solid', quality: 5 },
  { key: 'ok', quality: 4 },
  { key: 'rough', quality: 2 },
  { key: 'bad', quality: 1 },
];

/** "tuesday → wednesday" — last night's day pair for the log sheet sub-line */
export function logSheetSubline(now: number): string {
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  return `${WEEKDAYS_FULL[yesterday.getDay()]} → ${WEEKDAYS_FULL[today.getDay()]}`;
}

// ─── wind-down ritual ────────────────────────────────────────────────────────

/** the six calm wind-down steps (sleep-winddown.html) */
export interface WindDownStep {
  id: string;
  label: string;
  /** the focused-step cue, shown only on the step in focus */
  cue?: string;
}

export const WIND_DOWN_STEPS: WindDownStep[] = [
  { id: 'phone_away', label: 'phone away' },
  { id: 'drink_water', label: 'a glass of water' },
  { id: 'supplement', label: 'supplement' },
  { id: 'lights_low', label: 'lights low', cue: "dim the room — tap when it's done" },
  { id: 'breath_journal', label: 'breath or a few lines journalled' },
  { id: 'into_bed', label: 'into bed' },
];

export interface WindDownVM {
  steps: WindDownStep[];
  /** ids completed so far, in order */
  completed: string[];
  /** index of the next tappable step (== completed.length) */
  cursor: number;
  /** all six done */
  allDone: boolean;
}

/**
 * The wind-down view-model. Reads the persisted run state — but only
 * honours it when it belongs to today's date key, mirroring the live
 * `WindDownChecklist` day-boundary reset.
 */
export function windDownVM(slices: SleepSlices, now: number): WindDownVM {
  const todayKey = isoDay(now);
  const persisted = slices.windDown;
  const completed =
    persisted && persisted.date === todayKey && Array.isArray(persisted.completed)
      ? persisted.completed.filter((id) =>
          WIND_DOWN_STEPS.some((s) => s.id === id),
        )
      : [];
  const cursor = completed.length;
  return {
    steps: WIND_DOWN_STEPS,
    completed,
    cursor,
    allDone: cursor >= WIND_DOWN_STEPS.length,
  };
}

// ─── history view-model ──────────────────────────────────────────────────────

export interface HistoryNight {
  /** YYYY-MM-DD */
  key: string;
  /** total sleep time in minutes */
  tstMin: number;
  /** 0..1 height fill against ~3h..~10h */
  fill: number;
  /** the most recent night — tints amber */
  isLast: boolean;
  /** a weekend night — a touch muted in the chart */
  weekend: boolean;
}

export interface HistoryVM {
  /** has any usable night? */
  hasData: boolean;
  /** count of usable nights in the window */
  count: number;
  /** the window mean duration in minutes, null if too thin */
  meanMin: number | null;
  /** the last 14 usable nights, oldest first */
  nights: HistoryNight[];
  /** the shortest night in the window, in minutes */
  shortestMin: number | null;
  /** the window sleep-debt minutes (positive = short), null cold */
  debtMin: number | null;
}

export function historyVM(slices: SleepSlices, now: number): HistoryVM {
  const usable = usableRecords(slices.records);
  if (usable.length === 0) {
    return {
      hasData: false,
      count: 0,
      meanMin: null,
      nights: [],
      shortestMin: null,
      debtMin: null,
    };
  }

  const last14 = usable.slice(-14);
  const nights: HistoryNight[] = last14.map((r, i) => {
    const d = new Date(r.night_of + 'T12:00:00');
    const dow = d.getDay();
    return {
      key: r.night_of,
      tstMin: r.tst_min as number,
      fill: durationFill(r.tst_min as number),
      isLast: i === last14.length - 1,
      weekend: dow === 0 || dow === 6,
    };
  });

  const lens = last14.map((r) => r.tst_min as number);
  const meanMin =
    lens.length > 0
      ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)
      : null;
  const shortestMin = lens.length > 0 ? Math.min(...lens) : null;

  const target = resolveTarget(slices.settings);
  const debt =
    usable.length >= 3 ? computeSleepDebt(slices.records, target, 14, now) : null;
  const debtMin =
    debt && debt.nightsCounted > 0
      ? Math.round(debt.totalDeficitHours * 60)
      : null;

  return {
    hasData: true,
    count: last14.length,
    meanMin,
    nights,
    shortestMin,
    debtMin,
  };
}

// ─── patterns view-model ─────────────────────────────────────────────────────

export interface PatternLine {
  id: string;
  /** the section the observation groups under */
  group: 'shape' | 'week' | 'winddown' | 'cross';
  /** the one-line observation */
  line: string;
  /** the calm reframe under it */
  frame: string;
}

export interface PatternsVM {
  /** every observed pattern, grouped */
  patterns: PatternLine[];
}

const GROUP_LABELS: Record<PatternLine['group'], string> = {
  shape: 'your shape',
  week: 'week vs weekend',
  winddown: 'the wind-down',
  cross: 'across your modules',
};

export function patternGroupLabel(group: PatternLine['group']): string {
  return GROUP_LABELS[group];
}

/**
 * Compose the observed sleep patterns into calm one-line journal entries.
 * The "shape" group is derived live from the same `@ollie/logic/sleep`
 * detectors the live `SleepModule` uses; the orchestrator-written
 * `patterns` slice contributes the behavioural + cross-module lines.
 */
export function patternsVM(slices: SleepSlices): PatternsVM {
  const records = slices.records;
  const out: PatternLine[] = [];

  // ── your shape — derived live from the pure detectors ───────────────────
  const chronotype =
    records.length >= 7 ? estimateChronotype(records) : null;
  if (chronotype && chronotype.msfScFormatted) {
    out.push({
      id: 'chronotype',
      group: 'shape',
      line: `on free days, your mid-sleep lands around ${chronotype.msfScFormatted}`,
      frame: `that reads as a ${chronotype.category} chronotype — a pattern, not a habit to fix.`,
    });
  }

  const drift = records.length >= 7 ? detectBedtimeDrift(records) : null;
  if (drift) {
    out.push({
      id: 'drift',
      group: 'shape',
      line: `your bedtime has drifted ${drift.direction} over the last ${drift.n_nights} nights`,
      frame: 'a slow slide, the kind that’s easy to miss from inside it.',
    });
  }

  const dsps = records.length >= 14 ? detectDSPSPattern(records) : null;
  if (dsps) {
    out.push({
      id: 'dsps',
      group: 'shape',
      line: `a late-bedtime run held for ${dsps.runWeeks}+ weeks — median bedtime ${dsps.medianBedtime}`,
      frame:
        'this looks like a delayed-sleep-phase pattern — a pattern, not a diagnosis. only a clinician can name it.',
    });
  }

  // ── week vs weekend ─────────────────────────────────────────────────────
  const jetlag = records.length >= 7 ? computeSocialJetlag(records) : null;
  if (jetlag) {
    out.push({
      id: 'social-jetlag',
      group: 'week',
      line: `your weekend mid-sleep sits about ${jetlag.hours}h ${
        jetlag.direction === 'free-later' ? 'later' : 'earlier'
      }`,
      frame: 'social jetlag — like flying a couple of time zones each weekend, then back.',
    });
  }

  // ── orchestrator-written patterns — behavioural + cross-module ──────────
  for (const p of slices.patterns) {
    if (!p || typeof p.pattern !== 'string') continue;
    if (p.pattern === 'wind_down_friction') {
      const wp = p as Extract<AnySleepPattern, { pattern: 'wind_down_friction' }>;
      out.push({
        id: 'wind-down-friction',
        group: 'winddown',
        line: `wind-down tends to stall on "${wp.stuck_step_label ?? 'phone away'}"`,
        frame: 'the step you stick on — friction has a shape, and naming it helps.',
      });
    } else if (p.pattern === 'cycle_phase_sleep_coupling') {
      const cp = p as Extract<
        AnySleepPattern,
        { pattern: 'cycle_phase_sleep_coupling' }
      >;
      out.push({
        id: 'sleep-cycle',
        group: 'cross',
        line: `in your luteal phase, falling asleep takes ~${cp.delta_min} min longer`,
        frame: 'sleep × cycle — your body is different that week, not failing.',
      });
    } else if (p.pattern === 'sleep_focus_shift') {
      const sp = p as Extract<AnySleepPattern, { pattern: 'sleep_focus_shift' }>;
      out.push({
        id: 'sleep-focus',
        group: 'cross',
        line: 'after short nights, your deep-focus peak shifts later',
        frame: `sleep × focus — worth knowing before you schedule hard work. (${sp.normal_sleep_peak_hour}:00 → ${sp.short_sleep_peak_hour}:30)`,
      });
    } else if (p.pattern === 'sleep_dump_mood_shift') {
      out.push({
        id: 'sleep-mood',
        group: 'cross',
        line: 'poor-sleep nights are followed by heavier-feeling days',
        frame: 'sleep × mood — the next-day weight is the sleep talking, not you.',
      });
    } else if (p.pattern === 'weekend_recovery_illusion') {
      const wp = p as Extract<
        AnySleepPattern,
        { pattern: 'weekend_recovery_illusion' }
      >;
      out.push({
        id: 'weekend-recovery',
        group: 'week',
        line: `weekend lie-ins add ~${(wp.gap_min / 60).toFixed(1)}h, but the debt stays`,
        frame: 'the recovery-sleep feeling is real; it doesn’t quite pay the week back.',
      });
    }
  }

  return { patterns: out };
}

/** the short pattern-count line for the sleep face's calm observation row */
export function patternSummary(slices: SleepSlices): string | null {
  const { patterns } = patternsVM(slices);
  if (patterns.length === 0) return null;
  return 'a few sleep patterns ollie noticed';
}

// ─── go-deeper surveys ───────────────────────────────────────────────────────

/** the four insomnia severity bands, in order — the result-screen rule */
export const INSOMNIA_BANDS = [
  'none',
  'sub-threshold',
  'moderate',
  'severe',
] as const;

/** map a band key to its 0-based segment index */
export function insomniaBandIndex(band: string): number {
  if (band === 'none') return 0;
  if (band === 'subthreshold') return 1;
  if (band === 'moderate') return 2;
  return 3;
}

/** a calm plain-language reading of an insomnia score + band */
export function insomniaBandReading(score: number, band: string): string {
  if (band === 'none') {
    return `a score of ${score} sits in the none range — no clinically significant insomnia. nothing here needs doing.`;
  }
  if (band === 'subthreshold') {
    return `a score of ${score} sits in the sub-threshold range — some sleep difficulty, below the clinical line. worth keeping an eye on; not a cause for alarm.`;
  }
  if (band === 'moderate') {
    return `a score of ${score} sits in the moderate range — a noticeable sleep difficulty. worth raising with a clinician when you can.`;
  }
  return `a score of ${score} sits in the severe range — sleep is wearing on you. it is worth speaking to a clinician.`;
}
