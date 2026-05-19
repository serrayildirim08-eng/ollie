/**
 * habits-v2 · selectors — pure view-models over the live habits store
 *
 * Every screen of the v2 habits preview derives its content here, from the
 * SAME `shared.habits_v2` store slice the live `HabitsModule` reads + writes
 * (a `StoredHabit[]` — each with a `cueTime` and a `completions` log of
 * `{ts}` marks), plus the orchestrator-written `habits.patterns` slice. No
 * rendering, no hooks — just `HabitsSlices` in, view-models out. This is the
 * seam that keeps the redesign a UI rebuild.
 *
 * Mirrors medication-v2/selectors.ts in spirit: small, tested, deterministic
 * (every fn that needs the wall clock takes an explicit `now`).
 *
 * Core principle, baked in: NO streaks, NO grid wall, NO "you missed" /
 * completion-count shame. The day is a calm ledger — "just today".
 */
import type { Habit, HabitCompletion } from '@ollie/logic/habits';

// ─── store shapes ────────────────────────────────────────────────────────────

/** the cue-time bucket — when a habit's cue tends to land */
export type CueTime = 'morning' | 'anytime' | 'evening';

/**
 * One habit as the live `HabitsModule` stores it in `shared.habits_v2`:
 * a `Habit` plus the v2 `cueTime` bucket the module added. The completion
 * log is a list of `{ts}` marks (the module also tolerates `habit_id`).
 */
export interface StoredHabit extends Habit {
  cueTime?: CueTime;
  completions?: HabitCompletion[];
}

/** one orchestrator-written habit pattern — `habits.patterns` entries */
export interface PatternEntry {
  pattern: string;
  confidence?: string;
  sample_n?: number;
  copy: string;
  copy_es?: string;
  source?: { citation: string; url?: string };
}

/** everything the v2 habits screens read from the store */
export interface HabitsSlices {
  /** the tracked habits — `shared.habits_v2` */
  habits: StoredHabit[];
  /** the orchestrator-written noticed-patterns — `habits.patterns` */
  patterns: PatternEntry[];
}

// ─── the seeded defaults ─────────────────────────────────────────────────────

/**
 * The 6 habits ollie seeds on first run. Mirrors `HabitsModule.DEFAULT_HABITS`
 * verbatim so the cold-start v2 face shows the SAME starting shape the live
 * module does — the store key + seed are shared, not forked.
 */
export const DEFAULT_HABITS: StoredHabit[] = [
  { id: 'h_teeth', name: 'brush teeth', cue: 'after waking', cueTime: 'morning', completions: [] },
  { id: 'h_water', name: 'drink water', cue: 'before coffee', cueTime: 'morning', completions: [] },
  { id: 'h_vitd', name: 'vitamin d', cue: 'when coffee', cueTime: 'morning', completions: [] },
  { id: 'h_move', name: 'move', cue: 'before the sun sets', cueTime: 'anytime', completions: [] },
  { id: 'h_meds', name: 'evening meds', cue: 'after dinner', cueTime: 'evening', completions: [] },
  { id: 'h_wind', name: 'wind down', cue: 'after ten', cueTime: 'evening', completions: [] },
];

// ─── small helpers ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** the cue-time bucket, defaulting to 'anytime' as the live module does */
export function cueTimeOf(h: StoredHabit): CueTime {
  return h.cueTime === 'morning' || h.cueTime === 'evening' ? h.cueTime : 'anytime';
}

/** the habit's display name — `name`, else `label`, else a quiet fallback */
export function habitName(h: StoredHabit): string {
  const n = (h.name ?? h.label ?? '').trim();
  return n || 'a habit';
}

/** the completion log as a clean, ts-sorted array */
function completionsOf(h: StoredHabit): HabitCompletion[] {
  return (Array.isArray(h.completions) ? h.completions : [])
    .filter((c): c is HabitCompletion => !!c && typeof c.ts === 'number')
    .sort((a, b) => a.ts - b.ts);
}

/** the midnight-floored day key for an epoch-ms `ts` */
function dayFloor(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** has this habit been checked in today? (a completion with today's date) */
export function checkedToday(h: StoredHabit, now: number): boolean {
  const today = dayFloor(now);
  return completionsOf(h).some((c) => dayFloor(c.ts) === today);
}

/** the most recent completion of a habit, or null */
function lastCompletion(h: StoredHabit): HabitCompletion | null {
  const c = completionsOf(h);
  return c.length > 0 ? c[c.length - 1] : null;
}

/** whole days since the habit was last checked in, or null when never */
function daysSinceLast(h: StoredHabit, now: number): number | null {
  const last = lastCompletion(h);
  if (!last) return null;
  return Math.round((dayFloor(now) - dayFloor(last.ts)) / DAY_MS);
}

/** "yesterday" — a calm, factual recency label, never a streak */
export function lastLabel(h: StoredHabit, now: number): string {
  const d = daysSinceLast(h, now);
  if (d === null) return 'never';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  const w = Math.floor(d / 7);
  return `${w} week${w === 1 ? '' : 's'} ago`;
}

/** the cue line for a habit, or "" when no cue is set */
export function cueOf(h: StoredHabit): string {
  return (h.cue ?? '').trim();
}

// ─── cue-time ordering ───────────────────────────────────────────────────────

/** the cue-time buckets, in the order the day runs */
export const CUE_ORDER: CueTime[] = ['morning', 'anytime', 'evening'];

/** the short badge for a cue-time — MOR / ANY / EVE */
export function cueBadge(t: CueTime): string {
  return t === 'morning' ? 'MOR' : t === 'evening' ? 'EVE' : 'ANY';
}

/** the visible habits, ordered morning → anytime → evening, stable within */
export function orderedHabits(slices: HabitsSlices): StoredHabit[] {
  const list = (Array.isArray(slices.habits) ? slices.habits : []).filter(
    (h) => h && h.id,
  );
  const out: StoredHabit[] = [];
  for (const bucket of CUE_ORDER) {
    for (const h of list) {
      if (cueTimeOf(h) === bucket) out.push(h);
    }
  }
  return out;
}

// ─── face view-model ─────────────────────────────────────────────────────────

/** the day's waiting-dot states — one per habit */
export type WaitDotState = 'done' | 'now' | 'waiting';

export interface HabitsFaceVM {
  /** has the user ever checked anything in / changed the seed? drives cold copy */
  hasHistory: boolean;
  /** is every habit done for today? */
  allDone: boolean;

  // ── the hero — the single next check-in ──
  /** is there a habit still to check in today? */
  hasNext: boolean;
  /** the lead line — "next, when you can" warm / "first up, when you can" cold */
  lead: string;
  /** the next habit's name, large — or a calm all-done line */
  nextName: string;
  /** the next habit's cue — the anchor it hangs from, or "" */
  nextCue: string;
  /** the id of the next habit (to check in against) */
  nextId: string | null;

  // ── the progress arc ──
  /** habits checked in today */
  doneCount: number;
  /** total habits on file */
  totalCount: number;
  /** the centre label under the count — "done today" / "the day's ahead" */
  centreLabel: string;
  /** the waiting-dot row — one per habit, in day order */
  waitDots: WaitDotState[];
  /** "3 still waiting · no rush" — the calm waiting line */
  waitLine: string;

  // ── the all-habits drill row ──
  /** "6 on file · morning to evening" */
  allLine: string;

  // ── the patterns ("see the rest") drill row ──
  /** is a pattern live? (the orchestrator has written one) */
  hasPattern: boolean;
  /** the patterns row glance line */
  patternLine: string;
}

/**
 * The habits face view-model. The hero is ONE focus — the single next
 * check-in: in day order (morning → anytime → evening), the first habit not
 * yet checked in today. If every habit is done — or there are none — the
 * hero falls back to a calm all-done state. No streak, no grid: the
 * progress arc is a quiet ledger of today, the waiting row counts what
 * *waits*, never what was missed.
 */
export function habitsFaceVM(slices: HabitsSlices, now: number): HabitsFaceVM {
  const habits = orderedHabits(slices);
  const totalCount = habits.length;

  // any completion at all anywhere → the user has used habits before
  const hasHistory = habits.some((h) => completionsOf(h).length > 0);

  const done = habits.filter((h) => checkedToday(h, now));
  const doneCount = done.length;
  const pending = habits.filter((h) => !checkedToday(h, now));
  const next = pending[0] ?? null;
  const hasNext = next != null;
  const allDone = totalCount > 0 && pending.length === 0;

  // the waiting-dot row — done / now (the next one) / waiting, in day order
  const waitDots: WaitDotState[] = habits.map((h) => {
    if (checkedToday(h, now)) return 'done';
    if (next && h.id === next.id) return 'now';
    return 'waiting';
  });

  // the waiting line — counts what waits, never what was missed
  const waitN = pending.length;
  let waitLine: string;
  if (totalCount === 0) {
    waitLine = 'nothing waiting yet';
  } else if (waitN === 0) {
    waitLine = "every habit's in · the rest of the day is yours";
  } else if (!hasHistory) {
    waitLine = `${waitN} waiting · no rush, no order`;
  } else {
    waitLine = `${waitN} still waiting · no rush`;
  }

  // the all-habits glance — span the day's cue-times present
  const buckets = new Set(habits.map((h) => cueTimeOf(h)));
  const spansMorning = buckets.has('morning');
  const spansEvening = buckets.has('evening');
  const span =
    spansMorning && spansEvening
      ? 'morning to evening'
      : spansMorning
        ? 'across the morning'
        : spansEvening
          ? 'into the evening'
          : 'through the day';
  const allLine =
    totalCount === 0
      ? 'none on file yet'
      : hasHistory
        ? `${totalCount} on file · ${span}`
        : `${totalCount} to start with · ${span}`;

  // the patterns ("see the rest") row — driven by the orchestrator slice
  const patterns = Array.isArray(slices.patterns) ? slices.patterns : [];
  const hasPattern = patterns.length > 0;
  const patternLine = hasPattern
    ? 'a few things ollie noticed about your habits'
    : 'patterns warm up after a few days';

  return {
    hasHistory,
    allDone,

    hasNext,
    lead: hasHistory ? 'next, when you can' : 'first up, when you can',
    nextName: next
      ? habitName(next)
      : totalCount > 0
        ? "that's everything for today"
        : 'no habits yet',
    nextCue: next ? cueOf(next) : '',
    nextId: next ? next.id : null,

    doneCount,
    totalCount,
    centreLabel: doneCount > 0 ? 'done today' : "the day's ahead",
    waitDots,
    waitLine,

    allLine,

    hasPattern,
    patternLine,
  };
}

// ─── all-habits view-model ───────────────────────────────────────────────────

/** one recent-day dot in the all-habits soft record */
export type RecentDot = 'on' | 'off' | 'today';

/** one habit, as the all-habits screen renders it */
export interface HabitRow {
  id: string;
  name: string;
  /** the cue line — the anchor, or "" */
  cue: string;
  /** the cue-time bucket */
  cueTime: CueTime;
  /** the MOR / ANY / EVE badge */
  badge: string;
  /** the last `RECENT_DAYS` days, oldest → today: a soft sage-dot record */
  recent: RecentDot[];
  /** "yesterday" — the calm recency note */
  last: string;
  /** checked in today */
  doneToday: boolean;
}

/** one cue-time section of the all-habits screen */
export interface HabitSection {
  cueTime: CueTime;
  /** "morning" — the lowercase section label */
  label: string;
  rows: HabitRow[];
}

export interface AllHabitsVM {
  sections: HabitSection[];
  /** anything to render at all? */
  hasHabits: boolean;
}

/** the all-habits soft record spans the last week */
export const RECENT_DAYS = 7;

/** the set of midnight-day-keys a habit was checked in on */
function completionDaySet(h: StoredHabit): Set<number> {
  const s = new Set<number>();
  for (const c of completionsOf(h)) s.add(dayFloor(c.ts));
  return s;
}

/**
 * The all-habits view-model — habits grouped by cue-time, each carrying a
 * soft `RECENT_DAYS`-day record of sage dots (a day it happened = on, a day
 * it didn't = off, today = an open ring). NEVER a grid wall, NEVER a streak
 * number — just the gentle texture of recent days.
 */
export function allHabitsVM(slices: HabitsSlices, now: number): AllHabitsVM {
  const habits = orderedHabits(slices);
  const today = dayFloor(now);

  const sections: HabitSection[] = CUE_ORDER.map((bucket) => {
    const rows: HabitRow[] = habits
      .filter((h) => cueTimeOf(h) === bucket)
      .map((h) => {
        const days = completionDaySet(h);
        const recent: RecentDot[] = [];
        for (let i = RECENT_DAYS - 1; i >= 0; i--) {
          const dayKey = today - i * DAY_MS;
          if (i === 0) recent.push('today');
          else recent.push(days.has(dayKey) ? 'on' : 'off');
        }
        return {
          id: h.id,
          name: habitName(h),
          cue: cueOf(h),
          cueTime: bucket,
          badge: cueBadge(bucket),
          recent,
          last: lastLabel(h, now),
          doneToday: checkedToday(h, now),
        };
      });
    return { cueTime: bucket, label: bucket, rows };
  }).filter((s) => s.rows.length > 0);

  return { sections, hasHabits: habits.length > 0 };
}

// ─── add view-model ──────────────────────────────────────────────────────────

/** the three cue-time tiles the add screen offers */
export interface CueTimeTile {
  value: CueTime;
  label: string;
}

export const CUE_TIME_TILES: CueTimeTile[] = [
  { value: 'morning', label: 'morning' },
  { value: 'anytime', label: 'anytime' },
  { value: 'evening', label: 'evening' },
];

// ─── patterns ("see the rest") view-model ────────────────────────────────────

/** one observation line on the "see the rest" surface */
export interface PatternLine {
  /** a stable key */
  key: string;
  /** the one-line observation, ink */
  line: string;
  /** the soft sub-line reframe, muted — never a verdict */
  frame: string;
}

/** one quietly-labelled group of observations */
export interface PatternGroup {
  /** the small uppercase group label */
  label: string;
  lines: PatternLine[];
}

export interface PatternsVM {
  groups: PatternGroup[];
  /**
   * true when the groups are the canonical spec set (the orchestrator
   * hasn't written any real patterns yet) — the screen is honest about it.
   */
  isExample: boolean;
}

/**
 * The canonical "see the rest" observation set, lifted verbatim from
 * habits-patterns.html. The habit pattern detectors (`detectPatterns` +
 * tier-1/phase-2/cross-module) need a full cross-module history the preview
 * store doesn't always carry; the orchestrator runs them and writes the
 * result to `habits.patterns`. Until it has, this is the honest example
 * gallery — the screen labels it as such (an `isExample` presentation stub,
 * like the notifications reel).
 */
const EXAMPLE_GROUPS: PatternGroup[] = [
  {
    label: 'what makes them stick',
    lines: [
      {
        key: 'externalization',
        line: 'your cued habits land far more often than the un-cued ones',
        frame:
          'a habit hanging off something that already happens does the remembering for you — that’s not willpower, it’s design.',
      },
      {
        key: 'keystone',
        line: 'on days "drink water" happens, four other habits happen more',
        frame:
          'that one looks like a keystone — the anchor the rest of the day hangs off.',
      },
      {
        key: 'friction',
        line: '"wind down" tends to stall on tuesdays',
        frame:
          'friction has a shape — and one weekday wearing it is easier to plan around than to push through.',
      },
      {
        key: 'body-vs-cog',
        line: 'your body habits land more easily than the thinking ones',
        frame:
          'brush teeth, move, water — the body is the anchor; cognitive habits can borrow its momentum.',
      },
    ],
  },
  {
    label: 'when your week is different',
    lines: [
      {
        key: 'luteal',
        line: 'in your luteal phase, fewer habits land — and that’s expected',
        frame:
          'your brain really is different that week. this is scaling expectations, not standards — the bar can move with you.',
      },
      {
        key: 'stress',
        line: 'deadline weeks pull your habit count down',
        frame:
          'stress crowds the small things out. on a week like this, a "stress mode" of body-only habits is enough.',
      },
      {
        key: 'sleep',
        line: 'after nights under 6 hours, fewer habits get checked off',
        frame:
          'sleep × habits — a tired day asks for a lighter list, not a harder push. a prosthetic environment beats willpower.',
      },
      {
        key: 'hyperfocus',
        line: 'long deep-focus days cost some of the next day’s habits',
        frame:
          'hyperfocus × habits — the dip after is crash and recovery, not failure.',
      },
      {
        key: 'med-coupling',
        line: 'on days you mention meds, your habits run a little higher',
        frame:
          'habits × medication — worth knowing, not a rule. the meds aren’t doing the habits; they’re clearing the runway.',
      },
    ],
  },
  {
    label: 'how a habit lives and returns',
    lines: [
      {
        key: 'rebirth',
        line: 'three of your habits came back after a long pause',
        frame:
          'habits don’t die for you — they cycle. a restart isn’t starting over, it’s the habit returning.',
      },
      {
        key: 'drift',
        line: 'your habit count this fortnight sits below the two before it',
        frame:
          'a data point, not a data trend — fortnights move, and one quiet one doesn’t mean anything yet.',
      },
      {
        key: 'fresh-start',
        line: 'habits you started on a monday or the 1st tend to go quiet first',
        frame:
          'the landmark is a fine doorway in — the leverage point is the re-entry, not the launch date.',
      },
      {
        key: 'interest-hijack',
        line: 'a few of your habits paused together when a new interest arrived',
        frame:
          'interest hijack — not a collapse. ollie can pause them officially so they’re waiting, not failing.',
      },
    ],
  },
  {
    label: 'what you tell yourself',
    lines: [
      {
        key: 'identity',
        line:
          'you’ve written about not being "a morning person" more than doing the habit',
        frame:
          'identity framing — the story can run ahead of the evidence. the habit gets to write its own.',
      },
      {
        key: 'self-talk',
        line: 'after a hard-on-yourself note, your habits dip for a couple of days',
        frame:
          'self-talk × habits — the harsh voice costs more than it corrects. softer tends to land better.',
      },
      {
        key: 'sensory',
        line: 'skip days cluster with mentions of noise, bright light or feeling "too much"',
        frame:
          'before prescribing the habit, prescribe the conditions — the room can be the thing in the way.',
      },
    ],
  },
];

/**
 * The patterns ("see the rest") view-model. When the orchestrator has
 * written real patterns into `habits.patterns`, they are surfaced as one
 * quiet "what ollie noticed" group. Otherwise the canonical spec example
 * set is returned and `isExample` is set — the screen says so plainly.
 */
export function patternsVM(slices: HabitsSlices): PatternsVM {
  const patterns = (Array.isArray(slices.patterns) ? slices.patterns : []).filter(
    (p) => p && typeof p.copy === 'string' && p.copy.trim(),
  );
  if (patterns.length === 0) {
    return { groups: EXAMPLE_GROUPS, isExample: true };
  }
  return {
    groups: [
      {
        label: 'what ollie noticed',
        lines: patterns.map((p, i) => ({
          key: p.pattern || `pattern-${i}`,
          line: p.copy.trim(),
          frame:
            p.source?.citation?.trim() ||
            `${p.confidence ?? 'medium'} confidence · ${p.sample_n ?? 0} samples`,
        })),
      },
    ],
    isExample: false,
  };
}
