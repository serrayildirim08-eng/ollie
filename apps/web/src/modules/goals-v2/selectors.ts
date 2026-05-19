/**
 * goals-v2 · selectors — pure view-models over the live goals store
 *
 * Every screen of the v2 goals preview derives its content here, from the
 * SAME `goals.*` store slices the live `GoalsModule` reads + writes, and
 * the SAME `@ollie/logic/goals` pure detectors. No rendering, no hooks —
 * just `GoalsSlices` in, view-models out. This is the seam that keeps the
 * redesign a UI rebuild, not a fork: the data + logic layer is untouched,
 * only the rendering changes.
 *
 * Mirrors admin-v2/selectors.ts in spirit: small, tested, deterministic
 * (every fn that needs the wall clock takes an explicit `now`).
 *
 * TONE — goals + ADHD is a shame minefield. These view-models are forward
 * and kind by construction: progress, never a streak; the next milestone,
 * never a deadline scold; a stalled goal is read as neurology, never as a
 * failing. The grammar here enforces that — no "you haven't", no "behind".
 */
import {
  detectGoalVelocityByCategory,
  detectGoalInterference,
  detectIdentityDrift,
  detectResearchAsProgress,
  detectSunkCostFlag,
} from '@ollie/logic/goals';
import type {
  Goal,
  GoalCategory,
  Milestone,
  GoalSession,
  GoalReview,
  DumpEntry,
} from '@ollie/logic/goals';

const DAY_MS = 86_400_000;

// ─── store shapes ────────────────────────────────────────────────────────────

/**
 * One goal as the live `GoalsModule` stores it on `goals.items`. It is the
 * `Goal` shape from `@ollie/logic/goals` plus the few legacy/runtime fields
 * the live module appends (`title`, `why`, string `target_date`, nullable
 * obstacle/premortem/ulysses). Read defensively — old store rows may carry
 * either `label` or legacy `title`.
 */
export interface GoalItem extends Omit<Goal, 'obstacle' | 'premortem' | 'ulysses_contract' | 'role' | 'target_date_ts'> {
  title?: string;
  why?: string;
  target_date?: string | null;
  target_date_ts?: number | null;
  obstacle?: string | null;
  premortem?: string | null;
  ulysses_contract?: string | null;
  role?: string | null;
  status?: string;
  status_at?: number;
  paused_until?: number;
  created_at?: number;
  category?: GoalCategory;
  progress?: number;
  milestones?: Milestone[];
  steps?: string[];
}

/** everything the v2 goals screens read from the store */
export interface GoalsSlices {
  /** the goal list — `goals.items` (the live module's source of truth) */
  goals: GoalItem[];
  /** thinking / doing session tags — `goals.sessions` */
  sessions: GoalSession[];
  /** weekly check-ins — `goals.reviews` */
  reviews: GoalReview[];
  /** dump entries scanned by the echo detectors — `goals.dumps` */
  dumps: DumpEntry[];
}

// ─── small formatters + resolvers ────────────────────────────────────────────

const MONTHS_FULL = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const WEEKDAYS_FULL = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** "march 2" — the calm short date the goal page and contract show */
export function fmtShortDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_FULL[d.getMonth()]} ${d.getDate()}`;
}

/** "tuesday, may 19" — the lock-screen clock day line */
export function fmtClockDay(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAYS_FULL[d.getDay()]}, ${MONTHS_FULL[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

/** the display name of a goal — `label`, else legacy `title`, else a fallback */
export function goalName(g: GoalItem | null | undefined): string {
  if (!g) return 'a goal';
  const lbl = typeof g.label === 'string' && g.label.trim() ? g.label.trim() : null;
  if (lbl) return lbl;
  const ttl = typeof g.title === 'string' && g.title.trim() ? g.title.trim() : null;
  return ttl ?? 'a goal';
}

/** the resolved status of a goal — defaults to 'active' (live module default) */
export function goalStatus(g: GoalItem | null | undefined): string {
  if (!g) return 'active';
  return typeof g.status === 'string' && g.status ? g.status : 'active';
}

/** is the goal live + counts toward the focus deck? */
export function isActive(g: GoalItem | null | undefined): boolean {
  return goalStatus(g) === 'active';
}

/** is the goal at rest — paused, dropped, done or in the graveyard? */
export function isRested(g: GoalItem | null | undefined): boolean {
  const s = goalStatus(g);
  return s === 'paused' || s === 'dropped' || s === 'graveyard' || s === 'done';
}

// ─── progress ────────────────────────────────────────────────────────────────

/** the milestones of a goal, defensively */
export function milestonesOf(g: GoalItem | null | undefined): Milestone[] {
  return Array.isArray(g?.milestones) ? g!.milestones! : [];
}

/** is a milestone done — a real completion timestamp present? */
export function isMilestoneDone(m: Milestone | null | undefined): boolean {
  return Boolean(m && typeof m.completed_at === 'number' && m.completed_at > 0);
}

/**
 * The goal's progress percent, 0..100. Milestones win: when a goal has
 * milestones the percent is `done / total`, recomputed live — the same
 * rule the live `GoalsModule.toggleMilestone` uses. With no milestones the
 * stored manual `progress` is used; absent that, 0. Never NaN.
 */
export function progressPct(g: GoalItem | null | undefined): number {
  if (!g) return 0;
  const ms = milestonesOf(g);
  if (ms.length > 0) {
    const done = ms.filter(isMilestoneDone).length;
    return Math.round((done / ms.length) * 100);
  }
  const p = typeof g.progress === 'number' ? g.progress : 0;
  return Math.max(0, Math.min(100, Math.round(p)));
}

/** "2 of 5 milestones done" — the calm progress caption; never a grade */
export function progressCaption(g: GoalItem | null | undefined): string {
  const ms = milestonesOf(g);
  if (ms.length === 0) return 'progress, your way';
  const done = ms.filter(isMilestoneDone).length;
  return `${done} of ${ms.length} milestone${ms.length === 1 ? '' : 's'} done`;
}

/**
 * The next open milestone — the one in front of the user. The first
 * milestone with no completion timestamp, in store order. null when every
 * milestone is done or there are none.
 */
export function nextMilestone(g: GoalItem | null | undefined): Milestone | null {
  for (const m of milestonesOf(g)) {
    if (!isMilestoneDone(m)) return m;
  }
  return null;
}

// ─── pacing words ────────────────────────────────────────────────────────────

/** the calm pacing line shown under a goal name — "marathon pace" etc. */
export function pacingWords(g: GoalItem | null | undefined): string | null {
  const p = g?.pacing;
  if (p === 'sprint') return 'sprint pace';
  if (p === 'marathon') return 'marathon pace';
  if (p === 'rolling') return 'rolling pace';
  return null;
}

// ─── face view-model ─────────────────────────────────────────────────────────

/**
 * The LEAF-FOCUS rule (goals.html): the face shows ONE goal — the one in
 * focus — as a soft progress arc with its next milestone. Multiple goals
 * are reached by swiping; the dots show this-of-N.
 */
export interface FocusGoalVM {
  id: string;
  /** the goal name */
  name: string;
  /** the category — drawn small-caps inside the arc; '' when uncategorized */
  category: string;
  /** the progress percent 0..100 — the arc fill + the centre number */
  pct: number;
  /** the next milestone label, or null when there are none / all done */
  nextLabel: string | null;
}

export interface FaceVM {
  /** has any goal at all been added? — drives the cold face */
  hasAnyGoal: boolean;
  /** the focus deck — active goals, in store order. empty on a cold start */
  deck: FocusGoalVM[];
  /** a one-line review nudge for the focus goal, or null */
  reviewLine: string | null;
  /** a one-line pattern teaser — present only when a pattern is observed */
  patternLine: string | null;
}

/** the focus-goal view-model for one goal */
export function focusGoalVM(g: GoalItem): FocusGoalVM {
  const next = nextMilestone(g);
  return {
    id: g.id,
    name: goalName(g),
    category: typeof g.category === 'string' && g.category ? g.category : '',
    pct: progressPct(g),
    nextLabel: next ? next.title : null,
  };
}

export function faceVM(slices: GoalsSlices, now: number): FaceVM {
  const goals = Array.isArray(slices.goals) ? slices.goals : [];
  const active = goals.filter((g) => g && g.id && isActive(g));
  const deck = active.map(focusGoalVM);

  const patternLine = patternSummary(slices, now);

  return {
    hasAnyGoal: goals.some((g) => Boolean(g && g.id)),
    deck,
    reviewLine: deck.length > 0 ? `sit with ${deck[0].name} for a minute` : null,
    patternLine,
  };
}

// ─── goal-detail view-model ──────────────────────────────────────────────────

export interface GoalMilestoneVM {
  id: string;
  label: string;
  done: boolean;
  /** the next open milestone — drawn a touch warmer */
  isNext: boolean;
}

export interface GoalDetailVM {
  /** does the goal exist to render? */
  exists: boolean;
  id: string;
  name: string;
  /** "learning · marathon pace" — category + pacing, the calm meta line */
  meta: string;
  /** progress percent 0..100 */
  pct: number;
  /** "2 of 5 milestones done" */
  progressCaption: string;
  /** the milestone list */
  milestones: GoalMilestoneVM[];
  /** the AI step-breakdown the user already generated, or [] */
  steps: string[];
  /** the obstacle / premortem the user wrote at goal-set, or null */
  obstacle: string | null;
  /** the Ulysses contract text, or null */
  contract: string | null;
  /** "march 2" — when the contract was written, or null */
  contractWhen: string | null;
  /** is the goal already at rest (paused/dropped/done)? */
  rested: boolean;
}

export function goalDetailVM(
  slices: GoalsSlices,
  goalId: string | null,
  now: number,
): GoalDetailVM {
  void now;
  const goals = Array.isArray(slices.goals) ? slices.goals : [];
  const g = goalId ? goals.find((x) => x && x.id === goalId) ?? null : null;
  if (!g) {
    return {
      exists: false,
      id: '',
      name: '',
      meta: '',
      pct: 0,
      progressCaption: '',
      milestones: [],
      steps: [],
      obstacle: null,
      contract: null,
      contractWhen: null,
      rested: false,
    };
  }

  const next = nextMilestone(g);
  const milestones: GoalMilestoneVM[] = milestonesOf(g).map((m) => ({
    id: m.id,
    label: m.title,
    done: isMilestoneDone(m),
    isNext: Boolean(next && next.id === m.id),
  }));

  const cat = typeof g.category === 'string' && g.category ? g.category : '';
  const pacing = pacingWords(g);
  const meta = [cat, pacing].filter(Boolean).join(' · ') || 'a goal you set';

  const obstacle =
    (typeof g.obstacle === 'string' && g.obstacle.trim()) ||
    (typeof g.premortem === 'string' && g.premortem.trim()) ||
    null;

  const contract =
    typeof g.ulysses_contract === 'string' && g.ulysses_contract.trim()
      ? g.ulysses_contract.trim()
      : null;

  return {
    exists: true,
    id: g.id,
    name: goalName(g),
    meta,
    pct: progressPct(g),
    progressCaption: progressCaption(g),
    milestones,
    steps: Array.isArray(g.steps) ? g.steps.filter((s) => typeof s === 'string' && s.trim()) : [],
    obstacle,
    contract,
    contractWhen: contract && typeof g.created_at === 'number' ? fmtShortDate(g.created_at) : null,
    rested: isRested(g),
  };
}

// ─── review view-model ───────────────────────────────────────────────────────

/** the two soft review tags — both honest, neither wrong */
export const REVIEW_TAGS = [
  { value: 'want', title: 'still want it', sub: 'it still pulls at you' },
  { value: 'invested', title: 'carrying it from before', sub: "it's habit now, not pull" },
] as const;

export type ReviewTag = (typeof REVIEW_TAGS)[number]['value'];

export interface ReviewVM {
  /** does the goal exist to review? */
  exists: boolean;
  goalId: string;
  /** the goal name — the calm "a minute with X" line */
  name: string;
  /**
   * true when the last 2+ check-ins were all "carrying it from before" —
   * the soft signal the screen uses to gently ask if it's time to rest.
   */
  driftSignal: boolean;
}

export function reviewVM(
  slices: GoalsSlices,
  goalId: string | null,
): ReviewVM {
  const goals = Array.isArray(slices.goals) ? slices.goals : [];
  const g = goalId ? goals.find((x) => x && x.id === goalId) ?? null : null;
  if (!g) {
    return { exists: false, goalId: '', name: '', driftSignal: false };
  }
  const reviews = (Array.isArray(slices.reviews) ? slices.reviews : [])
    .filter((r) => r && r.goal_id === g.id)
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const last2 = reviews.slice(0, 2);
  const driftSignal =
    last2.length >= 2 && last2.every((r) => r.alive_flag === 'invested');
  return { exists: true, goalId: g.id, name: goalName(g), driftSignal };
}

// ─── add view-model ──────────────────────────────────────────────────────────

/** the six category options on the add screen — the six the logic carries */
export const CATEGORY_OPTIONS: { value: GoalCategory; label: string }[] = [
  { value: 'learning', label: 'learning' },
  { value: 'career', label: 'career' },
  { value: 'health', label: 'health' },
  { value: 'finance', label: 'finance' },
  { value: 'relationship', label: 'relationship' },
  { value: 'creative', label: 'creative' },
];

// ─── patterns view-model ─────────────────────────────────────────────────────

export interface PatternLine {
  key: string;
  /** the one-line observation */
  line: string;
  /** the calm reframe under it, never a verdict */
  frame: string;
  /** the barely-there italic citation tag */
  cite: string;
}

/** one quietly-labelled group of observations */
export interface PatternGroup {
  key: string;
  label: string;
  lines: PatternLine[];
}

export interface PatternsVM {
  groups: PatternGroup[];
  /**
   * true when the groups are the canonical spec example set (the
   * cross-module reflective detectors need dump + review history the
   * preview store may not carry) — the screen is honest about it. Mirrors
   * admin-v2's `isExample`.
   */
  isExample: boolean;
}

/**
 * The canonical "see the rest" observation set, lifted verbatim from
 * goals-patterns.html. The reflective goals detectors (obstacle-echo,
 * premortem-echo, goal-interference, velocity, identity-drift, sunk-cost)
 * need a full dump history + per-goal tags + review history the preview
 * store may not cleanly carry. When the live detectors observe nothing,
 * this stands in as an honestly-labelled example gallery — `isExample`
 * tells the screen to say so plainly.
 */
const EXAMPLE_GROUPS: PatternGroup[] = [
  {
    key: 'blocks',
    label: 'the blocks you saw coming',
    lines: [
      {
        key: 'obstacle-echo',
        line: "the block you predicted for 'learn spanish' is showing up in your dumps",
        frame:
          'you wrote the speaking part scares you — that language is back in this week’s notes. naming it is the work, not a slip.',
        cite: 'obstacle-echo · Gollwitzer 1999',
      },
      {
        key: 'premortem-echo',
        line: "your past self predicted this exact reason for 'side project'",
        frame:
          "the premortem you wrote months ago matches the dumps now — not bad luck, a pattern you already saw. it's worth re-reading what you'd planned to do about it.",
        cite: 'premortem-echo · Klein 2007',
      },
    ],
  },
  {
    key: 'pull',
    label: 'where your goals pull against each other',
    lines: [
      {
        key: 'interference',
        line: "'save money' and 'travel more' pull against each other",
        frame:
          "they want the same money in opposite directions — that quiet tug is why both feel stuck. it isn't you slacking; it's two goals cancelling out.",
        cite: 'goal-interference · Riediger & Freund 2004',
      },
      {
        key: 'interference-day',
        line: "'wake up earlier' and 'finish the late writing' sit on opposite ends of the day",
        frame:
          'one asks the night, one asks the morning — they may need different seasons, not more willpower.',
        cite: 'goal-interference · Riediger & Freund 2004',
      },
    ],
  },
  {
    key: 'move',
    label: 'how your goals actually move',
    lines: [
      {
        key: 'velocity',
        line: 'learning goals tend to carry all the way through for you — finance ones less so',
        frame:
          'a real strength worth knowing: a finance goal might do better framed as something to learn, not something to grind.',
        cite: 'velocity · per-category, last 90 days',
      },
      {
        key: 'research-as-progress',
        line: "'side project' has had a lot of thinking and not much doing lately",
        frame:
          'turning it over counts as care — and the smallest concrete move would tell you more than another think. what’s the 10-minute version?',
        cite: 'research-as-progress · Barkley 2012',
      },
      {
        key: 'identity-drift',
        line: "'learn spanish' began as “the person who travels deeply” — that role hasn’t surfaced in a while",
        frame:
          "roles shift with seasons. it might be the same goal with a new reason, or a goal that's quietly done its job. either is fine.",
        cite: 'identity-drift · Oyserman 2015',
      },
    ],
  },
  {
    key: 'rest',
    label: 'when a goal might be ready to rest',
    lines: [
      {
        key: 'sunk-cost',
        line: "the last few check-ins on 'run a half marathon' were all “carrying it from before”",
        frame:
          "that's a soft signal it may have done what it came to do. letting it rest isn't quitting — it's making room. only you decide.",
        cite: 'sunk-cost · Arkes & Blumer 1985',
      },
      {
        key: 'experiment',
        line: "'side project' has been quiet for a while — what if it's a question, not a promise?",
        frame:
          'reframed as “something i’m testing” it can’t fail — it can only tell you something. quiet isn’t dead; it’s often just a different shape.',
        cite: 'experiment-candidate · Steel 2007',
      },
    ],
  },
];

/**
 * Patterns derived live from the `goals.*` slices. Runs the real goals
 * detectors — interference (per-goal tags), velocity (per-category
 * completion), identity-drift, research-as-progress, sunk-cost — over the
 * live store. Returns an empty array when nothing is observed; the screen
 * then falls back to the honest example gallery.
 */
function livePatternGroups(slices: GoalsSlices, now: number): PatternGroup[] {
  const goals = (Array.isArray(slices.goals) ? slices.goals : []).filter(
    (g): g is GoalItem => Boolean(g && g.id),
  ) as unknown as Goal[];
  if (goals.length === 0) return [];

  const sessions = Array.isArray(slices.sessions) ? slices.sessions : [];
  const reviews = Array.isArray(slices.reviews) ? slices.reviews : [];
  const dumps = Array.isArray(slices.dumps) ? slices.dumps : [];
  const history = { goals, sessions, reviews, dumps, now };
  const opts = { now, consent: true };

  const pull: PatternLine[] = [];
  const move: PatternLine[] = [];
  const rest: PatternLine[] = [];

  // goal-interference (G12) — per-goal interference_tags
  try {
    const interference = detectGoalInterference(history, opts);
    if (interference && Array.isArray(interference.conflicts)) {
      for (const c of interference.conflicts) {
        pull.push({
          key: `interference-${c.goal_a_id}-${c.goal_b_id}`,
          line: interference.copy,
          frame:
            "that quiet tug is why both feel stuck — not you slacking; it's two goals cancelling out.",
          cite: 'goal-interference · Riediger & Freund 2004',
        });
        break; // one calm line is enough for the face
      }
    }
  } catch {
    // detector optional
  }

  // velocity (per-category completion, last 90 days)
  try {
    const velocity = detectGoalVelocityByCategory(history, opts);
    const top = Array.isArray(velocity) ? velocity[0] : null;
    if (top && typeof top.copy === 'string' && top.copy.trim()) {
      move.push({
        key: `velocity-${top.category}`,
        line: top.copy,
        frame:
          'a real strength worth knowing — a slower category might do better framed as something to learn, not something to grind.',
        cite: 'velocity · per-category, last 90 days',
      });
    }
  } catch {
    // detector optional
  }

  // research-as-progress (G5) — lots of thinking, little doing
  try {
    const raw = detectResearchAsProgress(history, opts);
    const rap = Array.isArray(raw) ? raw[0] : raw;
    if (rap && typeof rap.copy === 'string' && rap.copy.trim()) {
      move.push({
        key: `research-${rap.goal_id}`,
        line: rap.copy,
        frame:
          'turning it over counts as care — the smallest concrete move would tell you more than another think.',
        cite: 'research-as-progress · Barkley 2012',
      });
    }
  } catch {
    // detector optional
  }

  // identity-drift (G11) — the role behind a goal has gone quiet
  try {
    const raw = detectIdentityDrift(history, opts);
    const drift = Array.isArray(raw) ? raw[0] : raw;
    if (drift && typeof drift.copy === 'string' && drift.copy.trim()) {
      move.push({
        key: `drift-${drift.goal_id}`,
        line: drift.copy,
        frame:
          "roles shift with seasons. it might be the same goal with a new reason, or a goal that's quietly done its job — either is fine.",
        cite: 'identity-drift · Oyserman 2015',
      });
    }
  } catch {
    // detector optional
  }

  // sunk-cost (G13) — a goal that may be ready to rest
  try {
    const raw = detectSunkCostFlag(history, opts);
    const sunk = Array.isArray(raw) ? raw[0] : raw;
    if (sunk && typeof sunk.copy === 'string' && sunk.copy.trim()) {
      rest.push({
        key: `sunk-${sunk.goal_id}`,
        line: sunk.copy,
        frame:
          "letting a goal rest isn't quitting — it's making room. only you decide.",
        cite: 'sunk-cost · Arkes & Blumer 1985',
      });
    }
  } catch {
    // detector optional
  }

  const groups: PatternGroup[] = [];
  if (pull.length > 0) {
    groups.push({ key: 'pull', label: 'where your goals pull against each other', lines: pull });
  }
  if (move.length > 0) {
    groups.push({ key: 'move', label: 'how your goals actually move', lines: move });
  }
  if (rest.length > 0) {
    groups.push({ key: 'rest', label: 'when a goal might be ready to rest', lines: rest });
  }
  return groups;
}

/**
 * The patterns ("see the rest") view-model. When the live goals detectors
 * observe anything, those real groups are returned. Otherwise the canonical
 * spec example set is returned and `isExample` is set — the screen says so
 * plainly.
 */
export function patternsVM(slices: GoalsSlices, now: number): PatternsVM {
  const live = livePatternGroups(slices, now);
  if (live.length > 0) return { groups: live, isExample: false };
  return { groups: EXAMPLE_GROUPS, isExample: true };
}

/** the short pattern teaser for the goals face's observation row */
export function patternSummary(slices: GoalsSlices, now: number): string | null {
  const live = livePatternGroups(slices, now);
  const total = live.reduce((s, g) => s + g.lines.length, 0);
  if (total > 0) return 'a few quiet things ollie noticed';
  return null;
}

// ─── notifications view-model ────────────────────────────────────────────────

export interface NotificationCard {
  key: string;
  /** which glyph the lock-screen card shows */
  glyph: 'milestone' | 'review' | 'obstacle' | 'interference' | 'weekly';
  /** "tuesday, may 19" */
  day: string;
  /** "9:41" */
  time: string;
  /** "now" / "sun 6pm" */
  when: string;
  /** the bold notification title */
  title: string;
  /** the calm body line */
  body: string;
}

/**
 * The notification reel — the five pushes goals sends, exactly the set
 * goals-notifications.html shows. This is a presentation surface (like the
 * other v2 modules' notification reels): the copy is real and lifted from
 * the detectors' voice, but the five cards are an honest curated reel, not
 * a live feed. Reported as a presentation stub.
 */
export function notificationsVM(now: number): { cards: NotificationCard[] } {
  const day = (offset: number) => fmtClockDay(now + offset * DAY_MS);
  return {
    cards: [
      {
        key: 'milestone',
        glyph: 'milestone',
        day: day(0),
        time: '9:41',
        when: 'now',
        title: 'learn spanish · milestone in 3 days',
        body: 'a soft heads-up, not a deadline — move on it if it fits the day.',
      },
      {
        key: 'review',
        glyph: 'review',
        day: day(5),
        time: '11:30',
        when: 'sun',
        title: 'a soft check-in on learn spanish?',
        body: 'a minute, no grade — just how the goal feels right now. skip it freely.',
      },
      {
        key: 'obstacle',
        glyph: 'obstacle',
        day: day(8),
        time: '8:15',
        when: 'wed',
        title: "the block you predicted for 'learn spanish' is showing up",
        body: 'your past self saw this one coming. not a slip — just worth a look.',
      },
      {
        key: 'interference',
        glyph: 'interference',
        day: day(10),
        time: '3:42',
        when: 'fri',
        title: "'save money' and 'travel more' are pulling against each other",
        body: 'that quiet tug is why both feel stuck — not you slacking.',
      },
      {
        key: 'weekly',
        glyph: 'weekly',
        day: day(12),
        time: '6:00',
        when: 'sun 6pm',
        title: 'your week in goals — one milestone met, one goal rested',
        body: 'a quiet recap, no scoring. arrives only if you asked for it.',
      },
    ],
  };
}
