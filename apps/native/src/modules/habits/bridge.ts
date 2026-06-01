/**
 * apps/native · modules/habits/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The habits Layer-2 watcher (packages/orchestrator/src/habits.ts) reads
 * these store keys; native captures into SQLite (habits/repo.ts) and never
 * writes them. This fills syncToStore().
 *
 * Store keys the habits watcher reads (written here):
 *   shared.habits_v2 — the habits roster the detectors + scanCompletions read.
 *                      Shape (per orchestrator/habits.ts + logic/habits/types):
 *                        { id, name, created_at, cue?, completions: [{ ts, habit_id }] }
 *                      `completions` MUST be sorted oldest→newest (scanCompletions
 *                      reads completions[last].ts as "today's" completion).
 *   shared.actionLog — the unified check-off / action stream (THE key the
 *                      habits detector consumes for dump contagion). Entries:
 *                        { ts, rawText?, undone? }
 *                      SHARED across modules — read-merge-append ONLY, keyed by
 *                      a stable per-completion id so re-runs and concurrent
 *                      bridges don't clobber each other.
 *
 * (habits.patterns / habits._* are OUTPUT — do NOT touch.)
 *
 * CUE CAPTURE (wired): the externalization-gap detector counts a habit as
 * "cued" when `h.cue` is a non-empty string. Native now captures a cue window
 * per habit ('morning' | 'anytime' | 'evening' — see habits/types.ts). We
 * carry 'morning'/'evening' through as the real cue; 'anytime' (the calm
 * default = no specific environmental trigger) is mapped to `undefined` so the
 * detector reads it as uncued. The detector can now differentiate cued vs
 * uncued habits off live capture.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import { registry, completions as completionsRepo } from './repo';

/** Stable prefix so habit check-offs are identifiable in the shared log. */
const ACTION_LOG_PREFIX = 'habits:';

/** Entry shape in shared.actionLog (subset the habits watcher reads). */
interface ActionLogEntry {
  ts: number;
  rawText?: string;
  undone?: boolean;
  /** Stable id so this bridge can read-merge-append without duplicating. */
  id?: string;
}

/** habits_v2 roster entry, in the exact shape the watcher reads. */
interface HabitsV2Entry {
  id: string;
  name: string;
  created_at: number;
  cue?: string;
  completions: Array<{ ts: number; habit_id: string }>;
}

export async function syncToStore(store: Store): Promise<void> {
  const habits = await registry.list();

  // ── shared.habits_v2 — full roster + completions ──────────────────────
  // listForHabit returns newest-first; the watcher's scanCompletions reads
  // completions[completions.length - 1] as the most-recent, so we reverse to
  // oldest→newest.
  const roster: HabitsV2Entry[] = [];
  const checkoffs: ActionLogEntry[] = [];

  for (const habit of habits) {
    const comps = await completionsRepo.listForHabit(habit.id); // newest-first
    const ordered = [...comps].reverse(); // oldest→newest for the watcher

    roster.push({
      id: habit.id,
      name: habit.name,
      created_at: habit.createdAt,
      // 'anytime' = no specific environmental cue → undefined (uncued).
      // 'morning'/'evening' carry through as the real cue (the detector
      // treats any non-empty string as cued).
      cue: habit.cue === 'anytime' ? undefined : habit.cue,
      completions: ordered.map((c) => ({ ts: c.completedAt, habit_id: habit.id })),
    });

    // Each completion contributes one check-off line to the shared action log.
    for (const c of comps) {
      checkoffs.push({
        id: `${ACTION_LOG_PREFIX}${c.id}`,
        ts: c.completedAt,
        rawText: habit.name,
        undone: false,
      });
    }
  }

  store.set('shared', 'habits_v2', roster);

  // ── shared.actionLog — read-merge-append (NEVER overwrite) ────────────
  // Other module bridges write here too. Drop our own previous entries (by the
  // habits: id prefix) so this run is idempotent, keep everyone else's, then
  // append our fresh check-offs.
  const existing = store.get<ActionLogEntry[]>('shared', 'actionLog', []) ?? [];
  const others = Array.isArray(existing)
    ? existing.filter((e) => !(typeof e?.id === 'string' && e.id.startsWith(ACTION_LOG_PREFIX)))
    : [];
  const merged = [...others, ...checkoffs].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  store.set('shared', 'actionLog', merged);
}
