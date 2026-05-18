/**
 * @ollie/orchestrator · body · cross-module signals
 *
 * Glue that feeds @ollie/logic/body/signals from the store and writes the
 * result to shared.signals. This is the ONLY writer of body-owned signals.
 *
 * Why body owns it: the body orchestrator already subscribes to cycle +
 * sleep, and a cross-module signal by definition needs ≥ 2 modules of data.
 * The signals here are deliberately things a per-module "noticed" panel
 * cannot show:
 *   - sleep_debt_focus_quality : sleep ↔ work
 *   - cycle_phase_energy       : cycle ↔ work
 *
 * Store reads:
 *   cycle.cycles      → step-function phase array (via computePhaseForDate)
 *   sleep.records     → SleepRecord[] (night_of / tst_min / is_skipped)
 *   work.focus_log    → FocusLogEntry[] (ts / duration_min / duration_ms)
 *
 * Store write (namespace "shared"):
 *   signals               BodySignal[]  — body-owned entries merged in,
 *                         other modules' signal entries left untouched.
 *   signalsLastComputedAt timestamp
 */

import type { Store } from '@ollie/store';
import { detectBodySignals } from '@ollie/logic/body';
import type {
  BodySignal,
  SignalSleepNight,
  SignalFocusSession,
  SignalCyclePhase,
} from '@ollie/logic/body';
import { computePhaseForDate } from '@ollie/logic/cycle';

const DAY_MS = 86_400_000;

/** signal ids this orchestrator owns — used to merge without clobbering. */
const BODY_OWNED_SIGNAL_IDS = new Set<string>([
  'sleep_debt_focus_quality',
  'cycle_phase_energy',
]);

interface RawFocusLogEntry {
  ts?: number;
  duration_min?: number;
  duration_ms?: number;
}

interface RawSleepRecord {
  night_of?: string;
  tst_min?: number | null;
  is_skipped?: boolean;
}

/**
 * Build a daily step-function phase array for the past `lookbackDays`.
 * Mirrors body.ts buildCyclePhases but emits {ts, phase} markers (the
 * shape signals.ts consumes) instead of ranges.
 */
function buildPhaseMarkers(
  cycles: unknown[],
  fromTs: number,
  toTs: number,
): SignalCyclePhase[] {
  if (!Array.isArray(cycles) || cycles.length === 0) return [];
  const out: SignalCyclePhase[] = [];
  let lastPhase: string | null = null;
  for (let t = fromTs; t <= toTs; t += DAY_MS) {
    let phase: string | null;
    try {
      phase = computePhaseForDate(
        cycles as Parameters<typeof computePhaseForDate>[0],
        t,
      );
    } catch {
      phase = null;
    }
    if (phase == null || phase === 'unknown') continue;
    if (phase !== lastPhase) {
      out.push({ ts: t, phase });
      lastPhase = phase;
    }
  }
  return out;
}

export interface RunBodySignalsOpts {
  now?: number;
}

/**
 * Compute body-owned cross-module signals and merge them into shared.signals.
 * Idempotent — safe to call on every recompute pass.
 */
export function runBodySignalsPass(
  store: Store,
  opts: RunBodySignalsOpts = {},
): BodySignal[] {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();

  // ── gather cross-module inputs ──────────────────────────────────────────
  const rawCycles = store.get<unknown[]>('cycle', 'cycles', []) ?? [];
  const rawSleep = store.get<RawSleepRecord[]>('sleep', 'records', []) ?? [];
  const rawFocus = store.get<RawFocusLogEntry[]>('work', 'focus_log', []) ?? [];

  const sleepNights: SignalSleepNight[] = (Array.isArray(rawSleep) ? rawSleep : [])
    .filter((r): r is RawSleepRecord => !!r && typeof r.night_of === 'string')
    .map((r) => ({
      night_of: r.night_of as string,
      tst_min: typeof r.tst_min === 'number' ? r.tst_min : null,
      is_skipped: r.is_skipped === true,
    }));

  const focusSessions: SignalFocusSession[] = (Array.isArray(rawFocus) ? rawFocus : [])
    .filter(
      (f): f is Required<RawFocusLogEntry> =>
        !!f &&
        typeof f.ts === 'number' &&
        typeof f.duration_min === 'number' &&
        typeof f.duration_ms === 'number',
    )
    .map((f) => ({
      ts: f.ts,
      duration_min: f.duration_min,
      duration_ms: f.duration_ms,
    }));

  const cyclePhases = buildPhaseMarkers(rawCycles, now - 90 * DAY_MS, now);

  // ── detect ──────────────────────────────────────────────────────────────
  const signals = detectBodySignals(
    { now, sleepNights, focusSessions, cyclePhases },
  );

  // ── merge into shared.signals without clobbering other modules ─────────
  // Drop the body-owned signal ids from the previous array and re-append the
  // freshly computed ones. Signals owned by other modules are left intact.
  const prev = store.get<unknown[]>('shared', 'signals', []) ?? [];
  const kept = (Array.isArray(prev) ? prev : []).filter((s) => {
    const id = (s as { id?: unknown })?.id;
    return typeof id === 'string' && !BODY_OWNED_SIGNAL_IDS.has(id);
  });
  const next = [...kept, ...signals];

  store.set('shared', 'signals', next);
  store.set('shared', 'signalsLastComputedAt', now);

  return signals;
}
