/**
 * @ollie/logic · stats — the single source of truth for statistical
 * primitives.
 *
 * Background: mean / median / variance / sd / Pearson / Spearman were
 * reimplemented ~6× across patterns, body, predict, cycle, finance and
 * sleep. Two of those median copies (finance/reports.ts and
 * body/correlations/workout-skip-mood.ts) had a real bug — they returned
 * the upper-middle element of an even-length array instead of averaging
 * the two middle elements, so for `[1, 3]` they returned 3 instead of 2.
 *
 * This module fixes that bug once and is now imported by every consumer.
 * The old per-module math files re-export from here so existing import
 * paths keep working without churn.
 *
 * Contract: pure functions, no I/O, no clock reads. Callers validate
 * their own input domains; these helpers only guard against empty/degenerate
 * arrays as documented per function.
 */

// ─── central tendency ─────────────────────────────────────────────────────────

/** Sum of a numeric array. Empty → 0. */
export function sum(arr: readonly number[]): number {
  return arr.reduce((s, x) => s + x, 0);
}

/** Arithmetic mean. Empty → 0. */
export function mean(arr: readonly number[]): number {
  return arr.length ? sum(arr) / arr.length : 0;
}

/**
 * Median. Correctly averages the two middle elements for even-length
 * input. Empty → 0. Does not mutate the input.
 */
export function median(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// ─── dispersion ────────────────────────────────────────────────────────────────

/** Population variance (divides by n). Empty → 0. */
export function variance(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
}

/** Population standard deviation (sqrt of population variance). */
export function stdev(arr: readonly number[]): number {
  return Math.sqrt(variance(arr));
}

/**
 * Sample standard deviation (divides by n-1, Bessel-corrected).
 * Fewer than 2 values → 0.
 */
export function sampleSd(arr: readonly number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

/**
 * Median absolute deviation. `scale = 1.4826` (Rousseeuw & Croux) makes
 * MAD a consistent estimator of σ for normal data; pass `scale = 1` for
 * the raw MAD. `center` defaults to the median of the input.
 */
export function mad(arr: readonly number[], scale = 1.4826, center?: number): number {
  if (arr.length === 0) return 0;
  const c = center != null ? center : median(arr);
  return scale * median(arr.map((x) => Math.abs(x - c)));
}

// ─── ranking + correlation ─────────────────────────────────────────────────────

/** Mid-rank assignment for ties (average of contiguous indices, 1-based). */
export function ranks(arr: readonly number[]): number[] {
  const n = arr.length;
  const idx = arr.map((v, i): [number, number] => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

/**
 * Pearson product-moment correlation. Returns 0 for degenerate input
 * (mismatched length, fewer than 2 points, or zero variance in either
 * series).
 */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  if (!Array.isArray(xs) || !Array.isArray(ys)) return 0;
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Spearman rank correlation ρ. Tie-aware (mid-ranks). Returns 0 for
 * degenerate input.
 */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (!Array.isArray(xs) || !Array.isArray(ys)) return 0;
  if (xs.length !== ys.length || xs.length < 2) return 0;
  return pearson(ranks(xs), ranks(ys));
}

// ─── seeded RNG + resampling ───────────────────────────────────────────────────

/** Seeded RNG — deterministic across machines (mulberry32). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Benjamini–Hochberg false-discovery-rate adjustment. */
export function bhAdjust(pValues: readonly number[], q = 0.1): boolean[] {
  const m = pValues.length;
  if (m === 0) return [];
  const sorted = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let kMax = -1;
  for (let k = 0; k < m; k++) {
    if (sorted[k].p <= ((k + 1) / m) * q) kMax = k;
  }
  const rejected = new Array<boolean>(m).fill(false);
  for (let k = 0; k <= kMax; k++) rejected[sorted[k].i] = true;
  return rejected;
}

/** Paired bootstrap confidence interval for a two-sample statistic. */
export function bootstrapCI(
  xs: readonly number[],
  ys: readonly number[],
  statFn: (xs: number[], ys: number[]) => number,
  iters = 1000,
  alpha = 0.1,
  rng: () => number = mulberry32(iters),
): [number, number] {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return [NaN, NaN];
  const stats = new Array<number>(iters);
  for (let b = 0; b < iters; b++) {
    const bx = new Array<number>(n);
    const by = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      bx[i] = xs[j];
      by[i] = ys[j];
    }
    stats[b] = statFn(bx, by);
  }
  stats.sort((a, b) => a - b);
  const lo = stats[Math.max(0, Math.floor((alpha / 2) * iters))];
  const hi = stats[Math.min(iters - 1, Math.ceil((1 - alpha / 2) * iters) - 1)];
  return [lo, hi];
}
