/**
 * @ollie/garden · resource economy
 *
 * Two resources, no more. ADHD-safety rule: resources NEVER expire, never
 * decay, never reset. They only accumulate and get spent. See
 * GARDEN_GAME_DESIGN.md §3 + §9.
 *
 *   water  — earned from "showing up" (every life event). Frequent.
 *            Spent to grow Burhan + existing plants.
 *   seed   — earned from novelty (every Nth event). Occasional.
 *            Spent to plant something new into an open slot.
 */

export interface Resources {
  /** Spent to grow Burhan + plants. Earned every life event. */
  water: number;
  /** Spent to plant a new thing. Earned every Nth life event. */
  seed: number;
}

/** Water credited per life event. */
export const WATER_PER_EVENT = 1;

/** One seed every Nth life event — keeps expansion paced + special. */
export const EVENTS_PER_SEED = 4;

/**
 * Starting bank for a brand-new garden. Enough that the very first visit
 * has something to *do* immediately (GARDEN_GAME_DESIGN.md §8).
 */
export const STARTING_RESOURCES: Resources = { water: 5, seed: 3 };

/**
 * Pure: given a count of life events already credited (`creditedCount`)
 * and the new total event count, return the resources to ADD.
 *
 * Append-only by construction — burhan events never get removed or
 * reordered (see @ollie/logic/burhan constitution), so a simple count
 * cursor is safe and cannot double-credit.
 */
export function creditForEvents(
  creditedCount: number,
  totalEventCount: number,
): Resources {
  const newEvents = Math.max(0, totalEventCount - creditedCount);
  let seed = 0;
  // A seed lands each time the running total crosses a multiple of N.
  for (let n = creditedCount + 1; n <= totalEventCount; n++) {
    if (n % EVENTS_PER_SEED === 0) seed++;
  }
  return { water: newEvents * WATER_PER_EVENT, seed };
}
