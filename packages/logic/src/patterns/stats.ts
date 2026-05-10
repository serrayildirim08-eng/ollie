/**
 * @ollie/logic/patterns · stats
 *
 * Pure statistical primitives shared across the pattern detectors:
 *   - Spearman rank correlation
 *   - Benjamini–Hochberg FDR adjustment
 *   - Seeded RNG (mulberry32) + bootstrap CI
 */

export function mean(arr: readonly number[]): number {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
}

export function sampleSd(arr: readonly number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

/** Seeded RNG — deterministic across machines. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mid-rank assignment for ties (avg of contiguous indices, 1-based). */
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

export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) return 0;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = rx[i] - mx;
    const b = ry[i] - my;
    num += a * b;
    dx2 += a * a;
    dy2 += b * b;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
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
