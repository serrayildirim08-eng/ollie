/**
 * @ollie/logic · body · caffeine-sleep correlator
 *
 * Pure functional layer for the Drake-2013 caffeine→sleep coupling.
 * (Drake CL et al. 2013, J Clin Sleep Med — "Caffeine effects on sleep
 * taken 0, 3, or 6 hours before going to bed.")
 *
 * Two public surfaces:
 *   1. inferCaffeineFromTransactions — pull caffeine intake events from
 *      finance txns (merchant allowlist) + braindump keywords.
 *   2. correlateCaffeineAndSleep — Pearson ρ between time-of-day-decayed
 *      caffeine exposure and per-night sleep-quality delta; threshold
 *      detection ("after Xpm coffee tracks with -Y% quality").
 *
 * No I/O. No DOM. No wall-clock reads. Caller supplies `now` via opts
 * if needed (currently unused — pairing is fully deterministic on input).
 *
 * Math layer reused: pearson() from ./math.ts.
 */

import { pearson } from './math';
import type { FinanceRecord } from '../finance/types';
import type { BrainDumpEntry } from '../finance/subscription-dormancy';
import type { SleepRecord } from '../sleep/types';

// ─── Types ───────────────────────────────────────────────────────────

export type CaffeineSource = 'grocery' | 'finance' | 'brain_dump';

export interface CaffeineEntry {
  /** Epoch ms of consumption. */
  consumedAt: number;
  /** Caffeine dose in milligrams. */
  amountMg: number;
  /** Where the entry came from. */
  source: CaffeineSource;
}

export interface CaffeineSleepThreshold {
  /** Hour-of-day (0–23) where correlation flips negative + |ρ| > 0.3. */
  hours: number;
  /** Minutes-of-hour, currently always 0 (we bucket to the hour). */
  minutes: number;
}

export interface CaffeineSleepResult {
  /** Pearson ρ between time-of-day (decimal hours) and quality delta. */
  correlation: number;
  /** Threshold time at/after which caffeine→quality dip; null if absent. */
  threshold: CaffeineSleepThreshold | null;
  /** Paired (caffeine-day, sleep-night) sample count. */
  sampleSize: number;
  /** Deadpan human copy; empty string when no narrative threshold found. */
  copy: string;
}

export interface CorrelateCaffeineSleepOpts {
  /** Drake 2013 half-life (hours). Default 6. */
  halfLifeHours?: number;
  /** Minimum sample size for a result. Default 14 (≈2 weeks). */
  minSampleSize?: number;
  /** Minimum |ρ| magnitude for a "threshold" copy. Default 0.3. */
  thresholdRho?: number;
}

// ─── Caffeine source data ────────────────────────────────────────────

/**
 * Standard caffeine doses (mg). Defaults applied when amount/source
 * is unspecified. Numbers from USDA + manufacturer disclosures (Drake
 * 2013 used ~400mg controlled doses; real-world means cluster here).
 */
export const CAFFEINE_STANDARD_MG: Record<string, number> = {
  drip_coffee: 95,
  espresso: 63,
  matcha: 70,
  cold_brew: 200,
  black_tea: 47,
  green_tea: 28,
  latte: 75,
  cappuccino: 75,
  americano: 95,
};

/**
 * Merchant allowlist. Tested against `merchant_normalized.toLowerCase()`
 * via substring match (not regex) so abbreviated/joined names like
 * "starbucksstore" still trigger. Includes the obvious chains + a few
 * specialty roasters that show up in dogfood data.
 */
export const CAFFEINE_MERCHANTS: ReadonlyArray<{ key: string; mg: number }> = [
  { key: 'starbucks', mg: 95 },
  { key: 'blue bottle', mg: 95 },
  { key: 'bluebottle', mg: 95 },
  { key: "peet's", mg: 95 },
  { key: 'peets', mg: 95 },
  { key: 'dunkin', mg: 95 },
  { key: 'dutch bros', mg: 95 },
  { key: 'dutchbros', mg: 95 },
  { key: 'philz', mg: 95 },
  { key: 'la colombe', mg: 95 },
  { key: 'lacolombe', mg: 95 },
  { key: 'intelligentsia', mg: 95 },
  { key: 'stumptown', mg: 95 },
  { key: 'matcha', mg: 70 },
  { key: 'cafe nero', mg: 95 },
  { key: 'caffe nero', mg: 95 },
  { key: 'costa coffee', mg: 95 },
  { key: 'tim hortons', mg: 95 },
];

/**
 * Braindump keyword table. Each entry: (regex, default-mg, priority).
 * Higher priority wins when multiple keywords match a single dump
 * (e.g. "matcha latte" → matcha, not latte). When priorities tie,
 * the higher mg dose wins (cold brew over brew).
 */
const BRAINDUMP_KEYWORDS: ReadonlyArray<{ re: RegExp; mg: number; pri: number }> = [
  // priority 3 — drink-defining nouns
  { re: /\bcold\s*brew\b/i,  mg: CAFFEINE_STANDARD_MG.cold_brew,  pri: 3 },
  { re: /\bmatcha\b/i,       mg: CAFFEINE_STANDARD_MG.matcha,     pri: 3 },
  { re: /\bespresso\b/i,     mg: CAFFEINE_STANDARD_MG.espresso,   pri: 3 },
  { re: /\bamericano\b/i,    mg: CAFFEINE_STANDARD_MG.americano,  pri: 3 },
  { re: /\bcappuccino\b/i,   mg: CAFFEINE_STANDARD_MG.cappuccino, pri: 3 },
  // priority 2 — milk-drink suffix (lower than matcha/espresso)
  { re: /\blatte\b/i,        mg: CAFFEINE_STANDARD_MG.latte,      pri: 2 },
  // priority 1 — generic
  { re: /\bcoffee\b/i,       mg: CAFFEINE_STANDARD_MG.drip_coffee, pri: 1 },
];

// ─── Inference ────────────────────────────────────────────────────────

/**
 * Convert YYYY-MM-DD to a 12:00-local-time epoch ms. Used when a finance
 * txn doesn't carry an intraday timestamp — we approximate consumption
 * as "noon of that day" so it pairs with that night's sleep record.
 */
function eventDateToNoonEpoch(eventDate: string): number | null {
  if (typeof eventDate !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const t = new Date(y, mo, d, 12, 0, 0, 0).getTime();
  return isFinite(t) ? t : null;
}

/**
 * Inspect a merchant_normalized string and return mg if it matches the
 * caffeine allowlist; null otherwise.
 */
function caffeineMgForMerchant(merchantNormalized: string | null | undefined): number | null {
  if (typeof merchantNormalized !== 'string') return null;
  const norm = merchantNormalized.toLowerCase();
  if (!norm) return null;
  for (const m of CAFFEINE_MERCHANTS) {
    if (norm.includes(m.key)) return m.mg;
  }
  return null;
}

/**
 * Extract caffeine mg from a braindump text. One entry per dump.
 * Highest-priority keyword wins; ties broken by larger mg.
 */
function caffeineMgForDumpText(text: string): number | null {
  if (typeof text !== 'string' || !text) return null;
  let bestMg: number | null = null;
  let bestPri = -1;
  for (const kw of BRAINDUMP_KEYWORDS) {
    if (!kw.re.test(text)) continue;
    if (kw.pri > bestPri || (kw.pri === bestPri && (bestMg == null || kw.mg > bestMg))) {
      bestPri = kw.pri;
      bestMg = kw.mg;
    }
  }
  return bestMg;
}

/**
 * Pure inference: scan finance txns + braindump entries and return
 * a flat list of CaffeineEntry rows. No dedupe across sources by design
 * (a Starbucks transaction + a "had coffee" dump on the same day count
 * as two exposures — Drake's model is dose-additive).
 */
export function inferCaffeineFromTransactions(
  txns: FinanceRecord[],
  brainDumps: BrainDumpEntry[],
): CaffeineEntry[] {
  const out: CaffeineEntry[] = [];

  if (Array.isArray(txns)) {
    for (const t of txns) {
      if (!t || typeof t !== 'object') continue;
      if (t.direction === 'in') continue; // outflow only
      const mg = caffeineMgForMerchant(t.merchant_normalized);
      if (mg == null) continue;
      const ts = eventDateToNoonEpoch(t.event_date);
      if (ts == null) continue;
      out.push({ consumedAt: ts, amountMg: mg, source: 'finance' });
    }
  }

  if (Array.isArray(brainDumps)) {
    for (const d of brainDumps) {
      if (!d || typeof d !== 'object') continue;
      if (typeof d.ts !== 'number' || !isFinite(d.ts)) continue;
      if (typeof d.text !== 'string') continue;
      const mg = caffeineMgForDumpText(d.text);
      if (mg == null) continue;
      out.push({ consumedAt: d.ts, amountMg: mg, source: 'brain_dump' });
    }
  }

  out.sort((a, b) => a.consumedAt - b.consumedAt);
  return out;
}

// ─── Pairing + correlation ───────────────────────────────────────────

/** YYYY-MM-DD key in LOCAL tz from epoch ms. */
function localDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Next-day key (local). */
function nextDayKeyLocal(key: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const next = new Date(y, mo, d + 1, 0, 0, 0, 0);
  return localDateKey(next.getTime());
}

interface CaffeinePair {
  /** Hour of caffeine consumption (0–23, decimal). */
  hourOfDay: number;
  /** Sleep quality delta from user's mean. */
  qualityDelta: number;
  /** Night this caffeine pairs to (YYYY-MM-DD). */
  nightOf: string;
}

/**
 * Group caffeine entries by the night they affect.
 * Rule: caffeine consumed BEFORE 18:00 → pairs with that calendar
 * night. Consumed AT/AFTER 18:00 → still pairs with that night (the
 * one closest in time). If multiple intakes hit the same night, keep
 * the LATEST — that's the one with the smallest gap, the dominant
 * predictor under a half-life decay model.
 */
function pairToNights(
  caffeine: CaffeineEntry[],
  sleep: SleepRecord[],
): CaffeinePair[] {
  // Quality stats first — need user mean to compute deltas.
  const qualities = sleep
    .filter((r) => r && !r.is_skipped && typeof r.quality === 'number')
    .map((r) => r.quality as number);
  if (qualities.length === 0) return [];
  const mean = qualities.reduce((s, x) => s + x, 0) / qualities.length;

  // Index sleep records by night_of.
  const byNight = new Map<string, SleepRecord>();
  for (const r of sleep) {
    if (!r || r.is_skipped) continue;
    if (typeof r.night_of !== 'string') continue;
    if (typeof r.quality !== 'number') continue;
    byNight.set(r.night_of, r);
  }

  // For each caffeine entry, compute its "target night" and stash the
  // latest one per night.
  const latestPerNight = new Map<string, { entry: CaffeineEntry }>();
  for (const c of caffeine) {
    if (!c || typeof c.consumedAt !== 'number') continue;
    const date = new Date(c.consumedAt);
    const hod = date.getHours() + date.getMinutes() / 60;
    const dayKey = localDateKey(c.consumedAt);
    // Consumed in the small hours (before 4am) → it actually affects
    // the previous night, not this one. Use yesterday's key.
    let nightOf = dayKey;
    if (hod < 4) {
      const prev = nextDayKeyLocal(localDateKey(c.consumedAt - 86400000));
      if (prev != null) nightOf = localDateKey(c.consumedAt - 86400000);
    }
    const cur = latestPerNight.get(nightOf);
    if (cur == null || c.consumedAt > cur.entry.consumedAt) {
      latestPerNight.set(nightOf, { entry: c });
    }
  }

  const pairs: CaffeinePair[] = [];
  for (const [nightOf, { entry }] of latestPerNight.entries()) {
    const rec = byNight.get(nightOf);
    if (rec == null) continue;
    const date = new Date(entry.consumedAt);
    const hod = date.getHours() + date.getMinutes() / 60;
    const delta = (rec.quality as number) - mean;
    pairs.push({ hourOfDay: hod, qualityDelta: delta, nightOf });
  }
  return pairs;
}

/**
 * Threshold detection: scan candidate hours H in {12..22} and pick the
 * H that MAXIMIZES the gap between "early cohort" mean (hour<H) and
 * "late cohort" mean (hour>=H). Gate on:
 *   - global Pearson ρ negative and |ρ| >= thresholdRho
 *   - late cohort sample >= 5
 *   - early cohort sample >= 3
 *   - meanLate < meanEarly (a real dip, not a spurious peak)
 *   - dip translates to >=5% sleep-quality delta
 *
 * The argmax behavior locates the natural cliff: when caffeine after
 * 3pm is the inflection point, h=15 (or 16) wins because that's where
 * the late cohort mean is lowest while the early cohort is still
 * solid.
 */
function findThreshold(
  pairs: CaffeinePair[],
  thresholdRho: number,
): { hours: number; rho: number; pct: number } | null {
  // Global slope first — if non-negative or too weak, bail.
  const xs = pairs.map((p) => p.hourOfDay);
  const ys = pairs.map((p) => p.qualityDelta);
  const rho = pearson(xs, ys);
  if (rho >= 0) return null;
  if (Math.abs(rho) < thresholdRho) return null;

  let bestH = -1;
  let bestGap = 0;
  let bestPct = 0;
  for (let h = 12; h <= 22; h++) {
    const late = pairs.filter((p) => p.hourOfDay >= h);
    if (late.length < 5) continue;
    const earlier = pairs.filter((p) => p.hourOfDay < h);
    if (earlier.length < 3) continue;

    const meanLate = late.reduce((s, p) => s + p.qualityDelta, 0) / late.length;
    const meanEarly = earlier.reduce((s, p) => s + p.qualityDelta, 0) / earlier.length;
    if (!(meanLate < meanEarly)) continue;

    const dip = meanEarly - meanLate;
    // Strictly-greater would lock in the earliest candidate when the
    // late cohort is identical across many h-values (e.g. synthetic
    // bimodal data where all caffeine is at 9am or 16:00). Use
    // >= so the cliff itself wins the tiebreak, not the hour before.
    if (dip < bestGap) continue;

    // Quality dip as percent. Quality is 1–5, so a 1-point delta is 20%.
    const pct = Math.min(100, Math.round(dip * 20));
    if (pct < 5) continue;

    bestH = h;
    bestGap = dip;
    bestPct = pct;
  }

  if (bestH < 0) return null;
  return { hours: bestH, rho, pct: bestPct };
}

/**
 * Format hour-of-day as "Xam" / "Xpm" (no minutes — buckets are hourly).
 * Examples: 15 → "3pm", 12 → "12pm", 0 → "12am".
 */
function fmtHour12(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  if (hh === 0) return '12am';
  if (hh === 12) return '12pm';
  return hh < 12 ? `${hh}am` : `${hh - 12}pm`;
}

/** Whole-week count from a paired sample. Floors to 1. */
function weeksFromSampleSize(n: number): number {
  return Math.max(1, Math.round(n / 7));
}

/**
 * Main correlator. Reuses pearson() from body/math.ts (no new math).
 *
 * Returns a result whose `copy` is the empty string when the threshold
 * isn't reached; the UI uses `sampleSize` + a non-empty copy to gate
 * rendering. (Caller may also gate on `sampleSize >= minSampleSize`.)
 */
export function correlateCaffeineAndSleep(
  caffeine: CaffeineEntry[],
  sleep: SleepRecord[],
  opts?: CorrelateCaffeineSleepOpts,
): CaffeineSleepResult {
  const _halfLife = opts?.halfLifeHours ?? 6;
  void _halfLife; // reserved for future dose-decay model; kept in API for stability
  const minN = opts?.minSampleSize ?? 14;
  const thresholdRho = opts?.thresholdRho ?? 0.3;

  if (!Array.isArray(caffeine) || !Array.isArray(sleep)) {
    return { correlation: 0, threshold: null, sampleSize: 0, copy: '' };
  }

  const pairs = pairToNights(caffeine, sleep);
  const n = pairs.length;
  if (n < minN) {
    return { correlation: 0, threshold: null, sampleSize: n, copy: '' };
  }

  const xs = pairs.map((p) => p.hourOfDay);
  const ys = pairs.map((p) => p.qualityDelta);
  const correlation = pearson(xs, ys);

  const t = findThreshold(pairs, thresholdRho);
  if (t == null) {
    return { correlation, threshold: null, sampleSize: n, copy: '' };
  }

  const threshold: CaffeineSleepThreshold = { hours: t.hours, minutes: 0 };
  const weeks = weeksFromSampleSize(n);
  const weekLabel = weeks === 1 ? '1 week of data' : `${weeks} weeks of data`;
  const copy = `caffeine after ${fmtHour12(t.hours)} correlates with -${t.pct}% sleep quality for you · ${weekLabel}`;

  return { correlation, threshold, sampleSize: n, copy };
}
