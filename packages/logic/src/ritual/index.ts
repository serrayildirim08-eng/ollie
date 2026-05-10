/**
 * @ollie/logic/ritual
 *
 * Routine peak detection: given a chronological log of "I did X" events,
 * infer 2–3 hours-of-day when those actions tend to cluster. Used for
 * habit reminders and the "what's on your mind" prompt timing.
 *
 * Method: circular Gaussian KDE over [0, 24) → peak detection with a
 * minimum-prominence floor. Falls back to chronotype-based defaults when
 * fewer than 14 events are available.
 *
 * Pure. `now` is an explicit param for currentPeakMatch.
 */

export interface ActionLogEntry {
  ts: number;
}

export interface Peak {
  hour: number;
  strength: number;
}

export interface RitualResult {
  peaks: Peak[];
  source: 'learned' | 'fallback';
  n: number;
}

export interface Chronotype {
  category?: string;
}

export interface KDEOptions {
  bandwidth?: number;
  minProminence?: number;
}

const DEFAULT_BANDWIDTH = 1.5;
const DEFAULT_MIN_PROMINENCE = 0.15;
const MIN_SAMPLES_FOR_LEARNING = 14;
const MAX_PEAKS = 3;

export function extractHoursFromLog(actionLog: readonly ActionLogEntry[] | undefined | null): number[] {
  if (!Array.isArray(actionLog)) return [];
  return actionLog
    .map((e) => {
      const ts = e && typeof e.ts === 'number' ? e.ts : null;
      if (ts == null) return null;
      const d = new Date(ts);
      return d.getHours() + d.getMinutes() / 60;
    })
    .filter((h): h is number => typeof h === 'number' && h >= 0 && h < 24);
}

export function circularKDE(hours: readonly number[], opts?: KDEOptions): number[] {
  const bandwidth = opts?.bandwidth ?? DEFAULT_BANDWIDTH;
  const density = new Array(24).fill(0) as number[];
  if (!hours || hours.length === 0) return density;
  const norm = 1 / (Math.sqrt(2 * Math.PI) * bandwidth);
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (const t of hours) {
      const raw = Math.abs(h - t);
      const circ = Math.min(raw, 24 - raw);
      const u = circ / bandwidth;
      sum += norm * Math.exp(-0.5 * u * u);
    }
    density[h] = sum / hours.length;
  }
  return density;
}

export function findPeaks(density: readonly number[], opts?: KDEOptions): Peak[] {
  if (!Array.isArray(density) || density.length !== 24) return [];
  const minProminence = opts?.minProminence ?? DEFAULT_MIN_PROMINENCE;
  const max = density.reduce((m, v) => (v > m ? v : m), 0);
  if (max <= 0) return [];
  const floor = max * minProminence;
  const peaks: Peak[] = [];
  for (let h = 0; h < 24; h++) {
    const prev = density[(h + 23) % 24];
    const next = density[(h + 1) % 24];
    if (density[h] > prev && density[h] > next && density[h] >= floor) {
      peaks.push({ hour: h, strength: density[h] });
    }
  }
  peaks.sort((a, b) => b.strength - a.strength);
  return peaks.slice(0, MAX_PEAKS);
}

export function fallbackForChronotype(chronotype: Chronotype | undefined | null): Peak[] {
  const cat = chronotype?.category ?? '';
  if (cat.includes('early')) return [{ hour: 7, strength: 0 }, { hour: 20, strength: 0 }];
  if (cat.includes('late'))  return [{ hour: 10, strength: 0 }, { hour: 23, strength: 0 }];
  return [{ hour: 8, strength: 0 }, { hour: 21, strength: 0 }];
}

export function inferRitualPeaks(
  actionLog: readonly ActionLogEntry[] | undefined | null,
  chronotype: Chronotype | undefined | null,
  opts?: KDEOptions,
): RitualResult {
  const hours = extractHoursFromLog(actionLog);
  if (hours.length < MIN_SAMPLES_FOR_LEARNING) {
    return { peaks: fallbackForChronotype(chronotype), source: 'fallback', n: hours.length };
  }
  const density = circularKDE(hours, opts);
  const peaks = findPeaks(density, opts);
  if (peaks.length === 0) {
    return { peaks: fallbackForChronotype(chronotype), source: 'fallback', n: hours.length };
  }
  return { peaks, source: 'learned', n: hours.length };
}

/**
 * Is the given timestamp within `windowHours` (default 1) of any peak's hour?
 * Returns the matching peak or null.
 */
export function currentPeakMatch(
  peaks: readonly Peak[] | undefined | null,
  now: number,
  windowHours = 1,
): Peak | null {
  const t = typeof now === 'number' ? now : 0;
  const nowH = new Date(t).getHours() + new Date(t).getMinutes() / 60;
  if (!Array.isArray(peaks)) return null;
  for (const p of peaks) {
    if (!p || typeof p.hour !== 'number') continue;
    const raw = Math.abs(nowH - p.hour);
    const circ = Math.min(raw, 24 - raw);
    if (circ <= windowHours) return p;
  }
  return null;
}
