/**
 * @ollie/logic · body · water → focus correlator
 *
 * Pearson ρ between daily water cups and a brain-dump-derived clarity
 * proxy. NO new schema. NO UI gesture.
 *
 * ─── Design decision: Option B (clarity-ratio proxy) ──────────────────────
 *
 * P6 deferred this correlator because `work.focus_log` carries
 * `{ ts, duration_ms }` — duration is not a self-rated focus rating, and
 * mapping duration → rating via a hand-rolled heuristic would be fake
 * math dressed as a signal.
 *
 * Three options were on the table:
 *   A. Add `rating: 1..5` to focus_log entries (new UI gesture)
 *   B. Derive a clarity proxy from existing braindump text
 *   C. Both (weighted fallback)
 *
 * Picked B because:
 *   1. Zero-UI signal — works from day 1, no fill-rate problem.
 *   2. Reuses OVERWHELMED_LEXICON (already proven in workout-skip-mood
 *      with the same shape: `hits / sentenceCount`).
 *   3. Dumps fire daily for active users; focus ratings would fire
 *      once per focus session and decay fast (Finch-trap territory).
 *   4. The signal is a proxy, not a claim — copy says "days read
 *      clearer in dumps", not "your focus is higher". Honest framing.
 *
 * NOT picked A because focus_log is sparse (Serra uses pomodoros
 * occasionally, not every day); pairing days that lack a focus
 * session with daily water counts would yield n ≪ 14 for months.
 *
 * NOT picked C because there's no math justification for blending
 * a 1–5 ordinal with a 0..1 ratio without a calibration set, and we
 * don't have one. Ship a clean proxy; revisit if real ratings land.
 *
 * ─── Algorithm ────────────────────────────────────────────────────────────
 *
 * For each calendar day D in the lookback window:
 *   1. cups[D] = count of water_log entries on D, summing `glasses`
 *      field for objects, 1 per bare-number entry.
 *   2. dumpText[D] = concatenated rawText/text of all dump entries on D.
 *   3. clarity[D] = 1 - (overwhelmed_hits / sentenceCount), clamped to
 *      [0, 1]. Higher = clearer.
 *
 * Drop days where either cups == 0 or dumpText is empty.
 * Pair (cups, clarity) across remaining days, run pearson() from math.ts.
 *
 * Min sample: 14 days. Threshold: |ρ| > 0.30.
 *
 * No I/O. No DOM.
 */

import { pearson, dayKey } from '../math';
import { OVERWHELMED_LEXICON } from '../../sleep/constants';
import type { WaterEntry, DumpEntry } from '../types';

const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MIN_SAMPLE = 14;
const DEFAULT_THRESHOLD = 0.30;

// ─── Public types ────────────────────────────────────────────────────────

export interface WaterFocusResult {
  /** Pearson ρ on (cups, clarity_ratio). null when not computed. */
  correlation: number | null;
  /** Paired-day count. */
  sampleSize: number;
  /** Deadpan copy; empty string when threshold not met. */
  copy: string;
  /** Result timestamp. */
  ts: number;
  /** Always true — Option B is the shipped implementation. */
  implemented: true;
}

export interface CorrelateWaterFocusOpts {
  lookbackDays?: number;
  minSampleSize?: number;
  thresholdRho?: number;
  now?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function waterTsOf(entry: WaterEntry): number | null {
  if (typeof entry === 'number') return entry;
  if (entry && typeof entry.ts === 'number') return entry.ts;
  return null;
}

function waterCupsOf(entry: WaterEntry): number {
  if (typeof entry === 'number') return 1;
  const g = (entry as { ts: number; glasses?: number }).glasses;
  return (typeof g === 'number' && g > 0) ? g : 1;
}

function sentenceCount(text: string): number {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);
  return Math.max(1, parts.length);
}

function buildLexiconMatcher(): (text: string) => number {
  const phrases = OVERWHELMED_LEXICON.map((p) => p.toLowerCase());
  return (text: string): number => {
    if (!text) return 0;
    const lower = text.toLowerCase();
    let hits = 0;
    for (const p of phrases) {
      if (lower.includes(p)) hits++;
    }
    return hits;
  };
}

function clamp01(x: number): number {
  if (!isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ─── Main correlator ─────────────────────────────────────────────────────

export function correlateWaterAndFocus(
  waterLog: readonly WaterEntry[] | undefined | null,
  dumps: readonly DumpEntry[] | undefined | null,
  opts?: CorrelateWaterFocusOpts,
): WaterFocusResult {
  const now = opts?.now ?? Date.now();
  const lookback = opts?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const minN = opts?.minSampleSize ?? DEFAULT_MIN_SAMPLE;
  const thresholdRho = opts?.thresholdRho ?? DEFAULT_THRESHOLD;

  if (!Array.isArray(waterLog) || waterLog.length === 0) {
    return { correlation: null, sampleSize: 0, copy: '', ts: now, implemented: true };
  }
  if (!Array.isArray(dumps) || dumps.length === 0) {
    return { correlation: null, sampleSize: 0, copy: '', ts: now, implemented: true };
  }

  const windowStart = now - lookback * DAY_MS;

  // ── cups per day ──
  const cupsByDay = new Map<string, number>();
  for (const w of waterLog) {
    const ts = waterTsOf(w);
    if (ts == null || ts < windowStart || ts > now) continue;
    const k = dayKey(ts);
    cupsByDay.set(k, (cupsByDay.get(k) ?? 0) + waterCupsOf(w));
  }

  // ── dumps per day ──
  const dumpsByDay = new Map<string, string[]>();
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    if (d.ts < windowStart || d.ts > now) continue;
    const text = String(d.rawText ?? d.text ?? '');
    if (!text) continue;
    const k = dayKey(d.ts);
    const arr = dumpsByDay.get(k);
    if (arr) arr.push(text);
    else dumpsByDay.set(k, [text]);
  }

  // ── pair (cups, clarity) ──
  const matchPhrases = buildLexiconMatcher();
  const xs: number[] = [];
  const ys: number[] = [];

  for (const [day, cups] of cupsByDay.entries()) {
    if (cups <= 0) continue;
    const texts = dumpsByDay.get(day);
    if (!texts || texts.length === 0) continue;
    const joined = texts.join('\n');
    const sents = sentenceCount(joined);
    if (sents === 0) continue;
    const hits = matchPhrases(joined);
    const overwhelmedRatio = clamp01(hits / sents);
    const clarity = 1 - overwhelmedRatio;
    xs.push(cups);
    ys.push(clarity);
  }

  const n = xs.length;
  if (n < minN) {
    return { correlation: null, sampleSize: n, copy: '', ts: now, implemented: true };
  }

  const rho = pearson(xs, ys);
  if (Math.abs(rho) < thresholdRho) {
    return { correlation: rho, sampleSize: n, copy: '', ts: now, implemented: true };
  }

  let copy: string;
  if (rho > 0) {
    copy = `hydration days read clearer in dumps · ${n} days of data`;
  } else {
    copy = `hydration days read heavier in dumps for you · ${n} days of data`;
  }

  return { correlation: rho, sampleSize: n, copy, ts: now, implemented: true };
}
