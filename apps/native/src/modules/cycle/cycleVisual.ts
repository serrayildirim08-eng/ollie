/**
 * Cycle olive-tree visual · PURE helper.
 *
 * Maps "where you are in the cycle" → how the olive tree should look. The
 * tree is the cycle's *feeling*, not a clock: it sprouts after a period,
 * fills with leaves through the follicular phase, is fullest around
 * ovulation (bold olives appear), stays full + green through the luteal
 * phase, then sheds when the period arrives and restarts as a sprout.
 *
 * Deterministic + tiny on purpose. No predictions, no risk scoring — this
 * just shapes a calm visual. The CycleTree component owns the geometry; this
 * owns only the single `growth` scalar + the `shedding` flag.
 *
 * Growth curve (≈28-day reference, but day-driven so it degrades gracefully
 * for any length):
 *   - period / bleeding days   → low (sprout) + shedding
 *   - day 1                    → ≈0.06 (a fresh sprout)
 *   - ramps up through         → follicular
 *   - mid-cycle (ovulation)    → peak ≈0.9
 *   - luteal                   → stays full (≈0.9)
 *
 * Phase is advisory: `bleeding` always wins for shedding, and an explicit
 * 'period'/'bleeding' phase forces the sprout even if the day math drifts.
 */

/** Reference cycle length used to place the ovulation peak (~mid-cycle). */
const REF_LENGTH = 28;
/** Day the growth curve reaches its peak — mid-cycle ovulation. */
const PEAK_DAY = 14;
/** Sprout floor on the very first day. */
const DAY1_GROWTH = 0.06;
/** Full-canopy ceiling reached at ovulation and held through luteal. */
const PEAK_GROWTH = 0.9;

export interface CycleVisual {
  /** 0..1 canopy fullness fed to <CycleTree growth={…} />. */
  growth: number;
  /** True on period/bleeding days — the tree sheds leaves + restarts. */
  shedding: boolean;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Phase strings that mean "the period is happening" → force a shedding sprout. */
function isPeriodPhase(phase: string): boolean {
  const p = phase.toLowerCase().trim();
  return p === 'period' || p === 'bleeding' || p === 'menstrual';
}

/**
 * Derive the tree's growth (0..1) + shedding flag for a given cycle day,
 * phase label, and live bleeding flag.
 *
 * @param day      1-based cycle day (day 1 = first day of the period).
 * @param phase    a phase label (e.g. 'bleeding', 'follicular', 'luteal').
 * @param bleeding live "still bleeding" flag from CurrentCycle.
 */
export function cycleVisual(
  day: number,
  phase: string,
  bleeding: boolean,
): CycleVisual {
  // Guard inputs — never trust a NaN/negative day from upstream math.
  const safeDay = Number.isFinite(day) ? Math.max(1, Math.floor(day)) : 1;
  const shedding = bleeding || isPeriodPhase(phase);

  // While shedding the tree is a low sprout regardless of the day count —
  // it has just dropped its leaves and is starting over. Ramp the sprout in
  // very gently over the first few period days so day 1 is the smallest.
  if (shedding) {
    // day 1 → 0.06, easing up to ~0.14 by the tail of a long bleed so it
    // never reads fuller than the post-period sprout.
    const g = DAY1_GROWTH + Math.min(0.08, (safeDay - 1) * 0.02);
    return { growth: clamp01(g), shedding: true };
  }

  if (safeDay <= 1) {
    return { growth: DAY1_GROWTH, shedding: false };
  }

  if (safeDay <= PEAK_DAY) {
    // Rising limb: day 1 sprout → ovulation peak. Smoothstep so the fill is
    // calm (slow start, slow finish) rather than a linear march.
    const t = clamp01((safeDay - 1) / (PEAK_DAY - 1));
    const eased = t * t * (3 - 2 * t); // smoothstep
    const g = DAY1_GROWTH + (PEAK_GROWTH - DAY1_GROWTH) * eased;
    return { growth: clamp01(g), shedding: false };
  }

  // Luteal: hold full + green. A whisper of decline past the typical length
  // so an over-long gap doesn't read as eternal summer, but never below
  // most-of-the-canopy.
  const over = Math.max(0, safeDay - REF_LENGTH);
  const g = PEAK_GROWTH - Math.min(0.12, over * 0.015);
  return { growth: clamp01(g), shedding: false };
}
