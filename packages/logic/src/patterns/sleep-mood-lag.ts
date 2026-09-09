/**
 * @ollie/logic/patterns · sleep_mood_lag detector
 *
 * Daily series: TST (hours) vs. mood-tag flag per day. Tag v1 = FATIGUE.
 * For each lag L ∈ {-3..+3}, Spearman ρ between sleep[d] and mood[d+L].
 * Peak-|ρ| lag surfaces when:
 *   - N ≥ minSampleDays overlapping pairs (default 21)
 *   - |ρ| ≥ minAbsRho (default 0.3)
 *   - it survives multiplicity control across the WHOLE 7-lag family.
 *
 * Finding #105: picking the peak-|ρ| over 7 lags and then running a SINGLE
 * bootstrap CI on that winner is post-selection inference — the winner's CI
 * is optimistically narrow because we conditioned on it being the max, so
 * false positives are inflated (~7× the nominal rate in the worst case).
 *
 * Honest fix (two complementary corrections):
 *   1. Per-lag bootstrap two-sided p-values for every eligible lag, then
 *      Benjamini–Hochberg across the family — the peak must survive BH(q).
 *   2. The reported CI for the peak is Bonferroni-widened (alpha/numEligible),
 *      so the surfaced interval reflects the multiplicity it was chosen from.
 */

import { mulberry32, spearman, bootstrapCI, bhAdjust } from './stats';
import { dayKey } from '../util';
import type { Confidence, DumpEntry, DetectorOptions, SleepMoodLagPattern, SleepSession } from './types';

const FATIGUE_RE = /\b(tired|exhausted|wiped|drained|wrecked|burnt out|knackered|yorgun|bitkin|halsiz)\b/i;

// Local-time day key — delegates to the shared util.
const dayKeyFromTs = dayKey;

// Pure date-string arithmetic: parses the YYYY-MM-DD key as UTC and shifts
// by whole days. NOT a dayKey reimplementation — keeps key→key semantics
// independent of host timezone, so it stays local to this module.
function addDays(key: string, n: number): string {
  const [y, m, dd] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, dd));
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface SleepMoodLagOptions extends DetectorOptions {
  minSampleDays?: number;
  minAbsRho?: number;
  minPerLag?: number;
  lags?: number[];
  seed?: number;
  /** Benjamini–Hochberg false-discovery rate for the lag family (#105). */
  fdrQ?: number;
}

/**
 * Bootstrap two-sided p-value for H0: ρ == 0, by resampling pairs and
 * measuring how often the bootstrap statistic lands on the opposite side of
 * zero from the point estimate (then doubling). Uses an additive-smoothed
 * count so a zero-crossing-free bootstrap yields p = 1/(iters+1), not 0.
 */
function bootstrapPValue(
  xs: readonly number[],
  ys: readonly number[],
  pointEst: number,
  iters: number,
  rng: () => number,
): number {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return 1;
  const sign = pointEst >= 0 ? 1 : -1;
  let opposite = 0;
  for (let b = 0; b < iters; b++) {
    const bx = new Array<number>(n);
    const by = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      bx[i] = xs[j];
      by[i] = ys[j];
    }
    const r = spearman(bx, by);
    if (!Number.isFinite(r)) { opposite++; continue; }
    if (sign * r <= 0) opposite++;
  }
  const oneSided = (opposite + 1) / (iters + 1);
  return Math.min(1, 2 * oneSided);
}

export function detectSleepMoodLag(
  sleepSessions: readonly SleepSession[] | undefined | null,
  dumps: readonly DumpEntry[] | undefined | null,
  opts: SleepMoodLagOptions = {},
): SleepMoodLagPattern | null {
  const minSampleDays = opts.minSampleDays ?? 21;
  const minAbsRho = opts.minAbsRho ?? 0.3;
  const minPerLag = opts.minPerLag ?? 10;
  const lags = opts.lags ?? [-3, -2, -1, 0, 1, 2, 3];
  const seed = opts.seed ?? 42;
  const fdrQ = opts.fdrQ ?? 0.1;

  const sleepByDay = new Map<string, number>();
  for (const s of sleepSessions || []) {
    if (!s || typeof s.ts !== 'number' || typeof s.tstMinutes !== 'number') continue;
    sleepByDay.set(dayKeyFromTs(s.ts), s.tstMinutes / 60);
  }
  if (sleepByDay.size < minSampleDays) return null;

  const moodByDay = new Map<string, 0 | 1>();
  for (const d of dumps || []) {
    if (!d || typeof d.ts !== 'number') continue;
    const text = String(d.rawText || d.text || '');
    const k = dayKeyFromTs(d.ts);
    const hit = FATIGUE_RE.test(text);
    if (hit) moodByDay.set(k, 1);
    else if (!moodByDay.has(k)) moodByDay.set(k, 0);
  }
  if (moodByDay.size < 5) return null;

  // Build EVERY eligible lag's series first (the whole family), so we can
  // apply multiplicity control across all of them rather than only the winner.
  type Cand = { L: number; rho: number; xs: number[]; ys: number[]; n: number };
  const cands: Cand[] = [];
  for (const L of lags) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [d, tst] of sleepByDay) {
      const moodDay = addDays(d, L);
      const mood = moodByDay.get(moodDay);
      if (mood !== undefined) {
        xs.push(tst);
        ys.push(mood);
      }
    }
    if (xs.length < minPerLag) continue;
    const rho = spearman(xs, ys);
    if (!Number.isFinite(rho)) continue;
    cands.push({ L, rho, xs, ys, n: xs.length });
  }
  if (cands.length === 0) return null;

  // Peak-|ρ| lag (the selection step that creates the bias #105 corrects for).
  let best: Cand = cands[0];
  for (const c of cands) if (Math.abs(c.rho) > Math.abs(best.rho)) best = c;
  if (Math.abs(best.rho) < minAbsRho) return null;
  if (best.n < minSampleDays) return null;

  // #105 — multiplicity control. One seeded RNG drives every bootstrap so the
  // result stays deterministic across the family.
  const rng = mulberry32(seed);
  const m = cands.length;
  const pValues = cands.map((c) => bootstrapPValue(c.xs, c.ys, c.rho, 1000, rng));
  const rejected = bhAdjust(pValues, fdrQ);
  const bestIdx = cands.indexOf(best);
  // The selected peak lag must survive Benjamini–Hochberg across the family.
  if (!rejected[bestIdx]) return null;

  // Report a Bonferroni-widened CI for the peak: dividing alpha by the number
  // of eligible lags acknowledges the interval was chosen as the maximum.
  const widenedAlpha = 0.1 / m;
  const ci = bootstrapCI(best.xs, best.ys, (xs, ys) => spearman(xs, ys), 1000, widenedAlpha, rng);
  if (!Number.isFinite(ci[0]) || !Number.isFinite(ci[1])) return null;
  if (ci[0] <= 0 && ci[1] >= 0) return null;

  const absRho = Math.abs(best.rho);
  const confidence: Confidence = absRho >= 0.5 ? 'high' : absRho >= 0.4 ? 'medium' : 'low';
  const lagStr =
    best.L === 0
      ? 'the same day'
      : best.L > 0
        ? `${best.L} day${best.L === 1 ? '' : 's'} later`
        : `${Math.abs(best.L)} day${best.L === -1 ? '' : 's'} before`;
  const dir =
    best.rho < 0
      ? 'you mention "tired" less on days following more sleep'
      : 'you mention "tired" more on days following more sleep';

  const sleepDates = Array.from(sleepByDay.keys()).sort();

  return {
    id: 'sleep_mood_lag:tired',
    type: 'sleep_mood_lag',
    pattern: 'sleep-mood-lag',
    confidence,
    sample_n: best.n,
    date_range: { start: sleepDates[0], end: sleepDates[sleepDates.length - 1] },
    peak_lag_days: best.L,
    peak_rho: Number(best.rho.toFixed(3)),
    ci_90: [Number(ci[0].toFixed(3)), Number(ci[1].toFixed(3))],
    tag: 'tired',
    copy: `${dir}, peaking at lag ${lagStr}. rho=${best.rho.toFixed(2)}, ${best.n} overlapping days. pattern, not cause.`,
    subcopy: 'pattern, not medical.',
    modules: ['sleep', 'journal'],
  };
}
