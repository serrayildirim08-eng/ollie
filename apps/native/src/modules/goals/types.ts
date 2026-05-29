/**
 * Goals module · domain types.
 *
 * Two surfaces only: a `Goal` (registry of things you're trying to do) and a
 * `GoalEvent` (anything the user said about a goal — progress, milestone,
 * obstacle). Events are append-only; the registry auto-grows when the router
 * mentions a new goal name.
 *
 * Goal name is the join key. We normalise (lowercase, collapse whitespace)
 * so "Move to Netherlands" and "move to netherlands  " resolve to the same
 * row. The original casing isn't preserved — Ollie's editorial UI displays
 * names lowercase by design.
 */

export type GoalEventKind = 'progress' | 'milestone' | 'obstacle';

/**
 * One goal in the registry — created either explicitly (the rich create
 * modal) or on first mention via the dump router (lighter, new fields null).
 *
 * Rich-capture fields (2026-05-29, goals brief): every field below `why` is
 * captured by the create modal. They are nullable at the data layer so the
 * dump-router auto-register path can still create a goal with just a name.
 */
export interface Goal {
  id: string;
  name: string;            // normalised lowercase ("what")
  why: string | null;      // what gets better when this is done
  targetDate: number | null;     // optional, ms epoch — NO punishment for missing
  obstacle: string | null;       // what's most likely to stop you
  premortem: string | null;      // "imagine this fails in 3 months — what killed it?"
  ulyssesContract: string | null; // note from current-you to future-you, shown on delete
  createdAt: number;       // ms since epoch
}

/**
 * Input for the rich create flow. `name` + `why` + `obstacle` + `premortem`
 * + `ulyssesContract` are REQUIRED by the create modal; `targetDate` is the
 * only optional field. At the repo layer all-but-name are accepted as
 * nullable so the dump path can create a bare goal.
 */
export interface GoalDraft {
  name: string;
  why?: string | null;
  targetDate?: number | null;
  obstacle?: string | null;
  premortem?: string | null;
  ulyssesContract?: string | null;
}

/** Max simultaneously-active goals. Creation past this is refused (brief G2). */
export const ACTIVE_GOAL_CAP = 5;

/** Low-mood delete-lock window: deletion blocked for this long (brief G4). */
export const DELETE_LOCK_MS = 72 * 60 * 60 * 1000;

/** Result of a delete-permission check (low-mood gate). */
export interface DeleteGate {
  allowed: boolean;
  /** When blocked, ms-epoch the lock lifts (now + remaining window). */
  lockedUntil?: number;
  reason?: 'low_mood';
}

/**
 * One thing the user said about a goal. `goalId` is nullable: when the
 * router can't (or doesn't) name the goal, we still keep the note so the
 * UI can surface unassigned activity rather than swallow it.
 */
export interface GoalEvent {
  id: string;
  goalId: string | null;
  kind: GoalEventKind;
  text: string;
  loggedAt: number;    // ms since epoch
}

/** A registry row enriched with the latest progress note, for the UI list. */
export interface GoalWithLatest extends Goal {
  latestProgress: GoalEvent | null;
}

export function normaliseName(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}
