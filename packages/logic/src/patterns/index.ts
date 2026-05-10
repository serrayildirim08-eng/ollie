/**
 * @ollie/logic/patterns — cross-module pattern detection (small-N)
 *
 * Invariants (enforced inside every detector, never optional):
 *   - run_length ≥ 3 cycles of overlapping evidence (principle 2.13)
 *   - 72h edit cooldown for recently edited cycles (principle 2.17)
 *   - irregular guard: empirical σ > 7 days suppresses phase-based
 *     patterns (principle 2.14)
 *   - copy is deadpan / lowercase / no exclamation (principle 1.1)
 *
 * Pure. No store reads, no events, no wall-clock — callers pass `now`.
 */

import type { CycleRecord, SymptomEvent } from '../cycle/types';
import { detectSymptomInPhase } from './symptom-in-phase';
import { detectSleepCycleLag } from './sleep-cycle-lag';
import { detectFinanceCycleSpend } from './finance-cycle-spend';
import { detectSleepMoodLag } from './sleep-mood-lag';
import type {
  DumpEntry,
  FinanceTransaction,
  PatternResult,
  SleepSession,
} from './types';

export type {
  PatternResult,
  SymptomInPhasePattern,
  SleepCycleLagPattern,
  FinanceCycleSpendPattern,
  SleepMoodLagPattern,
  SleepSession,
  FinanceTransaction,
  DumpEntry,
  DetectorOptions,
} from './types';

export {
  detectSymptomInPhase,
  detectSleepCycleLag,
  detectFinanceCycleSpend,
  detectSleepMoodLag,
};
export * from './stats';
export * from './phase-fold';

export interface DetectPatternsInput {
  cycles?: readonly CycleRecord[];
  symptomEvents?: readonly SymptomEvent[];
  sleepSessions?: readonly SleepSession[];
  transactions?: readonly FinanceTransaction[];
  dumps?: readonly DumpEntry[];
  tags?: readonly string[];
  lastEditedByCycle?: Record<number, number>;
  now?: number;
}

const DEFAULT_TAGS = ['cramps', 'bloating', 'fatigue', 'headache', 'anxiety', 'mood'];

export function detectPatterns(input: DetectPatternsInput = {}): PatternResult[] {
  const opts = { lastEditedByCycle: input.lastEditedByCycle, now: input.now };
  const out: PatternResult[] = [];
  for (const tag of input.tags ?? DEFAULT_TAGS) {
    const p = detectSymptomInPhase(input.cycles, input.symptomEvents, tag, opts);
    if (p) out.push(p);
  }
  const sleep = detectSleepCycleLag(input.cycles, input.sleepSessions, opts);
  if (sleep) out.push(sleep);
  const finance = detectFinanceCycleSpend(input.cycles, input.transactions, opts);
  if (finance) out.push(finance);
  const sleepMood = detectSleepMoodLag(input.sleepSessions, input.dumps, opts);
  if (sleepMood) out.push(sleepMood);
  return out;
}
