/**
 * admin-v2 · selectors — pure view-models over the live admin store
 *
 * Every screen of the v2 admin preview derives its content here, from the
 * SAME `@ollie/logic/admin` pure detectors + `admin.*` store slices the live
 * `AdminModule` reads + writes. No rendering, no hooks — just `AdminSlices`
 * in, view-models out. This is the seam that keeps the redesign a UI rebuild,
 * not a fork: the data + logic layer is untouched, only the rendering changes.
 *
 * Mirrors body-v2/selectors.ts in spirit: small, tested, deterministic
 * (every fn that needs the wall clock takes an explicit `now`).
 */
import {
  scheduleRenewalCues,
  detectStaleBall,
  detectLast5Pct,
  detectTwoMinuteTask,
  detectDeferChain,
  detectRecurringPattern,
  efCost,
} from '@ollie/logic/admin';
import type { AdminTask, EFState } from '@ollie/logic/admin';

const DAY_MS = 86_400_000;

// ─── store shapes ────────────────────────────────────────────────────────────

/**
 * One admin task as the live `AdminModule` stores it on `admin.tasks`. It is
 * the `AdminTask` shape from `@ollie/logic/admin` plus the few legacy/runtime
 * fields the live module appends (`title`, `due`, `recur`, `phone_assist`,
 * `ts`, `status`). Read defensively — old store rows may carry either the
 * legacy `title`/`status` or the canonical `label`/`state`.
 */
export interface AdminItem extends AdminTask {
  title?: string;
  due?: string | null;
  recur?: string;
  note?: string | null;
  status?: string;
  phone_assist?: boolean;
  ts?: number;
  action?: string;
  last_done_at?: number;
}

/** everything the v2 admin screens read from the store */
export interface AdminSlices {
  /** the task list — `admin.tasks` (the live module's source of truth) */
  tasks: AdminItem[];
}

// ─── small formatters ────────────────────────────────────────────────────────

const WEEKDAYS_FULL = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];
const MONTHS_FULL = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** "june 17, 2026" — the calm date the add screen and task page show */
export function fmtLongDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_FULL[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "monday, may 18" — the lock-screen clock day line */
export function fmtClockDay(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAYS_FULL[d.getDay()]}, ${MONTHS_FULL[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

/**
 * The display title of a task — `label`, else legacy `title`, else a quiet
 * fallback. Trimmed.
 */
export function taskTitle(t: AdminItem | null | undefined): string {
  if (!t) return 'a task';
  const lbl = typeof t.label === 'string' && t.label.trim() ? t.label.trim() : null;
  if (lbl) return lbl;
  const ttl = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : null;
  return ttl ?? 'a task';
}

/**
 * The canonical task state. The live module migrates legacy `status: 'done'`
 * → `state: 'closed'`, but old un-migrated rows can still be in the store, so
 * resolve defensively: explicit `state` wins, else map legacy `status`.
 */
export function taskState(t: AdminItem | null | undefined): string {
  if (!t) return 'active';
  if (typeof t.state === 'string' && t.state) return t.state;
  if (t.status === 'done') return 'closed';
  return 'active';
}

/** is the task finished (done or closed)? — it leaves the active list */
export function isFinished(t: AdminItem | null | undefined): boolean {
  const s = taskState(t);
  return s === 'done' || s === 'closed';
}

/**
 * The expiry/due timestamp of a task in ms, or null. Prefers the canonical
 * numeric `expiry_ts`; falls back to parsing the legacy `due` ISO string.
 */
export function taskDueTs(t: AdminItem | null | undefined): number | null {
  if (!t) return null;
  if (typeof t.expiry_ts === 'number' && Number.isFinite(t.expiry_ts)) {
    return t.expiry_ts;
  }
  if (typeof t.eta_at === 'number' && Number.isFinite(t.eta_at)) {
    return t.eta_at;
  }
  if (typeof t.due === 'string' && t.due) {
    const ms = new Date(`${t.due}T00:00:00`).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  if (typeof t.scheduled_at === 'number' && Number.isFinite(t.scheduled_at)) {
    return t.scheduled_at;
  }
  return null;
}

/** whole days from `now` to `ts` (negative = overdue) */
export function daysLeft(ts: number, now: number): number {
  return Math.ceil((ts - now) / DAY_MS);
}

/**
 * A calm relative-days line — "30 days", "tomorrow", "today", "3 weeks",
 * "5d overdue". Never a countdown alarm; factual.
 */
export function relDays(n: number | null): string {
  if (n == null) return 'no date';
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n <= 13) return `${n} days`;
  if (n <= 60) return `${Math.round(n / 7)} weeks`;
  if (n <= 365) return `${Math.round(n / 30)} months`;
  return `${Math.round(n / 365)} years`;
}

/** "added 2 weeks ago" — a calm age line for the task page */
export function relAge(ts: number | null | undefined, now: number): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'added recently';
  const d = Math.floor((now - ts) / DAY_MS);
  if (d <= 0) return 'added today';
  if (d === 1) return 'added yesterday';
  if (d <= 13) return `added ${d} days ago`;
  if (d <= 60) return `added ${Math.round(d / 7)} weeks ago`;
  if (d <= 365) return `added ${Math.round(d / 30)} months ago`;
  return `added ${Math.round(d / 365)} years ago`;
}

/** "11 days" waiting line for a call / a stale ball */
export function waitedDays(sinceTs: number | null | undefined, now: number): number {
  if (typeof sinceTs !== 'number' || !Number.isFinite(sinceTs)) return 0;
  return Math.max(0, Math.floor((now - sinceTs) / DAY_MS));
}

// ─── ball-state grammar ──────────────────────────────────────────────────────

/** the resolved ball state of a task — MINE / THEIRS / WAITING */
export type BallTag = 'MINE' | 'THEIRS' | 'WAITING';

/** resolve a task's ball state, defaulting to MINE (the live module default) */
export function ballOf(t: AdminItem | null | undefined): BallTag {
  const b = t?.ball_state;
  if (b === 'THEIRS' || b === 'WAITING') return b;
  return 'MINE';
}

/** the calm words for a ball state — used in task sub-lines */
export function ballWords(ball: BallTag): string {
  if (ball === 'THEIRS') return 'with them';
  if (ball === 'WAITING') return 'on its way';
  return 'yours to move';
}

/** the one-sentence ball line on the task page */
export function ballSentence(ball: BallTag): string {
  if (ball === 'THEIRS') return 'the ball is theirs — waiting on someone else';
  if (ball === 'WAITING') return 'the ball is parked — waiting on a date or a thing to land';
  return 'the ball is yours — nothing to wait on';
}

// ─── face view-model ─────────────────────────────────────────────────────────

/** the calm minimum pattern count before the observation row earns its place */
export const PATTERN_MIN = 1;

/** the four renewal-runway stages, in order, with their day thresholds */
export const RUNWAY_STAGES = [
  { label: '90', days: 90 },
  { label: '30', days: 30 },
  { label: '7', days: 7 },
  { label: '0', days: 0 },
] as const;

export interface FaceVM {
  /** has anything at all been added? (drives the cold copy) */
  hasAnyData: boolean;
  /** the next thing due — the hero. null when nothing has a date */
  nextDue: {
    id: string;
    title: string;
    /** "renewal" — the category line */
    category: string;
    /** whole days left (can be negative) */
    days: number;
    /** the calm "30 days left" line */
    daysLine: string;
    /** is it a renewal (drives the runway being meaningful)? */
    isRenewal: boolean;
    /**
     * the runway marker position 0..1 — where this renewal sits on the
     * 90→0 day track. 1 = at 90 days out (start), 0 = due/overdue.
     */
    runwayPos: number;
  } | null;
  /** count of active tasks */
  activeCount: number;
  /** count of active tasks due within 7 days */
  dueThisWeek: number;
  /** count of phone-assist calls still waiting */
  callCount: number;
  /** count of sub-2-minute active tasks ready for a burst */
  burstCount: number;
  /** a one-line pattern teaser, or null when nothing is observed */
  patternLine: string | null;
}

/**
 * The clamped runway position for a renewal. The runway track spans 90 days
 * out (left, pos=1) to due (right, pos=0). Anything past 90 days clamps to
 * the start; anything overdue clamps to the end.
 */
export function runwayPosition(days: number): number {
  if (days >= 90) return 1;
  if (days <= 0) return 0;
  return days / 90;
}

export function faceVM(slices: AdminSlices, now: number): FaceVM {
  const tasks = Array.isArray(slices.tasks) ? slices.tasks : [];
  const active = tasks.filter((t) => t && !isFinished(t));

  // the next thing due — the active task with the soonest due date
  let nextDue: FaceVM['nextDue'] = null;
  let soonest = Infinity;
  for (const t of active) {
    if (!t?.id) continue;
    const due = taskDueTs(t);
    if (due == null) continue;
    if (due < soonest) {
      soonest = due;
      const days = daysLeft(due, now);
      const isRenewal = t.kind === 'renewal';
      nextDue = {
        id: t.id,
        title: taskTitle(t),
        category: typeof t.category === 'string' && t.category ? t.category : 'task',
        days,
        daysLine:
          days < 0
            ? `${Math.abs(days)} days overdue`
            : days === 0
              ? 'due today'
              : `${days} day${days === 1 ? '' : 's'} left`,
        isRenewal,
        runwayPos: runwayPosition(days),
      };
    }
  }

  const dueThisWeek = active.filter((t) => {
    const due = taskDueTs(t);
    return due != null && daysLeft(due, now) >= 0 && daysLeft(due, now) <= 7;
  }).length;

  const callCount = selectCalls(slices).length;
  const twoMin = detectTwoMinuteTask({ tasks: active, now }, { now });
  const burstCount = twoMin ? twoMin.count : 0;

  const patternLine = patternSummary(slices, now);

  return {
    hasAnyData: tasks.length > 0,
    nextDue,
    activeCount: active.length,
    dueThisWeek,
    callCount,
    burstCount,
    patternLine,
  };
}

// ─── tasks-list view-model ───────────────────────────────────────────────────

export interface TaskRow {
  id: string;
  title: string;
  /** the ball state */
  ball: BallTag;
  /** the calm sub-line — ball words + category / wait */
  sub: string;
  /** the right-aligned days-left line */
  daysLine: string;
  /** is the days line "soon" (umber)? */
  soon: boolean;
  /** is the task finished (done/closed)? — demoted, struck */
  done: boolean;
}

export type TaskFilter = 'active' | 'done' | 'all';

export interface TasksVM {
  /** the rows under the current filter, ordered by days-left */
  rows: TaskRow[];
  /** the live filter counts */
  counts: { active: number; done: number; all: number };
}

/** the calm sub-line for a task row */
function taskSubLine(t: AdminItem, now: number): string {
  const ball = ballOf(t);
  if (isFinished(t)) {
    const at = typeof t.closed_at === 'number'
      ? t.closed_at
      : typeof t.done_at === 'number'
        ? t.done_at
        : t.ts ?? now;
    const d = Math.max(0, Math.floor((now - at) / DAY_MS));
    return `done · ${d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`}`;
  }
  const cat = typeof t.category === 'string' && t.category ? t.category : 'task';
  if (ball === 'THEIRS') {
    const since = typeof t.last_transition_at === 'number' ? t.last_transition_at : t.ts;
    const d = waitedDays(since, now);
    return d > 0 ? `with them · ${d} days · ${cat}` : `with them · ${cat}`;
  }
  if (ball === 'WAITING') {
    return `on its way · ${cat}`;
  }
  return `yours to move · ${cat}`;
}

/** the right-aligned days line for a task row */
function taskDaysLine(t: AdminItem, now: number): { line: string; soon: boolean } {
  if (isFinished(t)) return { line: 'done', soon: false };
  const ball = ballOf(t);
  if (ball === 'THEIRS') return { line: 'their move', soon: false };
  const due = taskDueTs(t);
  if (due == null) return { line: 'no date', soon: false };
  const n = daysLeft(due, now);
  return { line: relDays(n), soon: n <= 7 };
}

export function tasksVM(
  slices: AdminSlices,
  filter: TaskFilter,
  now: number,
): TasksVM {
  const tasks = (Array.isArray(slices.tasks) ? slices.tasks : []).filter(
    (t) => t && t.id,
  );
  const active = tasks.filter((t) => !isFinished(t));
  const done = tasks.filter((t) => isFinished(t));

  const pool =
    filter === 'active' ? active : filter === 'done' ? done : tasks;

  // order: unfinished by days-left ascending (no-date last), then finished
  const rows: TaskRow[] = pool
    .slice()
    .sort((a, b) => {
      const af = isFinished(a);
      const bf = isFinished(b);
      if (af !== bf) return af ? 1 : -1;
      const ad = taskDueTs(a);
      const bd = taskDueTs(b);
      if (ad == null && bd == null) return (b.ts ?? 0) - (a.ts ?? 0);
      if (ad == null) return 1;
      if (bd == null) return -1;
      return ad - bd;
    })
    .map((t) => {
      const days = taskDaysLine(t, now);
      return {
        id: t.id,
        title: taskTitle(t),
        ball: ballOf(t),
        sub: taskSubLine(t, now),
        daysLine: days.line,
        soon: days.soon,
        done: isFinished(t),
      };
    });

  return {
    rows,
    counts: { active: active.length, done: done.length, all: tasks.length },
  };
}

// ─── task-detail view-model ──────────────────────────────────────────────────

export interface TaskDocRefVM {
  label: string;
  link: string;
}

export interface TaskDetailVM {
  /** does the task exist to render? */
  exists: boolean;
  id: string;
  title: string;
  /** the lead — the category */
  category: string;
  /** "30 days left · added 2 weeks ago" */
  meta: string;
  /** the ball state */
  ball: BallTag;
  /** the one-sentence ball line */
  ballSentence: string;
  /** how many times the task has been deferred */
  deferCount: number;
  /** the calm defer-row value line */
  deferLine: string;
  /** is the task already finished? */
  finished: boolean;
  /** has it been split into GATHER/FILL (so the split row is hidden)? */
  alreadySplit: boolean;
  /** the attached document references */
  docs: TaskDocRefVM[];
}

export function taskDetailVM(
  slices: AdminSlices,
  taskId: string | null,
  now: number,
): TaskDetailVM {
  const tasks = Array.isArray(slices.tasks) ? slices.tasks : [];
  const t = taskId ? tasks.find((x) => x && x.id === taskId) ?? null : null;
  if (!t) {
    return {
      exists: false,
      id: '',
      title: '',
      category: '',
      meta: '',
      ball: 'MINE',
      ballSentence: '',
      deferCount: 0,
      deferLine: '',
      finished: false,
      alreadySplit: false,
      docs: [],
    };
  }

  const due = taskDueTs(t);
  const days = due != null ? daysLeft(due, now) : null;
  const daysPart =
    days == null
      ? 'no date set'
      : days < 0
        ? `${Math.abs(days)} days overdue`
        : days === 0
          ? 'due today'
          : `${days} day${days === 1 ? '' : 's'} left`;
  const meta = `${daysPart} · ${relAge(t.ts, now)}`;

  const deferCount = typeof t.defer_count === 'number' ? t.defer_count : 0;
  const deferLine =
    deferCount === 0
      ? 'push it out a week · not deferred yet'
      : `push it out a week · deferred ${deferCount} time${deferCount === 1 ? '' : 's'} so far`;

  const docs: TaskDocRefVM[] = (Array.isArray(t.doc_refs) ? t.doc_refs : [])
    .filter((r): r is { label: string; link: string } =>
      r != null && typeof r.label === 'string' && r.label.trim().length > 0,
    )
    .map((r) => ({
      label: r.label.trim(),
      link: typeof r.link === 'string' && r.link.trim() ? r.link.trim() : 'link',
    }));

  return {
    exists: true,
    id: t.id,
    title: taskTitle(t),
    category: typeof t.category === 'string' && t.category ? t.category : 'task',
    meta,
    ball: ballOf(t),
    ballSentence: ballSentence(ballOf(t)),
    deferCount,
    deferLine,
    finished: isFinished(t),
    alreadySplit: Boolean(t.stage) || Boolean(t.parent_task_id),
    docs,
  };
}

// ─── calls view-model ────────────────────────────────────────────────────────

export interface CallRow {
  id: string;
  title: string;
  /** whole days the call has waited */
  waited: number;
  /** the calm "waiting · 11 days" line */
  waitLine: string;
  /** the oldest waiting call wears a warm umber wait */
  oldest: boolean;
}

/**
 * The phone-call cluster — tasks tagged `phone_assist`, open, oldest-waiting
 * first (mirrors the live `selectPhoneTasks` selector). Each is one ADHD-
 * aversive thing surfaced gently.
 */
export function selectCalls(slices: AdminSlices): AdminItem[] {
  const tasks = Array.isArray(slices.tasks) ? slices.tasks : [];
  return tasks
    .filter((t) => {
      if (!t || t.phone_assist !== true) return false;
      if (!t.id) return false;
      if (!t.title && !t.label) return false;
      return !isFinished(t);
    })
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
}

export function callsVM(slices: AdminSlices, now: number): { calls: CallRow[] } {
  const list = selectCalls(slices);
  return {
    calls: list.map((t, i) => {
      const waited = waitedDays(t.ts, now);
      return {
        id: t.id,
        title: taskTitle(t),
        waited,
        waitLine: waited > 0 ? `waiting · ${waited} days` : 'waiting · today',
        oldest: i === 0,
      };
    }),
  };
}

// ─── 2-min burst view-model ──────────────────────────────────────────────────

export interface BurstTask {
  id: string;
  title: string;
}

export interface BurstVM {
  /** every sub-2-min active task in the session, in store order */
  tasks: BurstTask[];
}

/**
 * The 2-minute burst session — every active task with `duration_min <= 2`.
 * Reads through `detectTwoMinuteTask` from `@ollie/logic/admin` so the
 * session contents == what the orchestrator's burst-prompt would batch.
 */
export function burstVM(slices: AdminSlices, now: number): BurstVM {
  const tasks = (Array.isArray(slices.tasks) ? slices.tasks : []).filter(
    (t) => t && t.id && !isFinished(t),
  );
  const sig = detectTwoMinuteTask({ tasks, now }, { now });
  if (!sig) return { tasks: [] };
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return {
    tasks: sig.task_ids
      .map((id) => byId.get(id))
      .filter((t): t is AdminItem => Boolean(t))
      .map((t) => ({ id: t.id, title: taskTitle(t) })),
  };
}

// ─── add view-model ──────────────────────────────────────────────────────────

/** the kind options on the add screen */
export const KIND_OPTIONS = [
  { value: 'task', label: 'task', hint: 'a thing to do once' },
  { value: 'renewal', label: 'renewal', hint: 'expires on a date' },
] as const;

/** the category options on the add screen */
export const CATEGORY_OPTIONS = [
  'renewal', 'appointment', 'maintenance', 'financial', 'other',
] as const;

/** the recurrence options on the add screen — value + display label */
export const RECUR_OPTIONS: { value: string; label: string }[] = [
  { value: 'month', label: 'monthly' },
  { value: 'quarter', label: 'quarterly' },
  { value: 'year', label: 'yearly' },
  { value: '2year', label: '2 years' },
  { value: '5year', label: '5 years' },
  { value: '10year', label: '10 years' },
];

// ─── patterns view-model ─────────────────────────────────────────────────────

export interface PatternLine {
  key: string;
  /** the one-line observation */
  line: string;
  /** the calm reframe under it */
  frame: string;
  /** the barely-there citation tag */
  cite: string;
}

/** one quietly-labelled group of observations */
export interface PatternGroup {
  label: string;
  lines: PatternLine[];
}

export interface PatternsVM {
  groups: PatternGroup[];
  /**
   * true when the groups are the canonical spec set (the cross-module EF
   * detectors need history the preview store doesn't carry) — the screen
   * is honest about it. Mirrors habits-v2's `isExample`.
   */
  isExample: boolean;
}

/**
 * The canonical "see the rest" observation set, lifted verbatim from
 * admin-patterns.html. The reflective A-series detectors (A1 open-loop,
 * A11 EF-tier match, A13 decision recall, A15 schedule-drift) need a full
 * cross-module dump + decision-rule history the preview store doesn't
 * cleanly carry. The detectors that DO run on the live `admin.tasks` slice
 * (A6 defer-chain, A10 recurring-annual, A12 last-5%) are surfaced live by
 * `livePatternGroups` below; the rest stand in as this honestly-labelled
 * example gallery — the screen says so plainly via `isExample`.
 */
const EXAMPLE_GROUPS: PatternGroup[] = [
  {
    label: "what's still costing you",
    lines: [
      {
        key: 'open-loop',
        line: 'you said "i should sort the lease" — but never a when or where',
        frame:
          "an intention with no plan keeps running in the background. it's the openness, not the task, that tires you.",
        cite: 'A1 · open loop — Masicampo & Baumeister, 2011',
      },
      {
        key: 'ef-match',
        line: "the passport call is a tier-5 task, and right now you're in a crash window",
        frame:
          "that's a mismatch, not a failure — a tier-1 task (one tap) would land. the call will keep till you're at flow.",
        cite: 'A11 · activation-cost match — Barkley, 2012',
      },
    ],
  },
  {
    label: 'where things stall',
    lines: [
      {
        key: 'defer-chain',
        line: '"file taxes" has been deferred 6 times now',
        frame:
          'six defers is a signal, not laziness — something about it is structurally hard. naming the block is the move: phone? form? a conversation?',
        cite: 'A6 · defer-chain — Steel, 2007',
      },
      {
        key: 'schedule-drift',
        line: 'you scheduled "sort the filing cabinet" three weeks in a row, and did it none of them',
        frame:
          "scheduling and doing are not the same thing. a recurring slot that never fires isn't a plan — it's a place the task hides.",
        cite: 'A15 · schedule-drift — Gollwitzer, 1999',
      },
      {
        key: 'last-5pct',
        line: "the visa form is filled — but it's been 8 days and never marked closed",
        frame:
          "the last 5% — the mailing, the sending — is its own task. done isn't closed until the loop is fully shut.",
        cite: 'A12 · last-five-percent — Allen, 2001',
      },
    ],
  },
  {
    label: 'what you already worked out',
    lines: [
      {
        key: 'decision-recall',
        line: 'last time the registration came up, you decided to renew online, not by mail',
        frame:
          "you've solved this before — no need to re-decide it from scratch. the call you made still holds.",
        cite: 'A13 · decision recall — Vohs et al., 2008',
      },
      {
        key: 'recurring',
        line: 'last march you renewed the car registration — that time of year again',
        frame:
          "a yearly rhythm ollie spotted from your own history. it'll surface, ready to go, before it's late.",
        cite: 'A10 · recurring-annual — Einstein & McDaniel, 2005',
      },
    ],
  },
];

/**
 * Patterns derived live from the `admin.tasks` slice — the three detectors
 * that need only the task list (A6 defer-chain, A10 recurring-annual, A12
 * last-5%). Returns an empty array when nothing is observed; the screen then
 * falls back to the honest example gallery.
 */
function livePatternGroups(slices: AdminSlices, now: number): PatternGroup[] {
  const tasks = Array.isArray(slices.tasks) ? slices.tasks : [];
  if (tasks.length === 0) return [];

  const stall: PatternLine[] = [];
  const worked: PatternLine[] = [];

  const defers = detectDeferChain({ tasks, now }, { now });
  if (Array.isArray(defers)) {
    for (const d of defers) {
      stall.push({
        key: `defer-${d.task_id}`,
        line: d.copy,
        frame:
          'a defer-chain is a signal, not laziness — something about it is structurally hard. naming the block is the move.',
        cite: 'A6 · defer-chain — Steel, 2007',
      });
    }
  }

  const last5 = detectLast5Pct({ tasks, now }, { now });
  if (Array.isArray(last5)) {
    for (const l of last5) {
      stall.push({
        key: `last5-${l.task_id}`,
        line: l.copy,
        frame:
          "the last 5% — the mailing, the sending — is its own task. done isn't closed until the loop is fully shut.",
        cite: 'A12 · last-five-percent — Allen, 2001',
      });
    }
  }

  const recurring = detectRecurringPattern({ tasks, now }, { now });
  if (Array.isArray(recurring)) {
    for (const r of recurring) {
      worked.push({
        key: `recur-${r.category_or_label}`,
        line: r.copy,
        frame:
          "a yearly rhythm ollie spotted from your own history. it'll surface, ready to go, before it's late.",
        cite: 'A10 · recurring-annual — Einstein & McDaniel, 2005',
      });
    }
  }

  const groups: PatternGroup[] = [];
  if (stall.length > 0) groups.push({ label: 'where things stall', lines: stall });
  if (worked.length > 0) {
    groups.push({ label: 'what you already worked out', lines: worked });
  }
  return groups;
}

/**
 * The patterns ("see the rest") view-model. When the live task-only
 * detectors observe anything, those real groups are returned. Otherwise the
 * canonical spec example set is returned and `isExample` is set — the screen
 * says so plainly.
 */
export function patternsVM(slices: AdminSlices, now: number): PatternsVM {
  const live = livePatternGroups(slices, now);
  if (live.length > 0) return { groups: live, isExample: false };
  return { groups: EXAMPLE_GROUPS, isExample: true };
}

/** the short pattern teaser for the admin face's observation row */
export function patternSummary(slices: AdminSlices, now: number): string | null {
  const live = livePatternGroups(slices, now);
  const total = live.reduce((s, g) => s + g.lines.length, 0);
  if (total >= PATTERN_MIN) {
    return 'a few things ollie noticed about your admin';
  }
  return null;
}

// ─── notifications view-model ────────────────────────────────────────────────

export interface NotificationCard {
  key: string;
  /** which glyph the lock-screen card shows */
  glyph: 'renewal' | 'appointment' | 'staleball' | 'mail' | 'recurring' | 'clock' | 'weekly';
  /** "thursday, may 21" */
  day: string;
  /** "11:20" */
  time: string;
  /** the bold notification title */
  title: string;
  /** the calm body line */
  body: string;
  /** "now" / "sun 6pm" */
  when: string;
}

/**
 * The notification reel — the seven pushes admin sends, exactly the set
 * admin-notifications.html shows. This is a presentation surface (like the
 * other v2 modules' notification reels): the copy is real and lifted from
 * the detectors' voice, but the seven cards are an honest curated reel, not
 * a live feed. Reported as a presentation stub.
 */
export function notificationsVM(now: number): { cards: NotificationCard[] } {
  const day = (offset: number) => fmtClockDay(now + offset * DAY_MS);
  return {
    cards: [
      {
        key: 'renewal-cue',
        glyph: 'renewal',
        day: day(0),
        time: '9:41',
        title: 'passport · expires in 30 days',
        body: "a month's runway. a good week to start.",
        when: 'now',
      },
      {
        key: 'appointment',
        glyph: 'appointment',
        day: day(2),
        time: '6:00',
        title: 'dentist · tomorrow, 2:00pm',
        body: "just so it's not a surprise in the morning.",
        when: 'now',
      },
      {
        key: 'stale-ball',
        glyph: 'staleball',
        day: day(3),
        time: '11:20',
        title: "the lawyer's had your file · 16 days",
        body: 'past their usual turnaround — a nudge is fair.',
        when: 'now',
      },
      {
        key: 'last-5pct',
        glyph: 'mail',
        day: day(7),
        time: '8:45',
        title: "the form's filled — did it get mailed?",
        body: "done and closed aren't the same. just checking.",
        when: 'now',
      },
      {
        key: 'recurring',
        glyph: 'recurring',
        day: day(11),
        time: '10:10',
        title: 'last march you renewed the registration',
        body: 'that time of year again — want it on the list?',
        when: 'now',
      },
      {
        key: 'defer-chain',
        glyph: 'clock',
        day: day(15),
        time: '3:30',
        title: 'taxes — deferred a few times now',
        body: "not a nag. what's the thing actually blocking it?",
        when: 'now',
      },
      {
        key: 'weekly',
        glyph: 'weekly',
        day: day(20),
        time: '6:00',
        title: 'your week in admin — 4 done, 2 due ahead',
        body: 'a quiet recap. arrives only if you asked for it.',
        when: 'sun 6pm',
      },
    ],
  };
}

// ─── shared re-exports for screens / tests ───────────────────────────────────

export {
  scheduleRenewalCues,
  detectStaleBall,
  detectLast5Pct,
  efCost,
};
export type { AdminTask, EFState };
