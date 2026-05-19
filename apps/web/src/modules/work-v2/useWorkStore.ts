/**
 * work-v2 · useWorkStore — the bridge to the REAL matter backend
 *
 * ── REAL BACKEND, NOT A STUB ─────────────────────────────────────────────────
 * The old work-v2 invented a private `work_v2` store namespace and seeded fake
 * matters into it. That contradicted reality: the matter container + the
 * deterministic dump→matter routing are REAL and shipped (commit 9ed51e5) —
 * `@ollie/logic/work` (the `Matter` model, `createMatter`, routing heuristics)
 * + the `matter-routing` orchestrator, which runs inside `createOrchestrator`
 * and writes into the live `work` store namespace.
 *
 * This hook reads those REAL keys:
 *   - `work.matters`            Matter[]              — Phase-1 containers
 *   - `work.matter_loose_dumps` LooseDumpRef[]        — Phase-2 unrouted dumps
 *   - `work.matter_suggestions` NewMatterSuggestion[] — "new matter?" nudges
 *   - `work.tasks` / `work.meetings` / `dump.items`   — source text for refs
 *
 * It performs exactly two mutations, both Phase-2-faithful:
 *   - `confirmSuggestion` — the user confirms a "new matter?" nudge. A real
 *     `Matter` is created via `createMatter` and APPENDED to `work.matters`;
 *     the confirmed suggestion's name becomes the matter's identity + the
 *     candidate key is added as an alias so routing immediately adopts the
 *     loose dumps that mentioned it. The suggestion is removed. Note: the
 *     routing orchestrator subscribes to `work.matters` and re-routes the
 *     backlog on this write, so the loose dumps self-file with no extra work.
 *   - `dismissSuggestion` — the user says "not a matter"; the suggestion is
 *     simply removed.
 *
 * There is NO manual "create matter" / "file this" path — Phase 1 is passive
 * (WORK-VISION.md: "the user never files"). Matters are detected + confirmed.
 */
import { useCallback, useMemo } from 'react';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';
import { createMatter } from '@ollie/logic/work';
import type { Matter, NewMatterSuggestion } from '@ollie/logic/work';
import type { LooseDumpRef } from '@ollie/orchestrator';
import {
  EMPTY_WORK_STATE,
  type WorkState,
  type WorkTaskRow,
  type WorkMeetingRow,
  type DumpItemRow,
} from './selectors';

/** the live store namespace the real matter backend writes into */
const WORK_NS = 'work';
const DUMP_NS = 'dump';

export interface WorkActions {
  /**
   * Confirm Ollie's "new matter?" suggestion. Creates a real `Matter`, appends
   * it to `work.matters`, and drops the suggestion. The routing orchestrator
   * then re-routes the backlog and the loose dumps self-file.
   */
  confirmSuggestion: () => void;
  /** Dismiss the surfaced "new matter?" suggestion — "not a matter". */
  dismissSuggestion: () => void;
}

export interface WorkStore {
  /** the assembled read state, fed straight into the pure selectors */
  state: WorkState;
  /** the two Phase-2-faithful mutations the screens perform */
  actions: WorkActions;
}

/** narrow an unknown persisted value to an array, defensively */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * The work-v2 backend bridge. `now` is injected so a freshly-confirmed matter
 * gets a deterministic `created_at` in tests.
 */
export function useWorkStore(now: number): WorkStore {
  const [matters, setMatters] = useStoreSlice<Matter[]>(
    WORK_NS,
    'matters',
    EMPTY_WORK_STATE.matters,
  );
  const [looseDumps] = useStoreSlice<LooseDumpRef[]>(
    WORK_NS,
    'matter_loose_dumps',
    EMPTY_WORK_STATE.looseDumps,
  );
  const [suggestions, setSuggestions] = useStoreSlice<NewMatterSuggestion[]>(
    WORK_NS,
    'matter_suggestions',
    EMPTY_WORK_STATE.suggestions,
  );
  const [workTasks] = useStoreSlice<WorkTaskRow[]>(
    WORK_NS,
    'tasks',
    EMPTY_WORK_STATE.workTasks,
  );
  const [workMeetings] = useStoreSlice<WorkMeetingRow[]>(
    WORK_NS,
    'meetings',
    EMPTY_WORK_STATE.workMeetings,
  );
  const [dumpItems] = useStoreSlice<DumpItemRow[]>(
    DUMP_NS,
    'items',
    EMPTY_WORK_STATE.dumpItems,
  );

  // tolerate partial / missing persisted values — fold into a clean shape
  const state = useMemo<WorkState>(
    () => ({
      matters: asArray<Matter>(matters),
      looseDumps: asArray<LooseDumpRef>(looseDumps),
      suggestions: asArray<NewMatterSuggestion>(suggestions),
      workTasks: asArray<WorkTaskRow>(workTasks),
      workMeetings: asArray<WorkMeetingRow>(workMeetings),
      dumpItems: asArray<DumpItemRow>(dumpItems),
    }),
    [matters, looseDumps, suggestions, workTasks, workMeetings, dumpItems],
  );

  const confirmSuggestion = useCallback(() => {
    const s: NewMatterSuggestion | undefined = state.suggestions[0];
    if (!s) return;
    // Create a real Matter from the suggestion. Its display name is the
    // candidate's surface form; its normalised key is added as an alias so
    // routing matches the loose dumps that recurred on it.
    const matter = createMatter({
      id: mkId('matter'),
      name: s.candidate,
      aliases: [s.key],
      created_at: now,
    });
    setMatters([...state.matters, matter]);
    // Drop the confirmed suggestion; the orchestrator re-routes on the
    // work.matters write and the loose dumps self-file into the new matter.
    setSuggestions(state.suggestions.filter((x) => x.key !== s.key));
  }, [state.suggestions, state.matters, setMatters, setSuggestions, now]);

  const dismissSuggestion = useCallback(() => {
    const s: NewMatterSuggestion | undefined = state.suggestions[0];
    if (!s) return;
    setSuggestions(state.suggestions.filter((x) => x.key !== s.key));
  }, [state.suggestions, setSuggestions]);

  const actions = useMemo<WorkActions>(
    () => ({ confirmSuggestion, dismissSuggestion }),
    [confirmSuggestion, dismissSuggestion],
  );

  return { state, actions };
}
