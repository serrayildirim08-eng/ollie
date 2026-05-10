/**
 * @ollie/logic/patterns · sleep_mood_lag detector
 *
 * Daily series: TST (hours) vs. mood-tag flag per day. Tag v1 = FATIGUE.
 * For each lag L ∈ {-3..+3}, Spearman ρ between sleep[d] and mood[d+L].
 * Peak-|ρ| lag surfaces when:
 *   - N ≥ minSampleDays overlapping pairs (default 21)
 *   - |ρ| ≥ minAbsRho (default 0.3)
 *   - bootstrap 90% CI excludes zero (1000 iters, seeded RNG)
 *
 * No BH FDR — we only surface the single peak-lag, equivalent to taking
 * the max over the 7-lag family; the CI gate does the honest work.
 */

import { mulberry32, spearman, bootstrapCI } from './stats';
import type { Confidence, DumpEntry, DetectorOptions, SleepMoodLagPattern, SleepSession } from './types';

const FATIGUE_RE = /\b(tired|exhausted|wiped|drained|wrecked|burnt out|knackered|yorgun|bitkin|halsiz)\b/i;

function dayKeyFromTs(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

  let best: { L: number; rho: number; xs: number[]; ys: number[]; n: number } | null = null;
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
    if (!best || Math.abs(rho) > Math.abs(best.rho)) {
      best = { L, rho, xs, ys, n: xs.length };
    }
  }
  if (!best) return null;
  if (Math.abs(best.rho) < minAbsRho) return null;
  if (best.n < minSampleDays) return null;

  const rng = mulberry32(seed);
  const ci = bootstrapCI(best.xs, best.ys, (xs, ys) => spearman(xs, ys), 1000, 0.1, rng);
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
