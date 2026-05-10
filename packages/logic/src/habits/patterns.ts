/**
 * @ollie/logic · habits detectPatterns
 *
 * Runs all tier-0 private detectors in sequence — mirrors the
 * detectPatterns method of the VOID IIFE. Swallows individual
 * detector errors so a single failure never kills the batch.
 */

import type { HabitsHistory, HabitsOpts, AnyHabitsResult } from './types';
import {
  detectExternalizationGap,
  detectLutealCollapseLegacy,
  detectStressCollapseLegacy,
  detectSensoryFlag,
  detectInterestHijackLegacy,
  detectFreshStartCrashLegacy,
  detectIdentityTraitFramingLegacy,
  detectBodyVsCognitiveLegacy,
  detectHabitDriftLegacy,
  detectFrictionSignatureLegacy,
  detectSleepHabitCouplingLegacy,
  detectHabitRebirthLegacy,
  detectSelfTalkCouplingLegacy,
} from './detectors-tier0';
import { detectHyperfocusSpillover, detectKeystoneAnchor, detectMedAdherenceCoupling } from './detectors-cross-module';

type Detector = (h: HabitsHistory, opts?: HabitsOpts) => AnyHabitsResult | null;

const ALL_DETECTORS: Detector[] = [
  detectExternalizationGap,
  detectLutealCollapseLegacy,
  detectStressCollapseLegacy,
  detectSensoryFlag,
  detectInterestHijackLegacy,
  detectFreshStartCrashLegacy,
  detectIdentityTraitFramingLegacy,
  detectBodyVsCognitiveLegacy,
  detectHabitDriftLegacy,
  detectFrictionSignatureLegacy,
  detectSleepHabitCouplingLegacy,
  detectHabitRebirthLegacy,
  detectSelfTalkCouplingLegacy,
  // Phase 3 cross-module consumer
  detectHyperfocusSpillover,
  // Phase 4 cross-module consumers
  detectKeystoneAnchor,
  detectMedAdherenceCoupling,
];

export function detectPatterns(
  history: HabitsHistory,
  opts?: HabitsOpts,
): AnyHabitsResult[] {
  const out: AnyHabitsResult[] = [];
  for (const fn of ALL_DETECTORS) {
    try {
      const r = fn(history, opts);
      if (r != null) out.push(r);
    } catch {
      // never let a single detector crash the batch
    }
  }
  return out;
}
