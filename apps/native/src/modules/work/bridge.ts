/**
 * apps/native · modules/work/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The work Layer-2 watcher (packages/orchestrator/src/work.ts — the "14
 * detectors") reads these store keys; native captures focus sessions /
 * distractions / tasks into SQLite (work/repo.ts). This bridge mirrors those
 * rows into the store keys the watcher reads — closing the gap the audit
 * flagged ("a single AI-layer mismatch silences 14 detectors").
 *
 * Store keys the work watcher reads (see work.ts header):
 *   work.focus_log           — focus/pomodoro sessions (LOAD-BEARING; the
 *                              watcher projects this → sessions for W0/W1/W3,
 *                              drives pomodoro break math + hyperfocus emit;
 *                              also read by sleep + habits watchers)
 *   work.tasks               — work tasks (W activation/estimation detectors)
 *   work.meetings            — meetings (W meeting-cliff cue + scanCues)
 *   work.sessions            — legacy session stream (left untouched; the
 *                              watcher merges focus_log INTO sessions, so
 *                              writing focus_log feeds the session detectors
 *                              without us clobbering any seeded sessions)
 *
 * Fields native SQLite does NOT capture today (flagged, not fabricated):
 *   - meeting start_at/end_at: meeting events are logged AFTER the fact with
 *     only `with` + durationMin, so the meeting-cliff detector (needs
 *     start_at/end_at) + the 30-min-prior cue (needs a future start_at) stay
 *     dark. We synthesize a best-effort [loggedAt-duration, loggedAt] window
 *     so back-to-back logged meetings can still register, but no future cue
 *     can fire without a scheduled-meeting capture UI.
 *   - distraction events: the watcher reads task-switch tax off
 *     session.swap_log, not a top-level distraction key — native distractions
 *     have nowhere to land, so they are intentionally NOT mirrored.
 *   - crash_log / estimation_log / tab_reports / multitask_log / rsd_anchor /
 *     shutdown_log / triage_days / scheduled_blocks: no native capture field
 *     exists yet; those detectors remain starved until a capture UI lands.
 *
 * `work.patterns / pomodoro / work._*` are OUTPUT keys — never written here.
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import type {
  FocusLogEntry,
  FocusDurationMin,
  Meeting,
  WorkTask as LogicWorkTask,
} from '@ollie/logic/work';
import { events as eventsRepo, tasks as tasksRepo } from './repo';
import type { WorkEvent } from './types';

/** Focus modes the logic layer recognises; anything else is left as-is. */
const KNOWN_MODES: ReadonlySet<number> = new Set([15, 25, 45, 90]);

/** Snap a captured minute count onto a supported FocusDurationMin. */
function toFocusMode(min: number | null): FocusDurationMin {
  if (min != null && KNOWN_MODES.has(min)) return min as FocusDurationMin;
  // Unknown / null duration: default to 25 (the canonical pomodoro block) so
  // the entry still counts toward focus totals + pomodoro math.
  return 25;
}

/**
 * Mirror SQLite work_events + work_tasks → the store keys the work watcher
 * reads. Read-only against SQLite; full-overwrite against the store keys we
 * own (work.focus_log / work.tasks / work.meetings) — none of these are
 * shared.* append-only keys, so a clean rewrite from the source of truth is
 * correct and idempotent.
 */
export async function syncToStore(store: Store): Promise<void> {
  const [allEvents, allTasks] = await Promise.all([
    eventsRepo.list(500),
    tasksRepo.list(),
  ]);

  // ── focus_log (the load-bearing fix) ────────────────────────────────────
  // Each completed focus_session event → one FocusLogEntry. ts = when logged,
  // duration_ms = actual elapsed (we only have the mode minutes, so elapsed =
  // mode * 60_000), duration_min = snapped mode. The watcher projects these
  // into WorkSession[] for W0/W1/W3 and derives pomodoro + hyperfocus from
  // them. Oldest-first so downstream time math reads naturally.
  const focusLog: FocusLogEntry[] = [];
  const meetings: Meeting[] = [];

  // events.list() is most-recent-first; reverse to oldest-first.
  for (const ev of [...allEvents].reverse()) {
    if (ev.data.kind === 'focus_session') {
      const mode = toFocusMode(ev.data.durationMin);
      focusLog.push({
        ts: ev.loggedAt,
        duration_min: mode,
        duration_ms: mode * 60_000,
      });
    } else if (ev.data.kind === 'meeting') {
      meetings.push(eventToMeeting(ev));
    }
    // distraction: no watcher sink — intentionally dropped (see header).
  }

  // ── tasks ────────────────────────────────────────────────────────────────
  // SQLite WorkTask (id/text/done/createdAt) → logic WorkTask
  // (id/title/created_at/completed_at). The activation / estimation detectors
  // key off title + completed_at; done rows get completed_at = createdAt
  // (the row refreshes its timestamp on completion in repo.markComplete).
  const tasks: LogicWorkTask[] = allTasks.map((t) => ({
    id: t.id,
    title: t.text,
    created_at: t.createdAt,
    completed_at: t.done ? t.createdAt : null,
  }));

  store.set<FocusLogEntry[]>('work', 'focus_log', focusLog);
  store.set<LogicWorkTask[]>('work', 'tasks', tasks);
  store.set<Meeting[]>('work', 'meetings', meetings);
  // Leave work.sessions alone: the watcher merges focus_log INTO sessions, so
  // overwriting sessions here would clobber any legacy/seeded session data for
  // no gain. focus_log is the live path.
}

/**
 * Best-effort Meeting from a logged meeting event. SQLite captures meetings
 * after they happen (`with` + durationMin only), so we synthesize the window
 * as [loggedAt - duration, loggedAt]. This lets the meeting-cliff detector see
 * back-to-back *logged* meetings; it CANNOT drive the future 30-min-prior cue
 * (that needs a real future start_at from a scheduling capture we don't have).
 */
function eventToMeeting(ev: WorkEvent): Meeting {
  const durationMin =
    ev.data.kind === 'meeting' && ev.data.durationMin != null
      ? ev.data.durationMin
      : 30;
  const end_at = ev.loggedAt;
  const start_at = end_at - durationMin * 60_000;
  const title =
    ev.data.kind === 'meeting' && ev.data.with ? ev.data.with : 'meeting';
  return { id: ev.id, title, start_at, end_at, duration_min: durationMin };
}
