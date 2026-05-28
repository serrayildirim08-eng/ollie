/**
 * Work module · domain types.
 *
 * Two persistent shapes, mirrored 1:1 to SQLite rows:
 *
 *   - WorkTask    — todo + deadline rows; checkable, optionally dated.
 *   - WorkEvent   — append-only log of focus sessions, meetings, and
 *                   distractions. Variable shape (focus has minutes,
 *                   meeting has a who, distraction has a what), so the
 *                   variable bit lives inside `data` as a typed JSON
 *                   blob discriminated by `kind`.
 *
 * Kept narrow because the AI router has a small WorkAction vocabulary —
 * see router/schema.ts. Adding a new action means adding a new shape here
 * + a new switch arm in handler.ts (TS will complain until both land).
 */

export type WorkTaskKind = 'task' | 'deadline';

/**
 * A checkable row on the work screen. `dueDate` is only populated for
 * `kind === 'deadline'` rows — plain tasks leave it null. ISO yyyy-mm-dd
 * so it sorts lexicographically; no timezone gymnastics needed.
 */
export interface WorkTask {
  id: string;
  text: string;
  project: string | null;
  kind: WorkTaskKind;
  dueDate: string | null; // ISO yyyy-mm-dd
  done: boolean;
  createdAt: number;      // ms since epoch
}

export type WorkEventKind = 'focus_session' | 'meeting' | 'distraction';

/** Focus session — a finished pomodoro / deep-work block. */
export interface FocusSessionData {
  durationMin: number | null;
  project: string | null;
}

/** Meeting — finished sync, durations optional. */
export interface MeetingData {
  with: string | null;
  durationMin: number | null;
}

/** Distraction journal — what pulled you away. */
export interface DistractionData {
  what: string;
}

/**
 * Discriminated union for the typed shape stored inside `WorkEvent.data`.
 * Persisted as JSON, hydrated through the row mapper.
 */
export type WorkEventData =
  | ({ kind: 'focus_session' } & FocusSessionData)
  | ({ kind: 'meeting' } & MeetingData)
  | ({ kind: 'distraction' } & DistractionData);

export interface WorkEvent {
  id: string;
  kind: WorkEventKind;
  data: WorkEventData;
  loggedAt: number; // ms since epoch
}
