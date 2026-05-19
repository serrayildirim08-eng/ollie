/**
 * cycle-v2 · selectors — pure view-models over the live cycle store
 *
 * Every screen of the v2 cycle preview derives its content here, from the
 * SAME `@ollie/logic/cycle` pure fns + `cycle.*` store slices the live
 * `CycleModule` uses. No rendering, no hooks — just `CycleSlices` in,
 * view-models out. This is the seam that keeps the redesign a UI rebuild.
 *
 * Mirrors money-v2/selectors.ts in spirit: small, tested, deterministic
 * (every fn takes an explicit `now`).
 */
import {
  detectBoundaries,
  detectHealthFlags,
  deriveCycleStats,
  computePhaseForDate,
  predictNextPeriod,
  predictOvulation,
  detectSyndromePatterns,
} from '@ollie/logic/cycle';
import type {
  CycleItem,
  CycleRecord,
  HealthFlag,
  SyndromeFlag,
} from '@ollie/logic/cycle';

const DAY_MS = 86_400_000;

// ─── store shapes ────────────────────────────────────────────────────────────

/** the cycle settings shape the live CycleModule writes */
export interface CycleSettings {
  tracking_for_fertility: boolean;
  show_dial: boolean;
  passphrase_hint: string;
  birth_control_enabled: boolean;
  birth_control_type: 'combined' | 'progestin-only' | 'other';
}

/** everything the v2 cycle screens read from the store */
export interface CycleSlices {
  items: CycleItem[];
  settings: CycleSettings;
  /** authoritative birth-control toggle (shared.settings) */
  birthControlEnabled: boolean;
  /** per-cycle last-edited map — feeds the health-flag cooldown */
  lastEditedByCycle: Record<number, number>;
  /** saved partner-ask picks */
  asks: string[];
}

// ─── small formatters ────────────────────────────────────────────────────────

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "may 28" */
export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "mon" */
export function fmtWeekday(ts: number): string {
  return WEEKDAYS[new Date(ts).getDay()];
}

/** local YYYY-MM-DD */
export function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** local midnight for a day `offset` from `now` */
export function startOfDayOffset(now: number, offset: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + offset * DAY_MS;
}

// ─── cycle-record derivation ─────────────────────────────────────────────────

/** closed/open cycle records, newest last (the live boundary detector) */
export function cycleRecords(items: CycleItem[]): CycleRecord[] {
  return detectBoundaries(items);
}

// ─── face view-model ─────────────────────────────────────────────────────────

export interface FaceVM {
  /** has the user ever logged a period start? */
  hasData: boolean;
  /** still <2 closed cycles — predictions stay honest */
  coldStart: boolean;
  /** 1-based current day in the running cycle */
  day: number;
  /** the current phase, lowercase */
  phase: string;
  /** the cycle length used for the ring scale */
  ringLength: number;
  /** first day of the luteal arc (omit on the cold ring) */
  lutealStartDay?: number;
  /** ovulation day for the ring point (omit on the cold ring) */
  ovulationDay?: number;
  /** the calm prediction line; null until the cold start clears */
  prediction: { date: string; plusMinusDays: number } | null;
  /** how many closed cycles fed the prediction */
  cyclesLogged: number;
  /** 0..1 confidence fill for the cold-state meter */
  confidenceFill: number;
}

export function faceVM(slices: CycleSlices, now: number): FaceVM {
  const cycles = cycleRecords(slices.items);
  const stats = deriveCycleStats(cycles);
  const pred = predictNextPeriod(cycles);
  const ov = predictOvulation(cycles);
  const phase = computePhaseForDate(cycles, now);

  const hasData = stats.last_period_start !== null;
  const ringLength = Math.max(21, Math.min(40, Math.round(stats.mean_length ?? 28)));

  const day = hasData
    ? Math.max(
        1,
        Math.floor((now - (stats.last_period_start as number)) / DAY_MS) + 1,
      )
    : 1;

  // a closed-cycle count drives the cold-start gate
  const closedCount = cycles.filter(
    (c) => typeof c.cycleLengthDays === 'number',
  ).length;
  const coldStart = closedCount < 2;

  // luteal arc + ovulation day — only when we trust the prediction
  let lutealStartDay: number | undefined;
  let ovulationDay: number | undefined;
  if (!coldStart) {
    // luteal begins ~13 days before the next period
    lutealStartDay = Math.max(1, ringLength - 13);
    if (ov.ovulationTs && stats.last_period_start) {
      const idx = Math.round(
        (ov.ovulationTs - (stats.last_period_start as number)) / DAY_MS,
      );
      if (idx > 0 && idx < ringLength) ovulationDay = idx;
    }
  }

  const prediction =
    !coldStart && pred.expectedStart
      ? {
          date: fmtDate(pred.expectedStart.getTime()),
          plusMinusDays: Math.max(1, Math.round(1.96 * pred.sd)),
        }
      : null;

  // confidence climbs with closed cycles; ~0.85 by 6 cycles
  const confidenceFill = Math.min(1, closedCount / 6);

  return {
    hasData,
    coldStart,
    day,
    phase: phase === 'unknown' ? 'cycle' : phase,
    ringLength,
    lutealStartDay,
    ovulationDay,
    prediction,
    cyclesLogged: closedCount,
    confidenceFill,
  };
}

// ─── pill-log view-model ─────────────────────────────────────────────────────

export interface PillDay {
  /** YYYY-MM-DD */
  key: string;
  /** local-midnight ts */
  ts: number;
  /** weekday label, "today" for offset 0 */
  label: string;
  /** days back from today (0 = today) */
  daysBack: number;
  /** was a pill logged this day? */
  logged: boolean;
  /** is this today? */
  isToday: boolean;
  /** within the 3-day back-date reach? */
  backdateable: boolean;
}

export const PILL_BACKDATE_LIMIT = 3;

export interface PillVM {
  /** the 7-day strip, oldest first, today last */
  strip: PillDay[];
  /** today logged? */
  todayLogged: boolean;
  /** total pill logs ever (cold-state gate) */
  totalLogged: number;
}

export function pillVM(slices: CycleSlices, now: number): PillVM {
  const pillItems = slices.items.filter((i) => i && i.action === 'pill');
  const loggedKeys = new Set(pillItems.map((p) => dateKey(p.ts ?? 0)));
  const todayKey = dateKey(now);

  const strip: PillDay[] = Array.from({ length: 7 }, (_, i) => {
    const daysBack = 6 - i;
    const ts = startOfDayOffset(now, -daysBack);
    const key = dateKey(ts);
    return {
      key,
      ts,
      label: daysBack === 0 ? 'today' : fmtWeekday(ts),
      daysBack,
      logged: loggedKeys.has(key),
      isToday: daysBack === 0,
      backdateable: daysBack > 0 && daysBack <= PILL_BACKDATE_LIMIT,
    };
  });

  return {
    strip,
    todayLogged: loggedKeys.has(todayKey),
    totalLogged: pillItems.length,
  };
}

// ─── history view-model ──────────────────────────────────────────────────────

export interface HistoryCycle {
  /** cycle start ts */
  startTs: number;
  /** month label of the start */
  month: string;
  /** closed cycle length in days */
  days: number;
  /** 0..1 bar width against the span of the set */
  fill: number;
  /** flagged long (>=35d) — bar tints sage */
  long: boolean;
}

export interface HistoryVM {
  /** has any closed cycle? */
  hasClosed: boolean;
  /** the mean cycle length, rounded */
  meanDays: number | null;
  /** last 5 closed cycles, newest first */
  cycles: HistoryCycle[];
  /** the irregular-spread note, or null */
  irregularNote: { spreadDays: number } | null;
}

export function historyVM(slices: CycleSlices): HistoryVM {
  const cycles = cycleRecords(slices.items);
  const stats = deriveCycleStats(cycles);
  const closed = cycles.filter(
    (c): c is CycleRecord & { cycleLengthDays: number } =>
      typeof c.cycleLengthDays === 'number',
  );

  if (closed.length === 0) {
    return { hasClosed: false, meanDays: null, cycles: [], irregularNote: null };
  }

  const last5 = closed.slice(-5);
  const lens = last5.map((c) => c.cycleLengthDays);
  const min = Math.min(...lens);
  const max = Math.max(...lens);
  const span = Math.max(1, max - min);

  const rows: HistoryCycle[] = last5
    .map((c) => ({
      startTs: c.cycleStartTs,
      month: MONTHS[new Date(c.cycleStartTs).getMonth()],
      days: c.cycleLengthDays,
      // 0.32..1 — the shortest still reads as a visible bar
      fill: 0.32 + 0.68 * ((c.cycleLengthDays - min) / span),
      long: c.cycleLengthDays >= 35,
    }))
    .reverse(); // newest first

  const irregularNote = stats.irregular_flag
    ? { spreadDays: max - min }
    : null;

  return {
    hasClosed: true,
    meanDays: stats.mean_length !== null ? Math.round(stats.mean_length) : null,
    cycles: rows,
    irregularNote,
  };
}

// ─── flags view-model ────────────────────────────────────────────────────────

export interface FlagRow {
  id: string;
  /** the one-line observation */
  line: string;
  /** the calm watch/discuss framing under it */
  frame: string;
  /** a quiet source tag (e.g. "ACOG"), or null */
  source: string | null;
}

export interface FlagsVM {
  /** combined per-cycle + syndrome flags */
  flags: FlagRow[];
}

/** pull a recognised authority tag out of a source URL */
function sourceTag(url: string | undefined): string | null {
  if (!url) return null;
  if (/acog\.org/i.test(url)) return 'ACOG';
  if (/ncbi|pubmed|nih\.gov/i.test(url)) return 'NIH';
  return null;
}

export function flagsVM(slices: CycleSlices, now: number): FlagsVM {
  const cycles = cycleRecords(slices.items);
  const symptomEvents = slices.items.filter(
    (i) => i && (i.action === 'symptom' || i.action === 'log'),
  );

  const health: HealthFlag[] = detectHealthFlags(
    cycles,
    symptomEvents,
    now,
    slices.lastEditedByCycle,
  );
  const syndromes: SyndromeFlag[] = detectSyndromePatterns(
    cycles,
    symptomEvents,
    now,
  );

  const flags: FlagRow[] = [
    ...health.map((f) => ({
      id: `health-${f.id}`,
      line: f.observation,
      frame: f.suggestion,
      source: sourceTag(f.sources[0]),
    })),
    ...syndromes.map((f) => ({
      id: `syndrome-${f.key}`,
      line: f.title,
      frame: f.body,
      source: null,
    })),
  ];

  return { flags };
}

/** the short flag-count line for the cycle face's calm flag row */
export function flagSummary(slices: CycleSlices, now: number): string | null {
  const { flags } = flagsVM(slices, now);
  if (flags.length === 0) return null;
  return flags.length === 1 ? '1 thing noticed' : `${flags.length} things noticed`;
}

// ─── log-today symptom tags ──────────────────────────────────────────────────

/** the ten calm symptom tags the v2 log sheet offers (cycle-log.html) */
export const SYMPTOM_TAGS = [
  'cramps',
  'bloating',
  'fatigue',
  'headache',
  'mood',
  'bleeding',
  'spotting',
  'cravings',
  'tender',
  'clear',
] as const;
export type SymptomTag = (typeof SYMPTOM_TAGS)[number];

// ─── partner-ask categories ──────────────────────────────────────────────────

export interface AskCategory {
  key: 'material' | 'touch' | 'labor' | 'emotional';
  options: string[];
}

/** the 4-category ask grid (partner-ask.html) */
export const ASK_CATEGORIES: AskCategory[] = [
  { key: 'material', options: ['a heat pad', 'snacks', 'pick up meds', 'tea'] },
  {
    key: 'touch',
    options: ['a hug', 'just sit close', 'space, no touch', 'back rub'],
  },
  {
    key: 'labor',
    options: ['take dinner', 'handle the dishes', 'run an errand', 'walk the dog'],
  },
  {
    key: 'emotional',
    options: ['just listen', 'no advice today', 'check in later', 'reassure me'],
  },
];

/**
 * Compose the picked ask options into one calm sentence — the same
 * note-preview the partner-ask mockup shows. Pure: picks in, copy out.
 */
export function composeAskNote(picks: string[]): string {
  if (picks.length === 0) {
    return 'pick a few things above and ollie will turn them into a note.';
  }
  const inCat = (cat: AskCategory['key']) =>
    ASK_CATEGORIES.find((c) => c.key === cat)!.options.filter((o) =>
      picks.includes(o),
    );

  const parts: string[] = [];
  const material = inCat('material');
  const touch = inCat('touch');
  const labor = inCat('labor');
  const emotional = inCat('emotional');

  if (material.length) parts.push(`${joinList(material)} would help`);
  if (touch.length) parts.push(`i'd love ${joinList(touch)}`);
  if (labor.length) parts.push(`if you can ${joinList(labor)}, that's a lot off me`);
  if (emotional.length) parts.push(`mostly i need you to ${joinList(emotional)}`);

  return `a low-energy day — ${parts.join('. ')}.`;
}

function joinList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
