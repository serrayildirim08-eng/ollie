/**
 * Grocery · pantry aging state machine.
 *
 * Pure module — no React, no IO, no clock. Caller passes `nowMs` so tests
 * can exercise every boundary deterministically.
 *
 * Product rule (locked 2026-05-30):
 *   - `shelfLifeDays × 1.0` — visually faded (still on the list, dim ink).
 *   - `shelfLifeDays × 1.5` — a quiet "still here?" affordance appears.
 *   - `shelfLifeDays × 2.0` — the row auto-archives (out of the active list).
 *   - shelfLifeDays === null → 'fresh' forever (we don't know the item, so
 *     pretending we do would surface false signals; silence wins).
 *
 * NOT a streak system. NOT a countdown. Visual aging only — ADHD-safe.
 *
 * Boundaries are half-open intervals on `elapsed = nowMs − addedAtMs`,
 * converted to days. The shape:
 *
 *   elapsed < 1.0 × shelf      → fresh
 *   1.0 × shelf ≤ … < 1.5 ×    → faded
 *   1.5 × shelf ≤ … < 2.0 ×    → still_here_prompt
 *   2.0 × shelf ≤ …            → should_archive
 *
 * A row at exactly the boundary (e.g. elapsed === 1.5 × shelf) graduates
 * to the *next* state, matching the "as soon as it's been 1.5×, ask" intent.
 */

export type AgingState =
  | 'fresh'
  | 'faded'
  | 'still_here_prompt'
  | 'should_archive';

const MS_PER_DAY = 86_400_000;

/**
 * Decide which aging band a row sits in. `shelfLifeDays === null`
 * (or non-finite, or ≤ 0) means "unknown / no aging" → always 'fresh'.
 */
export function ageOf(
  addedAtMs: number,
  shelfLifeDays: number | null,
  nowMs: number,
): AgingState {
  if (shelfLifeDays == null) return 'fresh';
  if (!Number.isFinite(shelfLifeDays) || shelfLifeDays <= 0) return 'fresh';

  const elapsedDays = (nowMs - addedAtMs) / MS_PER_DAY;
  if (elapsedDays < shelfLifeDays) return 'fresh';
  if (elapsedDays < shelfLifeDays * 1.5) return 'faded';
  if (elapsedDays < shelfLifeDays * 2.0) return 'still_here_prompt';
  return 'should_archive';
}
