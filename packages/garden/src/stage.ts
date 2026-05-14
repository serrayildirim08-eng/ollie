/**
 * Burhan growth stage. Append-only progression driven by active-day count;
 * never regresses (consistent with the "Burhan never decays" constitutional
 * rule in @ollie/logic/burhan).
 */
export type Stage = 'seedling' | 'sapling' | 'young' | 'mature' | 'ancient';

/**
 * Pure: map an active-day count to a growth stage.
 *
 *   0     → seedling
 *   1–6   → seedling
 *   7–29  → sapling
 *   30–89 → young
 *   90–364→ mature
 *   365+  → ancient
 *
 * Thresholds match v3 brief verbatim.
 */
export function getStage(activeDays: number): Stage {
  if (activeDays >= 365) return 'ancient';
  if (activeDays >= 90) return 'mature';
  if (activeDays >= 30) return 'young';
  if (activeDays >= 7) return 'sapling';
  return 'seedling';
}
