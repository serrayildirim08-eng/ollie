/**
 * Habits module · domain types.
 *
 * ADHD-first framing: a "habit" is just a named ritual the user has done at
 * least once. Habits auto-register on first `complete` — there's no separate
 * "create habit" flow. The router (and the user) only need a name.
 *
 * No streaks, ever (mandate: feedback-ollie-no-streaks). There is no streak
 * count, no consecutive-day run, no "streak broke" event — that's an
 * ADHD-shame mechanic and is deliberately absent. Habits track only WHAT the
 * user does and WHEN, never how many days in a row.
 */

/** A habit the user has performed at least once. */
export interface Habit {
  id: string;
  name: string;       // normalised lowercase
  createdAt: number;  // ms since epoch
}

/** A single completion of a habit on a specific moment. */
export interface HabitCompletion {
  id: string;
  habitId: string;
  completedAt: number; // ms since epoch
}

/** A non-completion event attached to a habit timeline. */
export type HabitEventKind = 'identity';

export interface HabitEvent {
  id: string;
  kind: HabitEventKind;
  /** JSON-encoded body — { text } for identity. */
  data: string;
  loggedAt: number; // ms since epoch
}

/** Decoded payload for an identity event. */
export interface IdentityData {
  text: string;
}

/**
 * UI-ready row combining registry + computed stats. Shaped this way so the
 * box screen can render a single list without per-row async work. No streak
 * field by design — see the no-streaks note above.
 */
export interface HabitRow {
  habit: Habit;
  completedToday: boolean;   // true if ≥1 completion today (local time)
  lastCompletedAt: number | null;
}

/** Normalise a habit name to its canonical lowercase form. */
export function normaliseHabitName(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}
