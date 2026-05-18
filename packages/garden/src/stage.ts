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

/**
 * v1 water thresholds for Burhan's stage (GARDEN_GAME_DESIGN.md §5 +
 * decision #8 — Burhan runs on the water economy). Each unit is one
 * deliberate "water ollie" pour, so thresholds are gentle compared to
 * the active-day scale above. Append-only; tunable in the balance phase.
 *
 *   0–2   → seedling
 *   3–7   → sapling
 *   8–17  → young
 *   18–39 → mature
 *   40+   → ancient
 */
export function getStageFromWater(waterPoured: number): Stage {
  if (waterPoured >= 40) return 'ancient';
  if (waterPoured >= 18) return 'mature';
  if (waterPoured >= 8) return 'young';
  if (waterPoured >= 3) return 'sapling';
  return 'seedling';
}
