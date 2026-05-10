/**
 * @ollie/logic · body math helpers
 *
 * Pure statistical utilities. No I/O.
 */

/** Format an epoch ms timestamp as YYYY-MM-DD. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Pearson r on two equal-length arrays. Returns 0 for degenerate input. */
export function pearson(xs: number[], ys: number[]): number {
  if (!Array.isArray(xs) || !Array.isArray(ys)) return 0;
  if (xs.length !== ys.length || xs.length < 3) return 0;
  const n = xs.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** Rank array for Spearman (handles ties via average rank). */
export function rank(arr: number[]): number[] {
  const n = arr.length;
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1].v === indexed[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Spearman ρ. Returns 0 for degenerate input. */
export function spearman(xs: number[], ys: number[]): number {
  if (!Array.isArray(xs) || !Array.isArray(ys)) return 0;
  if (xs.length !== ys.length || xs.length < 3) return 0;
  return pearson(rank(xs), rank(ys));
}

/** Next calendar day key (YYYY-MM-DD → YYYY-MM-DD + 1 day). */
export function nextDayKey(k: string): string | null {
  const t = Date.parse(k + 'T12:00:00');
  if (!isFinite(t)) return null;
  const d = new Date(t + 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
