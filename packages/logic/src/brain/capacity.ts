/**
 * @ollie/logic · brain · energy / capacity reading
 *
 * Infers a daily capacity read — 'low' | 'medium' | 'high' — from signals
 * the user ALREADY produces: their most recent sleep, recent mood, and how
 * much they've already done today. Pure scoring (no I/O, no clock reads); the
 * native wiring gathers the inputs from the store and persists the result.
 *
 * This is a QUIET read — it never nags and never gets its own screen. The
 * brain uses it to soften / defer optional offers on a low-capacity day. No
 * shame: a 'low' read means "go easy", not "you're failing".
 *
 * Scoring (additive, then bucketed):
 *   sleep:   good night → +1, rough night → −1, unknown → 0
 *   mood:    recent low → −1, recent high → +1, neutral/unknown → 0
 *   load:    a heavy day (many captures already) → −1 (running on empty),
 *            a light day → 0. (High load LOWERS capacity — the user has
 *            already spent today's spoons.)
 *
 *   total >=  1 → 'high'
 *   total <= -1 → 'low'
 *   else        → 'medium'
 */

export type CapacityLevel = 'low' | 'medium' | 'high';

export interface CapacityInputs {
  /**
   * Most recent night's sleep hours, when known. Null → unknown (no
   * contribution). Used with `sleepQuality` — either signal alone suffices.
   */
  lastSleepHours?: number | null;
  /** Most recent sleep quality 1–5, when known. Null → unknown. */
  sleepQuality?: number | null;
  /**
   * Recent mood read: 'low' | 'neutral' | 'high', or a numeric valence
   * (negative = low, positive = high). Null/undefined → unknown.
   */
  recentMood?: 'low' | 'neutral' | 'high' | number | null;
  /** How many captures / dumps the user has logged so far today. */
  todayLoad?: number | null;
}

export interface CapacityRead {
  level: CapacityLevel;
  /** ms-since-epoch the read was computed (= the `now` passed in). */
  computedAt: number;
}

/** Sleep contribution: good night +1, rough night −1, unknown 0. */
function sleepScore(hours: number | null | undefined, quality: number | null | undefined): number {
  let score = 0;
  if (typeof hours === 'number' && Number.isFinite(hours)) {
    if (hours >= 7) score += 1;
    else if (hours < 6) score -= 1;
  }
  if (typeof quality === 'number' && Number.isFinite(quality)) {
    if (quality >= 4) score += 1;
    else if (quality <= 2) score -= 1;
  }
  // Clamp to [-1, 1] so sleep can't dominate the whole read.
  return Math.max(-1, Math.min(1, score));
}

/** Mood contribution: low −1, high +1, neutral/unknown 0. */
function moodScore(mood: CapacityInputs['recentMood']): number {
  if (mood == null) return 0;
  if (typeof mood === 'number') {
    if (!Number.isFinite(mood)) return 0;
    if (mood < 0) return -1;
    if (mood > 0) return 1;
    return 0;
  }
  if (mood === 'low') return -1;
  if (mood === 'high') return 1;
  return 0;
}

/**
 * Load contribution: a heavy day spends spoons, but being BUSY is not the same
 * as being DEPLETED — lots of captures ≠ overwhelmed. So load only DAMPENS
 * (−0.5); on its own it can't push capacity to 'low'. It tips the read down
 * only when combined with a real depletion signal (poor sleep or low mood).
 */
function loadScore(load: number | null | undefined): number {
  if (typeof load !== 'number' || !Number.isFinite(load)) return 0;
  return load >= 6 ? -0.5 : 0;
}

/**
 * Compute today's capacity read. Pure: never throws, never reads the clock.
 * The caller passes `now` so the stored `computedAt` is deterministic in tests.
 */
export function computeCapacity(inputs: CapacityInputs, now: number): CapacityRead {
  const total =
    sleepScore(inputs.lastSleepHours, inputs.sleepQuality) +
    moodScore(inputs.recentMood) +
    loadScore(inputs.todayLoad);

  const level: CapacityLevel = total >= 1 ? 'high' : total <= -1 ? 'low' : 'medium';
  return { level, computedAt: now };
}
