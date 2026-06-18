/**
 * @ollie/orchestrator · body-weekly
 *
 * computeWeeklyReview: aggregate 7 days of body/habits/sleep/cycle/supplement/water
 * data into a structured summary + deadpan copy.
 *
 * Emits `body:weekly_review` once per calendar week (Sunday ISO week dedup).
 * Triggered client-side when the user is online Sunday ~19:00 local time via
 * scheduleWeeklyReview(). Server cron wire-up is a follow-up (see workers/cron).
 *
 * Sparse-data threshold: < 5 habit completion entries in the past 7 days.
 */

import type { Store } from '@ollie/store';
import * as events from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';

// ─── types ──────────────────────────────────────────────────────────────────

export interface WeeklyReviewInput {
  now: number;
  /** Habit objects from shared.habits_v2 */
  habits: Array<{
    id: string;
    name: string;
    cueTime?: string;
    completions?: Array<{ ts: number }>;
  }>;
  /** Sleep records from sleep.records */
  sleepRecords: Array<{ ts?: number; night_of?: string; tst_min?: number; hours?: number; is_skipped?: boolean }>;
  /** Cycle items from cycle.items */
  cycleItems?: Array<{ ts: number; action: string }>;
  /** Supplement entries from body.supplements */
  supplements?: Array<{ name: string; checked_dates?: string[]; added_at?: number }>;
  /** Water log from body.water_log */
  waterLog?: Array<number | { ts: number; glasses?: number }>;
}

export interface WeeklyReviewSummary {
  habitsCompleted: number;
  habitsTotal: number;
  /** ISO weekday (0=Sun..6=Sat) skipped most often, or null */
  mostSkippedWeekday: string | null;
  sleepAvgHours: number | null;
  sleepNightsLogged: number;
  cyclePhaseAtEnd: string | null;
  supplementAdherencePct: number | null;
  waterAvgCups: number | null;
  isSparse: boolean;
}

export interface WeeklyReviewResult {
  summary: WeeklyReviewSummary;
  copy: string;
  weekStartTs: number;
  weekEndTs: number;
}

// ─── constants ──────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Habit entries below this threshold → sparse copy path. */
export const SPARSE_THRESHOLD = 5;

// ─── helpers ────────────────────────────────────────────────────────────────

function startOfWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // back to Sunday
  return d.getTime();
}

function endOfWeek(weekStart: number): number {
  return weekStart + 7 * DAY_MS - 1;
}

function entryTs(w: number | { ts: number; glasses?: number }): number {
  return typeof w === 'number' ? w : (w?.ts ?? 0);
}

// ─── computeWeeklyReview ────────────────────────────────────────────────────

export function computeWeeklyReview(input: WeeklyReviewInput): WeeklyReviewResult {
  const { now, habits, sleepRecords, cycleItems, supplements, waterLog } = input;

  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(weekStart);
  const window7Start = now - 7 * DAY_MS;

  // ── habits ───────────────────────────────────────────────────────────────
  // Total = number of habit-days expected: habits.length * 7
  const habitsTotal = habits.length * 7;
  let habitsCompleted = 0;
  // Track skipped days per weekday index
  const skippedByWeekday: number[] = [0, 0, 0, 0, 0, 0, 0];

  // For each habit, check which of the 7 days had a completion
  for (const habit of habits) {
    const completedDays = new Set<number>(); // day offset 0-6 from weekStart
    for (const c of habit.completions ?? []) {
      if (typeof c?.ts === 'number' && c.ts >= weekStart && c.ts <= weekEnd) {
        const dayOffset = Math.floor((c.ts - weekStart) / DAY_MS);
        completedDays.add(Math.min(dayOffset, 6));
        habitsCompleted++;
      }
    }
    // Mark skipped days
    for (let d = 0; d < 7; d++) {
      if (!completedDays.has(d)) {
        skippedByWeekday[d]++;
      }
    }
  }

  // Most skipped weekday: the day with highest skipped count (only if > 0)
  let mostSkippedWeekday: string | null = null;
  if (habits.length > 0) {
    let maxSkips = 0;
    let maxDay = -1;
    for (let d = 0; d < 7; d++) {
      if (skippedByWeekday[d] > maxSkips) {
        maxSkips = skippedByWeekday[d];
        maxDay = d;
      }
    }
    // Only surface if at least half the habits were skipped on that day
    if (maxDay >= 0 && maxSkips >= Math.ceil(habits.length / 2)) {
      mostSkippedWeekday = WEEKDAYS[maxDay];
    }
  }

  // Sparse detection: total completions across all habits in window
  const totalCompletionEntries = habits.reduce(
    (sum, h) => sum + (h.completions ?? []).filter(
      (c) => typeof c?.ts === 'number' && c.ts >= window7Start && c.ts <= now,
    ).length,
    0,
  );
  const isSparse = totalCompletionEntries < SPARSE_THRESHOLD;

  // ── sleep ────────────────────────────────────────────────────────────────
  const weekSleepRecords = sleepRecords.filter((r) => {
    if (r.night_of) {
      const t = new Date(r.night_of + 'T12:00:00').getTime();
      return t >= weekStart && t <= weekEnd;
    }
    const t = r.ts ?? 0;
    return t >= weekStart && t <= weekEnd;
  });

  const sleepHours = weekSleepRecords
    .filter((r) => !r.is_skipped)
    .map((r) => {
      if (typeof r.hours === 'number') return r.hours;
      if (typeof r.tst_min === 'number') return r.tst_min / 60;
      return null;
    })
    .filter((h): h is number => h !== null && h > 0);

  const sleepAvgHours = sleepHours.length > 0
    ? Math.round((sleepHours.reduce((s, h) => s + h, 0) / sleepHours.length) * 10) / 10
    : null;
  const sleepNightsLogged = sleepHours.length;

  // ── cycle phase at end of week ───────────────────────────────────────────
  let cyclePhaseAtEnd: string | null = null;
  if (Array.isArray(cycleItems) && cycleItems.length > 0) {
    const lastCycleItem = [...cycleItems]
      .filter((i) => i.ts <= now)
      .sort((a, b) => b.ts - a.ts)[0];
    if (lastCycleItem) cyclePhaseAtEnd = lastCycleItem.action;
  }

  // ── supplement adherence ─────────────────────────────────────────────────
  let supplementAdherencePct: number | null = null;
  if (Array.isArray(supplements) && supplements.length > 0) {
    let totalExpected = 0;
    let totalChecked = 0;
    for (const s of supplements) {
      // Count days in the 7-day window where this supplement was checked
      const checkedInWindow = (s.checked_dates ?? []).filter((d) => {
        const t = new Date(d + 'T12:00:00').getTime();
        return t >= weekStart && t <= weekEnd;
      }).length;
      totalExpected += 7;
      totalChecked += checkedInWindow;
    }
    supplementAdherencePct = totalExpected > 0
      ? Math.round((totalChecked / totalExpected) * 100)
      : null;
  }

  // ── water average ────────────────────────────────────────────────────────
  let waterAvgCups: number | null = null;
  if (Array.isArray(waterLog) && waterLog.length > 0) {
    const weekWater = waterLog.filter((w) => {
      const t = entryTs(w);
      return t >= weekStart && t <= weekEnd;
    });
    if (weekWater.length > 0) {
      // Count total cups (each entry = 1 cup unless glasses field present)
      const totalCups = weekWater.reduce<number>((sum, w) => {
        let glasses = 1;
        if (typeof w === 'object' && w !== null) {
          const g = (w as { glasses?: number }).glasses;
          if (typeof g === 'number') glasses = g;
        }
        return sum + glasses;
      }, 0);
      waterAvgCups = Math.round((totalCups / 7) * 10) / 10;
    }
  }

  // ── build summary ────────────────────────────────────────────────────────
  const summary: WeeklyReviewSummary = {
    habitsCompleted,
    habitsTotal,
    mostSkippedWeekday,
    sleepAvgHours,
    sleepNightsLogged,
    cyclePhaseAtEnd,
    supplementAdherencePct,
    waterAvgCups,
    isSparse,
  };

  // ── copy generation ──────────────────────────────────────────────────────
  const copy = buildCopy(summary, habitsTotal);

  return { summary, copy, weekStartTs: weekStart, weekEndTs: weekEnd };
}

// ─── copy builder ───────────────────────────────────────────────────────────

function buildCopy(summary: WeeklyReviewSummary, habitsTotal: number): string {
  if (summary.isSparse) {
    return 'first week in. give it a bit more time.';
  }

  const parts: string[] = [];

  // habits line
  if (habitsTotal > 0) {
    parts.push(`this week: ${summary.habitsCompleted} of ${summary.habitsTotal} habits.`);
  }

  // pick 1-2 interesting patterns
  const patterns: string[] = [];

  // skipped day pattern
  if (summary.mostSkippedWeekday) {
    patterns.push(`patterns: workouts skipped ${summary.mostSkippedWeekday}s.`);
  }

  // sleep pattern (only if we have data and it's notable)
  if (summary.sleepAvgHours !== null && summary.sleepNightsLogged >= 3) {
    const avg = summary.sleepAvgHours;
    if (avg < 6) {
      patterns.push(`sleep averaged ${avg}h — short week.`);
    } else if (avg >= 8) {
      patterns.push(`sleep averaged ${avg}h.`);
    }
  }

  // supplement adherence (only if below 70%)
  if (summary.supplementAdherencePct !== null && summary.supplementAdherencePct < 70) {
    patterns.push(`supplements: ${summary.supplementAdherencePct}% this week.`);
  }

  // water (only if notably low)
  if (summary.waterAvgCups !== null && summary.waterAvgCups < 4) {
    patterns.push(`water averaged ${summary.waterAvgCups} cups/day.`);
  }

  // surface at most 2 patterns
  const surfaced = patterns.slice(0, 2);
  if (surfaced.length > 0) {
    parts.push(...surfaced);
  }

  parts.push("that's information.");

  return parts.join(' ');
}

// ─── weekly scheduler (client-side, Sunday 19:00) ──────────────────────────

/**
 * Compute the next Sunday 19:00 local time timestamp from `now`.
 * If today is Sunday and it's before 19:00 local, returns today's 19:00.
 */
export function nextSunday19(now: number): number {
  const d = new Date(now);
  const dayOfWeek = d.getDay(); // 0=Sun
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const target = new Date(d);
  target.setDate(d.getDate() + daysUntilSunday);
  target.setHours(19, 0, 0, 0);
  // If we're past 19:00 on Sunday already, push to next Sunday
  if (target.getTime() <= now) {
    target.setDate(target.getDate() + 7);
  }
  return target.getTime();
}

/**
 * ISO week key for dedup: YYYY-Www (ISO 8601 week).
 * Two computes in the same ISO week return the same key.
 *
 * THE canonical impl — UTC-based (#146). body-correlations.ts and goals.ts
 * import this rather than carrying their own copies, so a date never maps to
 * two different week keys depending on which detector computed it. UTC is the
 * right frame for a cross-module dedupe key: it's stable regardless of the
 * runtime's local timezone or DST.
 */
export function isoWeekKey(ts: number): string {
  const d = new Date(ts);
  // ISO week: Monday = day 1; shift so Monday is 0.
  const day = (d.getUTCDay() + 6) % 7;
  // Nearest Thursday (ISO rule: a week belongs to the year of its Thursday).
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - day + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ─── emit helper ────────────────────────────────────────────────────────────

export interface WeeklyReviewEmitOptions {
  store: Store;
  now: () => number;
  scheduleNotification?: ((spec: NotificationSpec, fireAt: number) => void) | null;
}

/**
 * Compute + emit body:weekly_review from current store state.
 * Deduped per ISO week via body._weeklyReviewEmittedWeek store key.
 * Returns true if emitted, false if already done this week or data missing.
 */
export function emitWeeklyReview(opts: WeeklyReviewEmitOptions): boolean {
  const { store, now: getNow, scheduleNotification } = opts;
  const now = getNow();
  const weekKey = isoWeekKey(now);

  // Dedup check
  const lastEmittedKey = store.get<string>('body', '_weeklyReviewEmittedWeek', '') ?? '';
  if (lastEmittedKey === weekKey) return false;

  // Read store state
  const habits = store.get<WeeklyReviewInput['habits']>('shared', 'habits_v2', []) ?? [];
  const sleepRecords = store.get<WeeklyReviewInput['sleepRecords']>('sleep', 'records', []) ?? [];
  const cycleItems = store.get<WeeklyReviewInput['cycleItems']>('cycle', 'items', []) ?? [];
  const supplements = store.get<WeeklyReviewInput['supplements']>('body', 'supplements', []) ?? [];
  const waterLog = store.get<WeeklyReviewInput['waterLog']>('body', 'water_log', []) ?? [];

  const result = computeWeeklyReview({
    now,
    habits,
    sleepRecords,
    cycleItems,
    supplements,
    waterLog,
  });

  // Emit event
  try {
    events.emit('body:weekly_review', {
      ts: now,
      weekStartTs: result.weekStartTs,
      weekEndTs: result.weekEndTs,
      copy: result.copy,
      summary: result.summary,
    });
  } catch { /* non-fatal */ }

  // Mark as emitted for this week
  store.set('body', '_weeklyReviewEmittedWeek', weekKey);

  // Schedule APNs push — fires immediately since we're running at 19:00
  if (scheduleNotification) {
    try {
      scheduleNotification(
        {
          title: result.copy,
          body: '',
          category: 'CONTENT_DELIVERY',
          dedupe_key: `body:weekly_review:${weekKey}`,
          aggregation_group: undefined,
        },
        now,
      );
    } catch { /* non-fatal */ }
  }

  return true;
}

/**
 * Wire a client-side Sunday 19:00 local scheduler.
 * On init, schedules a timeout for the next Sunday 19:00.
 * Re-schedules after each fire.
 * Returns a teardown function.
 */
export function scheduleWeeklyReview(
  opts: WeeklyReviewEmitOptions & { now: () => number },
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Floor for any re-arm delay (audit #93). A setTimeout can fire early on
  // suspend/resume or clock skew; without a floor a recomputed near-zero
  // delay would busy-loop arm() → setTimeout(0) → arm() ... burning CPU.
  const MIN_REARM_MS = 60_000;

  function arm(): void {
    const now = opts.now();
    const fireAt = nextSunday19(now);
    // Pure scheduling delay must never be floored below 0, but we cap the
    // tiny end so a fire-and-immediately-rearm can't spin.
    const delay = Math.max(0, fireAt - now);
    timer = setTimeout(() => {
      timer = null;
      // Only treat this as a real fire if the clock has actually reached
      // the target. An early fire (skew/resume) re-arms instead of emitting.
      if (opts.now() >= fireAt) {
        emitWeeklyReview(opts);
        // After a genuine fire, re-arm for next week with a floored delay so
        // a clock that's still at/just-past 19:00 can't tight-loop.
        rearmFloored();
      } else {
        rearmFloored();
      }
    }, delay);
  }

  function rearmFloored(): void {
    const now = opts.now();
    const fireAt = nextSunday19(now);
    const delay = Math.max(MIN_REARM_MS, fireAt - now);
    timer = setTimeout(() => {
      timer = null;
      if (opts.now() >= fireAt) emitWeeklyReview(opts);
      rearmFloored();
    }, delay);
  }

  arm();

  return () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
}
