/**
 * habits-v2 · useHabitsActions — write bridge
 *
 * The handful of mutations the v2 habits screens perform, written through
 * the SAME `shared.habits_v2` store key + `StoredHabit` shape the live
 * `HabitsModule` uses. A habit checked in / added through the v2 preview is
 * visible to the live module and vice-versa — they share one habits store.
 *
 *   - `checkIn` mirrors `HabitsModule.toggleCheck` — a `{ts}` mark appended
 *     to the habit's `completions` log; tapping again the same day removes
 *     it (the tap-circle un-checks). It applies the same 90-day prune the
 *     live module does. Like the live module it writes ONLY the store: the
 *     habits orchestrator watches `shared.habits_v2` and emits the
 *     `habits:completed` event itself — the UI never emits directly.
 *   - `addHabit` mirrors `HabitsModule.addHabit` — a new `StoredHabit`
 *     appended to `shared.habits_v2`, with its required cue + cue-time.
 *
 * The store may be holding the live module's seeded default list — the v2
 * bridge writes against whatever it reads, falling back to the same seeds
 * so the first mutation never strands the 6 starter habits.
 *
 * Mirrors medication-v2/useMedicationActions.ts.
 */
import { useCallback } from 'react';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';
import { DEFAULT_HABITS, type StoredHabit, type CueTime } from './selectors';

/** the 90-day completion-log window the live module keeps */
const PRUNE_MS = 90 * 86_400_000;

export interface NewHabit {
  name: string;
  /** the cue — required; a habit without one is wishful thinking */
  cue: string;
  cueTime: CueTime;
}

export interface HabitsActions {
  /** check a habit in for today — or, if already in, un-check it */
  checkIn: (habitId: string) => void;
  /** add a new habit; returns the created habit, or null when invalid */
  addHabit: (habit: NewHabit) => StoredHabit | null;
}

/** the midnight-floored day key for an epoch-ms ts */
function dayFloor(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function useHabitsActions(now: number): HabitsActions {
  const [stored, setHabits] = useStoreSlice<StoredHabit[]>(
    'shared',
    'habits_v2',
    DEFAULT_HABITS,
  );

  /** the working list — fall back to the seeds, mirroring the live module */
  const list = (): StoredHabit[] =>
    Array.isArray(stored) && stored.length > 0 ? stored : DEFAULT_HABITS;

  const checkIn = useCallback(
    (habitId: string) => {
      const today = dayFloor(now);
      const cutoff = now - PRUNE_MS;

      const next = list().map((h) => {
        if (!h || h.id !== habitId) return h;
        // prune anything older than the 90-day window first
        const log = (Array.isArray(h.completions) ? h.completions : []).filter(
          (c) => c && typeof c.ts === 'number' && c.ts >= cutoff,
        );
        const checkedToday = log.some((c) => dayFloor(c.ts) === today);
        if (checkedToday) {
          // un-check — drop today's marks
          return {
            ...h,
            completions: log.filter((c) => dayFloor(c.ts) !== today),
          };
        }
        return { ...h, completions: [...log, { ts: now }] };
      });

      setHabits(next);
    },
    // `stored` is read through `list()` at call time — closing over the
    // setter + `now` is enough; re-deriving the callback on every store
    // write would needlessly churn the tap-circle handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setHabits, now],
  );

  const addHabit = useCallback(
    (habit: NewHabit): StoredHabit | null => {
      const name = (habit.name ?? '').trim();
      const cue = (habit.cue ?? '').trim();
      // the cue is required — a habit without one is wishful thinking
      if (!name || !cue) return null;
      const created: StoredHabit = {
        id: mkId('h'),
        name,
        cue,
        cueTime: habit.cueTime,
        created_at: now,
        completions: [],
      };
      setHabits([...list(), created]);
      return created;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setHabits, now],
  );

  return { checkIn, addHabit };
}
