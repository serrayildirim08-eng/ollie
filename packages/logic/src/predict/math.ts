/**
 * @ollie/logic · predict math utilities
 *
 * Pure numerical helpers. No I/O, no clock reads.
 */

import type { Observation, Series, TimestampedObservation } from './types';
import { DAY_MS } from './constants';

export function sum(a: number[]): number {
  return a.reduce((s, x) => s + x, 0);
}

export function mean(a: number[]): number {
  return sum(a) / a.length;
}

export function variance(a: number[]): number {
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length;
}

export function sampleSd(a: number[]): number {
  return Math.sqrt(variance(a));
}

export function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export function toSeries(input: Observation[]): Series {
  const arr = (input ?? []).filter((x): x is Observation => x != null);
  if (arr.length === 0) return { values: [], ts: [], hasTs: false };

  const firstIsTs =
    typeof arr[0] === 'object' && typeof (arr[0] as TimestampedObservation).ts === 'number';

  if (!firstIsTs) {
    return {
      values: (arr as number[]).filter(x => typeof x === 'number' && isFinite(x)),
      ts: [],
      hasTs: false,
    };
  }

  const sorted = (arr as TimestampedObservation[])
    .filter(x => typeof x.ts === 'number' && typeof x.value === 'number' && isFinite(x.value))
    .slice()
    .sort((a, b) => a.ts - b.ts);

  return {
    values: sorted.map(x => x.value),
    ts: sorted.map(x => x.ts),
    hasTs: true,
  };
}

/** Calendar-aware EWMA decay weights. Weight at halfLifeDays = 0.5. */
export function recencyWeights(ts: number[], now: number, halfLifeDays: number): number[] {
  if (!ts || ts.length === 0) return [];
  const dailyDecay = Math.pow(0.5, 1 / halfLifeDays);
  return ts.map(t => Math.pow(dailyDecay, Math.max(0, (now - t) / DAY_MS)));
}

export function daysBetween(tsA: number, tsB: number): number | null {
  if (typeof tsA !== 'number' || typeof tsB !== 'number') return null;
  return (tsB - tsA) / DAY_MS;
}

/** Days since ts, relative to explicit `now`. */
export function daysSince(ts: number, now: number): number | null {
  return daysBetween(ts, now);
}

// ─── Normal distribution helpers ──────────────────────────────────────────

/** Normal CDF approximation (Abramowitz-Stegun 7.1.26). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Inverse standard normal CDF (Beasley-Springer-Moro). */
export function _invNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
  const A = [
    -39.6968302866538, 220.946098424521, -275.928510446969,
    138.357751867269, -30.6647980661472, 2.50662827745924,
  ];
  const B = [
    -54.4760987982241, 161.585836858041, -155.698979859887,
    66.8013118877197, -13.2806815528857,
  ];
  const C = [
    -0.00778489400243029, -0.322396458041136, -2.40075827716184,
    -2.54973253934373, 4.37466414146497, 2.93816398269878,
  ];
  const D = [
    0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) /
      ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1)
    );
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      (((((A[0]! * r + A[1]!) * r + A[2]!) * r + A[3]!) * r + A[4]!) * r + A[5]!) *
      q /
      (((((B[0]! * r + B[1]!) * r + B[2]!) * r + B[3]!) * r + B[4]!) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) /
    ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1)
  );
}
