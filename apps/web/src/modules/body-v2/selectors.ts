/**
 * body-v2 · selectors — pure view-models over the live body store
 *
 * Every screen of the v2 body preview derives its content here, from the
 * SAME `@ollie/logic/body` pure fns + `body.*` / `shared.*` store slices the
 * live `BodyModule` uses. No rendering, no hooks — just `BodySlices` in,
 * view-models out. This is the seam that keeps the redesign a UI rebuild.
 *
 * Mirrors sleep-v2/selectors.ts in spirit: small, tested, deterministic
 * (every fn that needs the wall clock takes an explicit `now`).
 */
import {
  activeEpisode,
  elapsedDays,
  summarizeEpisode,
  generateDoctorSummary,
} from '@ollie/logic/body';
import type {
  Episode,
  TreatmentPlan,
  AnyBodyPattern,
  DoctorSummaryHistory,
} from '@ollie/logic/body';

// ─── store shapes ────────────────────────────────────────────────────────────

/** a supplement, as the live `BodyModule` stores it on `body.supplements` */
export interface Supplement {
  id: string;
  name: string;
  dose: string | null;
  added_at: number;
  /** YYYY-MM-DD days the supplement was marked taken (orchestrator reads this) */
  checked_dates?: string[];
  /** optional per-supplement reminder time HH:MM */
  reminder_hhmm?: string;
}

/** the per-day supplement-check slice — `body.supp_checks` */
export type SuppChecks = Record<string, Record<string, boolean>>;

/** the cross-module `shared.settings` subset body reads */
export interface BodySharedSettings {
  age_range?: string;
  chronic_conditions?: string[];
  name?: string;
  [k: string]: unknown;
}

/** the orchestrator-written be-gentle card — `body.protective_cards` */
export interface ProtectiveCard {
  id: string;
  reason: string;
  kind?: string;
  ts: number;
}

/** everything the v2 body screens read from the store */
export interface BodySlices {
  /** the day-by-day water tap log — `body.water_log` (timestamps) */
  waterLog: number[];
  /** the daily water target — `body.water_target` */
  waterTarget: number;
  /** the tracked supplements — `body.supplements` */
  supplements: Supplement[];
  /** the per-day check-off slice — `body.supp_checks` */
  suppChecks: SuppChecks;
  /** the symptom-episode log — `body.episodes` */
  episodes: Episode[];
  /** the scheduled treatment plans — `body.treatment_plans` */
  treatmentPlans: TreatmentPlan[];
  /** the orchestrator-written body pattern set — `body.patterns` */
  patterns: AnyBodyPattern[];
  /** the orchestrator-written be-gentle cards — `body.protective_cards` */
  protectiveCards: ProtectiveCard[];
  /** the chronic conditions tracked — `shared.settings.chronic_conditions` */
  conditions: string[];
  /** the user's display name, if any — `shared.settings.name` */
  userName: string | null;
}

// ─── small formatters ────────────────────────────────────────────────────────

const WEEKDAYS_FULL = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** local YYYY-MM-DD for a timestamp */
export function isoDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** "monday" for a timestamp */
export function weekdayOf(ts: number): string {
  return WEEKDAYS_FULL[new Date(ts).getDay()] ?? '';
}

/** "mon" short weekday for a timestamp */
export function weekdayShort(ts: number): string {
  return (WEEKDAYS_FULL[new Date(ts).getDay()] ?? '').slice(0, 3);
}

/** "2:10pm" — a calm 12h clock for a timestamp */
export function clockOf(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

/** "mon · 2:10pm" — the dated tail meds + check-ins carry */
export function dayClock(ts: number): string {
  return `${weekdayShort(ts)} · ${clockOf(ts)}`;
}

// ─── face view-model ─────────────────────────────────────────────────────────

/** the calm minimum episode count before the patterns row earns its place */
export const PATTERN_MIN = 1;

/** the body face has two foci: an open episode, or — if none — water */
export type FaceFocus = 'episode' | 'water';

export interface FaceVM {
  /** which hero the face shows */
  focus: FaceFocus;
  /** has anything at all been logged yet? (drives the cold copy) */
  hasAnyData: boolean;

  // ── water (always computed; the hero when no episode runs) ──
  /** glasses logged today */
  waterCount: number;
  /** the daily target, clamped 1..16 */
  waterTarget: number;

  // ── supplements ──
  /** how many supplements are tracked */
  suppTotal: number;
  /** how many are checked off today */
  suppTaken: number;

  // ── the open episode (only when focus === 'episode') ──
  /** the open episode, or null */
  episode: Episode | null;
  /** "day 2" — the calm day counter for the open episode */
  episodeDay: string;
  /** the last severity check-in value 1..5, or null */
  lastSeverity: number | null;
  /** the severity arc points — last up-to-6 check-ins, 1..5 */
  severityArc: number[];

  // ── drill-row glance lines ──
  /** symptoms row line */
  symptomsLine: string;
  /** conditions row line */
  conditionsLine: string;
  /** doctor-summary row line */
  doctorLine: string;
  /** is the doctor summary cold (no episode ever)? */
  doctorCold: boolean;
  /** is the symptoms row cold? */
  symptomsCold: boolean;
  /** is the conditions row cold? */
  conditionsCold: boolean;

  // ── the observed-pattern row ──
  /** a one-line pattern teaser, or null when nothing is observed */
  patternLine: string | null;
}

/** logged, finished episodes — the ones with both ends */
function closedEpisodes(episodes: Episode[]): Episode[] {
  return (Array.isArray(episodes) ? episodes : []).filter(
    (e) => e && typeof e.ended_at === 'number',
  );
}

/** count of glasses logged today, defensively */
export function waterCountToday(waterLog: number[], now: number): number {
  const today = isoDay(now);
  return (Array.isArray(waterLog) ? waterLog : []).filter(
    (ts) => typeof ts === 'number' && isoDay(ts) === today,
  ).length;
}

/** clamp the daily water target the way the live module does */
export function resolveWaterTarget(target: number): number {
  return Math.max(1, Math.min(16, target || 8));
}

/** how many of the tracked supplements are checked off today */
export function suppTakenToday(
  supplements: Supplement[],
  suppChecks: SuppChecks,
  now: number,
): number {
  const today = isoDay(now);
  const checks = suppChecks?.[today] ?? {};
  return (Array.isArray(supplements) ? supplements : []).filter(
    (s) => s && checks[s.id],
  ).length;
}

export function faceVM(slices: BodySlices, now: number): FaceVM {
  const waterCount = waterCountToday(slices.waterLog, now);
  const waterTarget = resolveWaterTarget(slices.waterTarget);
  const suppTotal = (Array.isArray(slices.supplements) ? slices.supplements : [])
    .length;
  const suppTaken = suppTakenToday(slices.supplements, slices.suppChecks, now);

  const ep = activeEpisode(
    Array.isArray(slices.episodes) ? slices.episodes : [],
  );
  const closed = closedEpisodes(slices.episodes);
  const everLogged =
    (Array.isArray(slices.episodes) ? slices.episodes : []).length > 0;

  // ── episode hero figures ──
  let episodeDay = '';
  let lastSeverity: number | null = null;
  let severityArc: number[] = [];
  if (ep) {
    const days = elapsedDays(ep, now);
    episodeDay = `day ${Math.max(1, days + 1)}`;
    const sev = Array.isArray(ep.severity_log) ? ep.severity_log : [];
    severityArc = sev
      .slice(-6)
      .map((s) => Math.max(1, Math.min(5, s.severity)));
    lastSeverity = sev.length > 0 ? sev[sev.length - 1].severity : null;
  }

  // ── drill-row glance lines ──
  const conditionCount = (
    Array.isArray(slices.conditions) ? slices.conditions : []
  ).length;
  const planCount = (
    Array.isArray(slices.treatmentPlans) ? slices.treatmentPlans : []
  ).length;

  const symptomsCold = !everLogged;
  const symptomsLine = ep
    ? `1 open · ${ep.label || 'an episode'}`
    : everLogged
      ? `${closed.length} closed · log a new one`
      : 'nothing logged — start one when something turns up';

  const conditionsCold = conditionCount === 0 && planCount === 0;
  const conditionsLine = conditionsCold
    ? 'none tracked yet'
    : `${conditionCount} tracked${
        planCount > 0
          ? ` · ${planCount} treatment${planCount === 1 ? '' : 's'} running`
          : ''
      }`;

  // doctor summary becomes real once any episode has been logged
  const doctorCold = !everLogged;
  const doctorLine = ep
    ? `${ep.label || 'episode'} · ready to bring in`
    : closed.length > 0
      ? `${closed.length} episode${closed.length === 1 ? '' : 's'} on record`
      : 'builds itself once an episode has been logged';

  const patternLine = patternSummary(slices);

  return {
    focus: ep ? 'episode' : 'water',
    hasAnyData:
      everLogged ||
      waterCount > 0 ||
      suppTotal > 0 ||
      conditionCount > 0 ||
      planCount > 0,
    waterCount,
    waterTarget,
    suppTotal,
    suppTaken,
    episode: ep,
    episodeDay,
    lastSeverity,
    severityArc,
    symptomsLine,
    conditionsLine,
    doctorLine,
    doctorCold,
    symptomsCold,
    conditionsCold,
    patternLine,
  };
}

// ─── intake view-model ───────────────────────────────────────────────────────

export interface SupplementRow {
  id: string;
  name: string;
  /** "9:00am" reminder time, or null */
  when: string | null;
  /** checked off today */
  taken: boolean;
}

export interface IntakeVM {
  waterCount: number;
  waterTarget: number;
  /** 0..1 fill of the big glass */
  waterFill: number;
  supplements: SupplementRow[];
}

/** format an HH:MM reminder string as "9:00am" */
export function fmtReminder(hhmm: string | undefined): string | null {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (!Number.isFinite(h)) return null;
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min}${ampm}`;
}

export function intakeVM(slices: BodySlices, now: number): IntakeVM {
  const waterCount = waterCountToday(slices.waterLog, now);
  const waterTarget = resolveWaterTarget(slices.waterTarget);
  const today = isoDay(now);
  const checks = slices.suppChecks?.[today] ?? {};
  const supplements: SupplementRow[] = (
    Array.isArray(slices.supplements) ? slices.supplements : []
  )
    .filter((s) => s && s.id)
    .map((s) => ({
      id: s.id,
      name: s.name || 'supplement',
      when: fmtReminder(s.reminder_hhmm),
      taken: Boolean(checks[s.id]),
    }));
  return {
    waterCount,
    waterTarget,
    waterFill: Math.min(1, waterTarget > 0 ? waterCount / waterTarget : 0),
    supplements,
  };
}

// ─── symptoms view-model ─────────────────────────────────────────────────────

/** the three calm episode kinds the v2 intake offers */
export interface KindOption {
  value: 'acute' | 'chronic' | 'mental';
  hint: string;
}

export const KIND_OPTIONS: KindOption[] = [
  { value: 'acute', hint: 'one-off' },
  { value: 'chronic', hint: 'ongoing' },
  { value: 'mental', hint: 'mood, mind' },
];

export interface SymptomsVM {
  /** the open episode, or null */
  open: Episode | null;
  /** closed episodes, newest first */
  closed: Episode[];
}

export function symptomsVM(slices: BodySlices): SymptomsVM {
  const list = Array.isArray(slices.episodes) ? slices.episodes : [];
  return {
    open: activeEpisode(list),
    closed: closedEpisodes(list)
      .slice()
      .sort((a, b) => (b.ended_at ?? 0) - (a.ended_at ?? 0)),
  };
}

/**
 * A calm day-line for an episode in the symptoms list.
 *   - open episode → "day 2 · started monday"-ish ("day N")
 *   - closed episode (`closed`=true) → "ran 2 days"
 */
export function elapsedDaysLabel(
  ep: Episode,
  now: number,
  closed = false,
): string {
  if (closed && typeof ep.ended_at === 'number') {
    const summary = summarizeEpisode(ep, { now });
    const d = Math.max(1, summary.duration_days);
    return `ran ${d} day${d === 1 ? '' : 's'}`;
  }
  const d = Math.max(1, elapsedDays(ep, now) + 1);
  return `day ${d}`;
}

// ─── episode view-model ──────────────────────────────────────────────────────

export interface EpisodeMedLine {
  /** "ibuprofen" */
  name: string;
  /** the dose, or null */
  dose: string | null;
  /** "mon · 2:10pm" */
  when: string;
}

export interface EpisodeCheckIn {
  /** the severity 1..5 */
  severity: number;
  /** "mon am" — a short label for the arc */
  label: string;
}

export interface EpisodeVM {
  /** does an episode actually exist to render? */
  exists: boolean;
  /** "headache" */
  name: string;
  /** "day 2 · started monday · acute" */
  dayLine: string;
  /** the severity check-ins, oldest first */
  checkIns: EpisodeCheckIn[];
  /** meds logged, oldest first */
  meds: EpisodeMedLine[];
  /** the recap shown before close */
  recap: {
    days: number;
    checkIns: number;
    peak: number | null;
    meds: number;
  };
}

/** a small "mon am" / "now" label per check-in for the arc */
function checkInLabel(ts: number, isLast: boolean): string {
  if (isLast) return 'now';
  const wd = weekdayShort(ts);
  const half = new Date(ts).getHours() < 12 ? 'am' : 'pm';
  return `${wd} ${half}`;
}

export function episodeVM(ep: Episode | null, now: number): EpisodeVM {
  if (!ep || typeof ep.started_at !== 'number') {
    return {
      exists: false,
      name: '',
      dayLine: '',
      checkIns: [],
      meds: [],
      recap: { days: 0, checkIns: 0, peak: null, meds: 0 },
    };
  }
  const days = Math.max(1, elapsedDays(ep, now) + 1);
  const dayLine = `day ${days} · started ${weekdayOf(ep.started_at)}${
    ep.kind ? ` · ${ep.kind}` : ''
  }`;

  const sevLog = Array.isArray(ep.severity_log) ? ep.severity_log : [];
  const checkIns: EpisodeCheckIn[] = sevLog.map((s, i) => ({
    severity: Math.max(1, Math.min(5, s.severity)),
    label: checkInLabel(s.ts, i === sevLog.length - 1),
  }));

  const medList = Array.isArray(ep.meds) ? ep.meds : [];
  const meds: EpisodeMedLine[] = medList.map((m) => ({
    name: m.name || 'med',
    dose: m.dose ?? null,
    when: dayClock(m.ts),
  }));

  const summary = summarizeEpisode(ep, { now });
  return {
    exists: true,
    name: ep.label || 'episode',
    dayLine,
    checkIns,
    meds,
    recap: {
      days: Math.max(1, summary.duration_days),
      checkIns: summary.n_severity_logs,
      peak: summary.max_severity > 0 ? summary.max_severity : null,
      meds: summary.n_meds,
    },
  };
}

// ─── conditions & treatment view-model ───────────────────────────────────────

export interface TreatmentTrackNode {
  /** the 1-based cycle index */
  index: number;
  /** done = before the current cycle */
  state: 'done' | 'now' | 'ahead';
}

export interface TreatmentVM {
  id: string;
  label: string;
  /** "cycle 3 of 6 · day 4 of this cycle" */
  positionLine: string;
  /** the current cycle (1-based), 0 if the plan hasn't started */
  currentCycle: number;
  /** total cycles */
  totalCycles: number;
  /** the cycle track nodes */
  track: TreatmentTrackNode[];
  /** is the plan complete? */
  finished: boolean;
}

export interface ConditionsVM {
  conditions: string[];
  plans: TreatmentVM[];
}

/** the local-tz day-count helper for treatment positioning */
const DAY_MS = 86_400_000;

export function treatmentVM(plan: TreatmentPlan, now: number): TreatmentVM {
  const total = Math.max(1, plan.total_cycles || 1);
  const starts = Array.isArray(plan.cycle_starts)
    ? plan.cycle_starts.slice().sort((a, b) => a - b)
    : [];

  // which cycle are we in? (1-based) — 0 means not yet started
  let current = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= now) current = i + 1;
  }
  current = Math.min(current, total);
  const finished = current >= total && starts.length >= total;

  const lastStart = current > 0 ? starts[current - 1] : null;
  const dayOfCycle =
    lastStart != null ? Math.floor((now - lastStart) / DAY_MS) + 1 : 0;

  const positionLine =
    current === 0
      ? `not yet started · ${total} cycles planned`
      : `cycle ${current} of ${total} · day ${dayOfCycle} of this cycle`;

  const track: TreatmentTrackNode[] = [];
  for (let i = 1; i <= total; i++) {
    track.push({
      index: i,
      state: i < current ? 'done' : i === current ? 'now' : 'ahead',
    });
  }

  return {
    id: plan.id,
    label: plan.label || 'treatment',
    positionLine,
    currentCycle: current,
    totalCycles: total,
    track,
    finished,
  };
}

export function conditionsVM(slices: BodySlices, now: number): ConditionsVM {
  return {
    conditions: Array.isArray(slices.conditions) ? slices.conditions : [],
    plans: (Array.isArray(slices.treatmentPlans) ? slices.treatmentPlans : [])
      .filter((p) => p && p.id)
      .map((p) => treatmentVM(p, now)),
  };
}

// ─── doctor-summary view-model ───────────────────────────────────────────────

export interface DoctorSummaryVM {
  /** is there an episode to summarize? */
  exists: boolean;
  /** "the headache episode" */
  episodeLabel: string;
  /** the rendered markdown brief — `generateDoctorSummary` output */
  markdown: string;
  /** a short factual tldr line */
  tldr: string;
  /** the severity arc points 1..5, oldest first */
  severityArc: number[];
  /** day labels for the arc */
  arcLabels: string[];
  /** the meds taken — k/v lines */
  meds: { when: string; what: string }[];
}

/** "tue 13 may" — a calm date for the doctor-summary tldr */
function briefDate(ts: number): string {
  const d = new Date(ts);
  const months = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  ];
  return `${weekdayShort(ts)} ${d.getDate()} ${months[d.getMonth()]}`;
}

/**
 * The doctor-summary view-model. The episode is the OPEN episode if there
 * is one, else the most-recently-ended one. The brief markdown is the SAME
 * `generateDoctorSummary` output the live `ActiveEpisodeCard` exports — so
 * what the doctor-summary screen shows == what "copy" / ".md" gives you.
 *
 * `history` carries the cross-module context (sleep / cycle / dumps). The
 * preview wires the sleep records cleanly; cycle phases + dumps are passed
 * through when available — `generateDoctorSummary` simply omits any context
 * section it has no data for, so an empty history is honest, not broken.
 */
export function doctorSummaryVM(
  slices: BodySlices,
  now: number,
  history?: DoctorSummaryHistory,
): DoctorSummaryVM {
  const episodes = Array.isArray(slices.episodes) ? slices.episodes : [];
  const open = activeEpisode(episodes);
  const closedSorted = closedEpisodes(episodes)
    .slice()
    .sort((a, b) => (b.ended_at ?? 0) - (a.ended_at ?? 0));
  const ep = open ?? closedSorted[0] ?? null;

  if (!ep) {
    return {
      exists: false,
      episodeLabel: '',
      markdown: '',
      tldr: '',
      severityArc: [],
      arcLabels: [],
      meds: [],
    };
  }

  const markdown = generateDoctorSummary(ep, history ?? {}, {
    now,
    userName: slices.userName ?? undefined,
  });

  const sevLog = Array.isArray(ep.severity_log) ? ep.severity_log : [];
  const severityArc = sevLog.map((s) => Math.max(1, Math.min(5, s.severity)));
  const arcLabels = sevLog.map((s, i) =>
    i === sevLog.length - 1 ? 'now' : checkInLabel(s.ts, false),
  );

  const summary = summarizeEpisode(ep, { now });
  const ended = typeof ep.ended_at === 'number';
  const endTs = ended ? (ep.ended_at as number) : now;
  const durDays = Math.max(1, summary.duration_days);
  const sevSeq = severityArc.join(' → ');
  const tldr =
    `the ${ep.label || 'episode'} ${ended ? 'ran' : 'has run'} ` +
    `${durDays} day${durDays === 1 ? '' : 's'} ` +
    `(${briefDate(ep.started_at)} – ${briefDate(endTs)})` +
    (sevLog.length > 0
      ? `, logged ${sevLog.length} time${sevLog.length === 1 ? '' : 's'}` +
        (severityArc.length > 0
          ? `. severity moved ${sevSeq} on a self-rated 1–5 scale; ` +
            `it peaked at ${summary.max_severity} of 5.`
          : '.')
      : '.');

  const meds = (Array.isArray(ep.meds) ? ep.meds : []).map((m) => ({
    when: dayClock(m.ts),
    what: `${m.name || 'med'}${m.dose ? ` ${m.dose}` : ''}`,
  }));

  return {
    exists: true,
    episodeLabel: ep.label || 'episode',
    markdown,
    tldr,
    severityArc,
    arcLabels,
    meds,
  };
}

// ─── patterns view-model ─────────────────────────────────────────────────────

export interface PatternLine {
  id: string;
  /** the section the observation groups under */
  group: 'intake' | 'episodes' | 'pacing' | 'cross';
  /** the one-line observation */
  line: string;
  /** the calm reframe under it */
  frame: string;
}

export interface PatternsVM {
  patterns: PatternLine[];
}

const GROUP_LABELS: Record<PatternLine['group'], string> = {
  intake: "water & the body's signals",
  episodes: 'your episodes',
  pacing: 'pacing & your energy',
  cross: 'across your modules',
};

export function patternGroupLabel(group: PatternLine['group']): string {
  return GROUP_LABELS[group];
}

/** the group order the patterns screen renders sections in */
export const PATTERN_GROUP_ORDER: PatternLine['group'][] = [
  'intake',
  'episodes',
  'pacing',
  'cross',
];

/** which group a body-pattern key belongs in */
function groupForPattern(p: AnyBodyPattern): PatternLine['group'] {
  switch (p.pattern) {
    case 'headache-hydration':
    case 'hyperfocus_dehydration':
    case 'interoception_drift':
    case 'hunger_thirst_confusion':
    case 'supplement_drift':
      return 'intake';
    case 'afternoon_crash_window':
    case 'movement_gap':
    case 'meal_skip':
      return 'pacing';
    case 'symptom_phase_coupling':
    case 'sleep_debt_symptom_lag':
    case 'caffeine_water_tradeoff':
    case 'gi_cycle_phase':
      return 'cross';
    case 'multi_symptom_recurrence':
    case 'vasomotor_pattern':
      return 'episodes';
    default:
      return 'intake';
  }
}

/**
 * A calm reframe line per pattern kind — the gentle sub-line under the
 * observation. The orchestrator's `copy` is the observation; this is the
 * "it's a pattern, not a verdict" softener the mockup pairs with it.
 */
function frameForPattern(p: AnyBodyPattern): string {
  switch (p.pattern) {
    case 'headache-hydration':
      return 'a fairly steady link — water might be worth reaching for earlier on those days.';
    case 'hyperfocus_dehydration':
      return "flow can quietly switch thirst off — it's the focus, not forgetfulness.";
    case 'interoception_drift':
      return 'your body may not be flagging thirst on a regular clock — an external nudge can stand in.';
    case 'hunger_thirst_confusion':
      return 'hunger and thirst signals can cross — worth a pause before deciding which it is.';
    case 'supplement_drift':
      return 'routines slip quietly — naming it is the easiest way to catch it early.';
    case 'afternoon_crash_window':
      return 'a real afternoon dip — something to schedule around, not push through.';
    case 'movement_gap':
      return 'not laziness — moving often just needs an extra planning step the brain skips.';
    case 'meal_skip':
      return 'a skipped meal has a cost later — worth knowing the pattern is there.';
    case 'multi_symptom_recurrence':
      return 'they may be one thing wearing several names. worth mentioning as a set.';
    case 'vasomotor_pattern':
      return 'a recurring physical pattern — a fact to bring to a clinician, not to fix alone.';
    case 'symptom_phase_coupling':
      return "body × cycle — that week runs differently, it isn't you slipping.";
    case 'sleep_debt_symptom_lag':
      return 'body × sleep — the next-day weight is often the sleep, not a new problem.';
    case 'caffeine_water_tradeoff':
      return 'body × intake — the two trade off; one quietly displaces the other.';
    case 'gi_cycle_phase':
      return 'body × cycle — a recurring window, worth knowing before it arrives.';
    default:
      return 'a quiet pattern ollie noticed — not an instruction, just a fact.';
  }
}

/**
 * Compose the observed body patterns into calm one-line journal entries.
 * Reads the orchestrator-written `body.patterns` slice — the SAME slice the
 * live `BodyNoticed` panel renders. The orchestrator's `copy` field is the
 * observation; `frameForPattern` pairs the gentle reframe under it.
 */
export function patternsVM(slices: BodySlices): PatternsVM {
  const list = Array.isArray(slices.patterns) ? slices.patterns : [];
  const out: PatternLine[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || typeof p.pattern !== 'string' || typeof p.copy !== 'string') {
      continue;
    }
    out.push({
      id: `${p.pattern}-${i}`,
      group: groupForPattern(p),
      line: p.copy,
      frame: frameForPattern(p),
    });
  }
  return { patterns: out };
}

/** the short pattern-count teaser for the body face's observation row */
export function patternSummary(slices: BodySlices): string | null {
  const { patterns } = patternsVM(slices);
  if (patterns.length < PATTERN_MIN) return null;
  return 'a few things ollie noticed about your body';
}
