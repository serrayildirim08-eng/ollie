/**
 * @ollie/logic · predict correlate
 *
 * Cross-stream correlation primitives. Pure — no I/O, no clock reads.
 */

import type {
  BhInput,
  CorrelateResult,
  CorrelationPair,
  ForecastOpts,
  JoinedPair,
  MmrCandidate,
  MmrOpts,
  Observation,
  StabilityResult,
} from './types';
import { DAY_MS } from './constants';
import { mean, normalCdf, _invNormalCdf, toSeries } from './math';

/** Align two timestamped streams by calendar window. */
export function joinStreams(
  streamA: Observation[],
  streamB: Observation[],
  opts?: { windowDays?: number; aggregator?: string },
): JoinedPair[] {
  const a = toSeries(streamA);
  const b = toSeries(streamB);
  if (!a.hasTs || !b.hasTs) return [];

  const o = opts ?? {};
  const windowDays = typeof o.windowDays === 'number' ? o.windowDays : 7;
  const aggregator = o.aggregator ?? 'mean';
  const result: JoinedPair[] = [];

  for (let i = 0; i < b.values.length; i++) {
    const anchorTs = b.ts[i]!;
    const windowStart = anchorTs - windowDays * DAY_MS;
    const inWindow: number[] = [];
    for (let j = 0; j < a.values.length; j++) {
      if (a.ts[j]! >= windowStart && a.ts[j]! <= anchorTs) inWindow.push(a.values[j]!);
    }
    let agg: number | null = null;
    if (inWindow.length > 0) {
      if (aggregator === 'mean') agg = mean(inWindow);
      else if (aggregator === 'sum') agg = inWindow.reduce((s, x) => s + x, 0);
      else if (aggregator === 'count') agg = inWindow.length;
      else if (aggregator === 'last') agg = inWindow[inWindow.length - 1]!;
      else {
        const sorted = inWindow.slice().sort((x, y) => x - y);
        const n = sorted.length;
        agg = n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
      }
    } else if (aggregator === 'count') {
      agg = 0;
    }
    result.push({ anchor: b.values[i]!, anchorTs, aggregate: agg, n: inWindow.length });
  }
  return result;
}

function _pearsonOn(
  xs: number[],
  ys: number[],
): { r: number; pValue: number; n: number; se: number | null } | null {
  const n = xs.length;
  if (n < 4) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]!; sy += ys[i]!; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return { r: 0, pValue: 1, n, se: null };
  const r = num / denom;
  const rClamped = Math.max(-0.9999, Math.min(0.9999, r));
  const z = 0.5 * Math.log((1 + rClamped) / (1 - rClamped));
  const seZ = 1 / Math.sqrt(n - 3);
  const zStat = Math.abs(z / seZ);
  const pValue = 2 * (1 - normalCdf(zStat));
  const seR = n > 2 ? Math.sqrt(Math.max(0, 1 - r * r) / (n - 2)) : null;
  return { r, pValue, n, se: seR };
}

/** Pearson correlation with approximate two-sided p-value. Requires ≥ 4 pairs. */
export function correlate(
  streamA: Observation[],
  streamB: Observation[],
  opts?: ForecastOpts & {
    windowDays?: number;
    aggregator?: string;
    minPairs?: number;
    minEffect?: number;
    maxP?: number;
    includePairs?: boolean;
  },
): CorrelateResult {
  const o = opts ?? {};
  const joined = joinStreams(streamA, streamB, o).filter(p => p.aggregate != null);
  const n = joined.length;

  if (n < 4) {
    const out: CorrelateResult = {
      effect: null,
      r: null,
      pValue: null,
      n,
      hasPattern: false,
      reason: 'need ≥ 4 overlapping observations',
    };
    if (o.includePairs) out.pairs = joined.map(p => ({ x: p.aggregate!, y: p.anchor, ts: p.anchorTs }));
    return out;
  }

  const xs = joined.map(p => p.aggregate!);
  const ys = joined.map(p => p.anchor);
  const pr = _pearsonOn(xs, ys);

  if (pr == null) {
    return { effect: null, r: null, pValue: null, n, hasPattern: false, reason: 'insufficient pairs' };
  }

  if (pr.r === 0 && pr.se == null) {
    const out: CorrelateResult = {
      effect: 0, r: 0, pValue: 1, n, se: null, hasPattern: false,
      reason: 'no variance in one stream',
    };
    if (o.includePairs) out.pairs = joined.map(p => ({ x: p.aggregate!, y: p.anchor, ts: p.anchorTs }));
    return out;
  }

  const effectMagnitude = Math.abs(pr.r);
  const hasPattern =
    n >= (o.minPairs ?? 4) &&
    effectMagnitude >= (o.minEffect ?? 0.3) &&
    pr.pValue <= (o.maxP ?? 0.05);

  const out: CorrelateResult = {
    effect: pr.r, r: pr.r, pValue: pr.pValue, n, se: pr.se,
    hasPattern, direction: pr.r > 0 ? 'positive' : 'negative', reason: null,
  };
  if (o.includePairs) {
    out.pairs = joined.map(p => ({ x: p.aggregate!, y: p.anchor, ts: p.anchorTs }));
  }
  return out;
}

/** Split-half stability check. */
export function stability(pairs: CorrelationPair[], opts?: { maxDelta?: number }): StabilityResult {
  const o = opts ?? {};
  const maxDelta = typeof o.maxDelta === 'number' ? o.maxDelta : 0.5;

  if (!Array.isArray(pairs) || pairs.length < 8) {
    return { stable: null, reason: 'not enough pairs for split (need ≥ 8)' };
  }

  const sorted = pairs.slice().sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const mid = Math.floor(sorted.length / 2);
  const older = sorted.slice(0, mid);
  const newer = sorted.slice(mid);
  const pOld = _pearsonOn(older.map(p => p.x), older.map(p => p.y));
  const pNew = _pearsonOn(newer.map(p => p.x), newer.map(p => p.y));

  if (!pOld || !pNew) return { stable: null, reason: 'one half missing valid r' };

  const signsAgree = pOld.r >= 0 === pNew.r >= 0;
  const delta = Math.abs(pNew.r - pOld.r);
  const stable = signsAgree && delta <= maxDelta;

  return {
    stable,
    r_old: pOld.r, r_new: pNew.r,
    n_old: pOld.n, n_new: pNew.n,
    delta,
    signs_agree: signsAgree,
    reason: stable
      ? null
      : !signsAgree
      ? 'halves disagree on sign'
      : `|Δr| = ${delta.toFixed(2)} > ${maxDelta}`,
  };
}

/** Minimum detectable Pearson r at sample size n (Fisher-z SE). */
export function minDetectableEffect(
  n: number,
  alpha?: number,
  power?: number,
): number | null {
  if (typeof n !== 'number' || n <= 4) return null;
  const a = typeof alpha === 'number' ? alpha : 0.05;
  const p = typeof power === 'number' ? power : 0.8;
  const zAlpha = _invNormalCdf(1 - a / 2);
  const zPower = _invNormalCdf(p);
  const se = 1 / Math.sqrt(n - 3);
  const zR = (zAlpha + zPower) * se;
  const e2z = Math.exp(2 * zR);
  return (e2z - 1) / (e2z + 1);
}

/** MMR diversity re-ranking. λ=1 is pure effect; λ=0 is pure diversity. */
export function mmrRank(candidates: MmrCandidate[], opts?: MmrOpts): MmrCandidate[] {
  const o = opts ?? {};
  const topK = typeof o.topK === 'number' ? o.topK : 3;
  const lambda = typeof o.lambda === 'number' ? o.lambda : 0.6;
  const sim: (a: MmrCandidate, b: MmrCandidate) => number =
    o.sim ??
    ((a, b) => {
      const sa = new Set(a.modules ?? []);
      const sb = new Set(b.modules ?? []);
      if (sa.size === 0 || sb.size === 0) return 0;
      let inter = 0;
      sa.forEach(m => { if (sb.has(m)) inter++; });
      return inter / Math.max(sa.size, sb.size);
    });

  const pool = (candidates ?? []).slice().sort((a, b) => (b.effect ?? 0) - (a.effect ?? 0));
  const picked: MmrCandidate[] = [];

  while (picked.length < topK && pool.length > 0) {
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i]!;
      let maxSim = 0;
      for (const p of picked) maxSim = Math.max(maxSim, sim(c, p));
      const score = lambda * (c.effect ?? 0) - (1 - lambda) * maxSim;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    picked.push(pool.splice(bestIdx, 1)[0]!);
  }
  return picked;
}

/** Benjamini-Hochberg FDR control. Returns subset with BH-adjusted q ≤ qTarget. */
export function bh(pValues: BhInput[], qTarget?: number): BhInput[] {
  const q = typeof qTarget === 'number' ? qTarget : 0.1;
  const sorted = (pValues ?? []).slice().sort((a, b) => a.p - b.p);
  const m = sorted.length;
  if (m === 0) return [];
  let kMax = -1;
  for (let i = 0; i < m; i++) {
    if (sorted[i]!.p <= ((i + 1) / m) * q) kMax = i;
  }
  return kMax >= 0 ? sorted.slice(0, kMax + 1) : [];
}
