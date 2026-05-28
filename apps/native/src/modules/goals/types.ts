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

/** One goal in the registry — created either explicitly or on first mention. */
export interface Goal {
  id: string;
  name: string;        // normalised lowercase
  why: string | null;  // optional motivation captured at create-time
  createdAt: number;   // ms since epoch
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
