/**
 * @ollie/logic · brain public API
 *
 * The silent-observer brain's pure computations: deferral tracking, harm-of-
 * deferral detection, and the daily capacity read. All pure — no I/O, no DOM,
 * no wall-clock reads (callers pass `now`). Native modules own the capture +
 * persistence; this package owns only the math.
 */

export { computeDeferral } from './deferral';
export type { DeferralTask, DeferralSignal } from './deferral';

export { detectHarm } from './harm';
export type {
  HarmKind,
  HarmEvent,
  HarmInputs,
  HarmPantryItem,
  HarmBill,
  HarmDeadlineItem,
} from './harm';

export { computeCapacity } from './capacity';
export type { CapacityLevel, CapacityInputs, CapacityRead } from './capacity';
