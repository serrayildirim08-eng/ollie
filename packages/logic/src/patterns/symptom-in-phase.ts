/**
 * @ollie/logic/patterns · symptom_in_phase detector
 *
 * Does this symptom tag cluster in a single cycle phase across at least
 * 3 cycles, with > 60% of occurrences in that phase?
 */

import type { CycleRecord, SymptomEvent } from '../cycle/types';
import { closedCycles, cooldownFilter, isIrregular, phaseFold } from './phase-fold';
import type { CyclePhase, DetectorOptions, SymptomInPhasePattern } from './types';

export function detectSymptomInPhase(
  cycles: readonly CycleRecord[] | undefined | null,
  symptomEvents: readonly SymptomEvent[] | undefined | null,
  tag: string,
  opts: DetectorOptions = {},
): SymptomInPhasePattern | null {
  const tagLower = (tag || '').toLowerCase().trim();
  if (!tagLower) return null;

  const closed = closedCycles(cycles);
  if (closed.length < 3) return null;
  if (isIrregular(closed)) return null;
  const eligible = cooldownFilter(closed, opts.lastEditedByCycle, opts.now);
  if (eligible.length < 3) return null;

  const matched = (symptomEvents || []).filter(
    (e) => !!e && typeof e.ts === 'number' && (e.text || '').toLowerCase().includes(tagLower),
  );
  if (matched.length === 0) return null;

  const folded = phaseFold(eligible, matched);
  const cycleSet = new Set(folded.map((f) => f.cycleIdx));
  if (cycleSet.size < 3) return null;

  const phaseCount: Record<CyclePhase, number> = {
    menstrual: 0,
    follicular: 0,
    'ovulation window': 0,
    luteal: 0,
  };
  for (const f of folded) phaseCount[f.phase]++;
  const total = folded.length;
  let topPhase: CyclePhase = 'luteal';
  let topCount = 0;
  for (const phase of Object.keys(phaseCount) as CyclePhase[]) {
    if (phaseCount[phase] > topCount) {
      topPhase = phase;
      topCount = phaseCount[phase];
    }
  }
  const share = topCount / total;
  if (share <= 0.6) return null;

  return {
    id: 'symptom_in_phase:' + tagLower,
    type: 'symptom_in_phase',
    cycles: cycleSet.size,
    copy: `${tagLower} — ${topPhase} phase, ${cycleSet.size} cycles.`,
    subcopy: 'pattern, not medical.',
    meta: { tag: tagLower, phase: topPhase, share, occurrences: total },
  };
}
