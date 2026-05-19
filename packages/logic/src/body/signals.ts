/**
 * @ollie/logic · body · cross-module signals
 *
 * "Signals" are insights that NO single module's own "noticed" panel could
 * ever surface, because they require correlating data from two modules at
 * once. They are deliberately distinct from per-module patterns:
 *
 *   - body patterns      → live inside body, about body data only
 *   - cross-module signals → span body ↔ sleep ↔ work ↔ cycle
 *
 * The body orchestrator owns the cross-module wiring (it already subscribes
 * to cycle + sleep), so signal computation lives here and is invoked from
 * orchestrator/body-signals.ts. UI reads the result from shared.signals.
 *
 * Pure: no store / DOM / wall-clock. `now` is always injected.
 */

import type { PatternSource } from './types';

// ─── Output shape ──────────────────────────────────────────────────────────────

/**
 * A cross-module signal written to shared.signals.
 *
 * Schema is the contract shared with BodyModule.SignalsSection, which
 * renders `id` / `copy` / `modules` / `sources` and dedupes/dismisses on
 * `id`. `modules` MUST always have ≥ 2 entries — the UI hard-filters on
 * that, so a mis-scoped single-module write can never leak into the panel.
 * `confidence` / `sample_n` are extra metadata for future consumers /
 * telemetry — harmless to the current UI.
 */
export interface BodySignal {
  /** Stable id — used for dedupe + dismissal. */
  id: string;
  /** Lawyer-readable, lowercase, deadpan. names the pattern, never prescribes. */
  copy: string;
  /** Modules whose data fed this signal — ALWAYS ≥ 2 (that is the point). */
  modules: string[];
  confidence: 'high' | 'medium' | 'low';
  sample_n: number;
  ts: number;
  sources?: Array<{ citation?: string; url?: string }>;
}

// ─── Inputs ────────────────────────────────────────────────────────────────────

/** Sleep night (subset of @ollie/logic/sleep SleepRecord). */
export interface SignalSleepNight {
  night_of: string;        // YYYY-MM-DD
  tst_min?: number | null;
  is_skipped?: boolean;
}

/** Focus session (subset of @ollie/logic/work FocusLogEntry). */
export interface SignalFocusSession {
  ts: number;              // session start, ms epoch
  duration_min: number;    // planned minutes
  duration_ms: number;     // actual elapsed ms
}

/** Step-function cycle phase marker — phase active from ts until next marker. */
export interface SignalCyclePhase {
  ts: number;
  phase: string;
}

export interface BodySignalsInput {
  now?: number;
  sleepNights?: SignalSleepNight[];
  focusSessions?: SignalFocusSession[];
  cyclePhases?: SignalCyclePhase[];
}

export interface BodySignalsOpts {
  /** Lookback window for both detectors. Default 28 days. */
  windowDays?: number;
  /** A night below this TST (minutes) counts as "short". Default 360 (6h). */
  shortNightMin?: number;
  /** Minimum focus sessions on each side of a split to call it. Default 4. */
  minSessionsPerSide?: number;
  /** Minimum completion-ratio gap to surface the sleep→focus signal. Default 0.15. */
  minRatioGap?: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

const SLEEP_SOURCE: PatternSource = {
  citation: 'Lim & Dinges 2010, Psychol Bull — A meta-analysis of the impact of short-term sleep deprivation on cognitive variables',
  url: 'https://doi.org/10.1037/a0018883',
};

const CYCLE_SOURCE: PatternSource = {
  citation: 'Le et al. 2020, Brain Sciences — Cyclical changes in the brain and cognition across the menstrual cycle',
  url: 'https://doi.org/10.3390/brainsci10040198',
};

/** Local-ish day key for a ms timestamp. */
function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse a YYYY-MM-DD night_of to a noon-epoch ts. */
function nightOfToTs(nightOf: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nightOf)) return null;
  const d = new Date(nightOf + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d.getTime();
}

/** Completion ratio of a focus session, clamped to [0, 1.5]. */
function completionRatio(s: SignalFocusSession): number {
  const planned = s.duration_min * 60_000;
  if (!(planned > 0)) return 0;
  const r = s.duration_ms / planned;
  return Math.max(0, Math.min(1.5, r));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

// ─── Detector 1: sleep debt → focus quality ────────────────────────────────────
//
// Splits focus sessions into two groups by whether the night BEFORE was
// short (< shortNightMin). Compares mean completion ratio. A meaningful drop
// after short nights is a signal the user cannot see from work alone (work
// has no sleep data) nor from sleep alone (sleep has no focus data).

export function detectSleepDebtFocusQuality(
  input: BodySignalsInput,
  opts?: BodySignalsOpts,
): BodySignal | null {
  const now = typeof input.now === 'number' ? input.now : Date.now();
  const windowDays = opts?.windowDays ?? 28;
  const shortNightMin = opts?.shortNightMin ?? 360;
  const minPerSide = opts?.minSessionsPerSide ?? 4;
  const minRatioGap = opts?.minRatioGap ?? 0.15;

  const windowStart = now - windowDays * DAY_MS;

  const sleep = Array.isArray(input.sleepNights) ? input.sleepNights : [];
  const focus = Array.isArray(input.focusSessions) ? input.focusSessions : [];
  if (sleep.length === 0 || focus.length === 0) return null;

  // tst_min keyed by night_of. A skipped/missing night is "unknown" — not short.
  const tstByNight: Record<string, number> = {};
  for (const n of sleep) {
    if (!n || typeof n.night_of !== 'string') continue;
    if (n.is_skipped) continue;
    if (typeof n.tst_min !== 'number' || !isFinite(n.tst_min)) continue;
    tstByNight[n.night_of] = n.tst_min;
  }

  const afterShort: number[] = [];
  const afterRested: number[] = [];

  for (const s of focus) {
    if (!s || typeof s.ts !== 'number') continue;
    if (s.ts < windowStart || s.ts > now) continue;
    if (typeof s.duration_min !== 'number' || typeof s.duration_ms !== 'number') continue;
    // "night before" = the night_of for the day prior to the session date.
    const prevNightKey = dayKeyOf(s.ts - DAY_MS);
    const tst = tstByNight[prevNightKey];
    if (tst == null) continue; // no sleep data for that night → cannot classify
    const ratio = completionRatio(s);
    if (tst < shortNightMin) afterShort.push(ratio);
    else afterRested.push(ratio);
  }

  if (afterShort.length < minPerSide || afterRested.length < minPerSide) return null;

  const shortMean = mean(afterShort);
  const restedMean = mean(afterRested);
  const gap = restedMean - shortMean;
  if (gap < minRatioGap) return null;

  const sampleN = afterShort.length + afterRested.length;
  const confidence: BodySignal['confidence'] =
    sampleN >= 16 && gap >= 0.25 ? 'high' : sampleN >= 10 ? 'medium' : 'low';

  const shortPct = Math.round(shortMean * 100);
  const restedPct = Math.round(restedMean * 100);

  return {
    id: 'sleep_debt_focus_quality',
    copy:
      `after a short night your focus sessions run to about ${shortPct}% of their planned length — ` +
      `${restedPct}% after a full night. sleep debt and focus quality look linked. pattern, not cause.`,
    modules: ['sleep', 'work'],
    confidence,
    sample_n: sampleN,
    ts: now,
    sources: [SLEEP_SOURCE],
  };
}

// ─── Detector 2: cycle phase → energy ──────────────────────────────────────────
//
// Compares total focus minutes per active day in the luteal phase vs the
// follicular phase. Surfaces only when the gap is real and both phases are
// well-sampled. Unseeable from cycle alone (no focus data) or work alone
// (no phase data).

export function detectCyclePhaseEnergy(
  input: BodySignalsInput,
  opts?: BodySignalsOpts,
): BodySignal | null {
  const now = typeof input.now === 'number' ? input.now : Date.now();
  const windowDays = opts?.windowDays ?? 28;
  const windowStart = now - windowDays * DAY_MS;

  const phases = (Array.isArray(input.cyclePhases) ? input.cyclePhases : [])
    .filter((p) => p && typeof p.ts === 'number' && typeof p.phase === 'string')
    .slice()
    .sort((a, b) => a.ts - b.ts);
  const focus = Array.isArray(input.focusSessions) ? input.focusSessions : [];
  if (phases.length === 0 || focus.length === 0) return null;

  const phaseAt = (ts: number): string | null => {
    let cur: string | null = null;
    for (const p of phases) {
      if (p.ts <= ts) cur = p.phase;
      else break;
    }
    return cur;
  };

  // Sum actual focus minutes per phase, and count distinct active days.
  const lutealMinByDay: Record<string, number> = {};
  const follicularMinByDay: Record<string, number> = {};

  for (const s of focus) {
    if (!s || typeof s.ts !== 'number') continue;
    if (s.ts < windowStart || s.ts > now) continue;
    if (typeof s.duration_ms !== 'number' || !isFinite(s.duration_ms)) continue;
    const phase = phaseAt(s.ts);
    if (phase == null) continue;
    const minutes = s.duration_ms / 60_000;
    const key = dayKeyOf(s.ts);
    if (phase === 'luteal') {
      lutealMinByDay[key] = (lutealMinByDay[key] ?? 0) + minutes;
    } else if (phase === 'follicular') {
      follicularMinByDay[key] = (follicularMinByDay[key] ?? 0) + minutes;
    }
  }

  const lutealDays = Object.keys(lutealMinByDay);
  const follicularDays = Object.keys(follicularMinByDay);
  // Need at least 3 active days in each phase to call it (principle: run ≥ 3).
  if (lutealDays.length < 3 || follicularDays.length < 3) return null;

  const lutealPerDay = mean(lutealDays.map((k) => lutealMinByDay[k]));
  const follicularPerDay = mean(follicularDays.map((k) => follicularMinByDay[k]));
  if (!(follicularPerDay > 0)) return null;

  // Only surface a *drop* in the luteal phase ≥ 25% relative.
  const dropRatio = 1 - lutealPerDay / follicularPerDay;
  if (dropRatio < 0.25) return null;

  const sampleN = lutealDays.length + follicularDays.length;
  const confidence: BodySignal['confidence'] =
    sampleN >= 14 && dropRatio >= 0.4 ? 'high' : sampleN >= 9 ? 'medium' : 'low';

  const lutealH = (lutealPerDay / 60).toFixed(1);
  const follicularH = (follicularPerDay / 60).toFixed(1);

  return {
    id: 'cycle_phase_energy',
    copy:
      `in your luteal phase you average about ${lutealH}h of focus a day — ` +
      `${follicularH}h in the follicular phase. energy may dip with the phase. pattern, not cause.`,
    modules: ['cycle', 'work'],
    confidence,
    sample_n: sampleN,
    ts: now,
    sources: [CYCLE_SOURCE],
  };
}

// ─── Aggregate ─────────────────────────────────────────────────────────────────

/**
 * Run every cross-module signal detector. Returns only the signals that
 * fired (each detector early-returns null when its evidence is too thin).
 */
export function detectBodySignals(
  input: BodySignalsInput,
  opts?: BodySignalsOpts,
): BodySignal[] {
  const out: BodySignal[] = [];
  const a = detectSleepDebtFocusQuality(input, opts);
  if (a) out.push(a);
  const b = detectCyclePhaseEnergy(input, opts);
  if (b) out.push(b);
  return out;
}
