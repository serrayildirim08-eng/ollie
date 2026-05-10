/**
 * @ollie/logic · work legacy detectors (W0a, W0b)
 *
 * Pre-dates consent gate convention. Behavior preserved verbatim.
 * Pure: no I/O, no window.* globals, now always explicit.
 */

import type {
  WorkSession,
  DeepFocusHoursPattern,
  PacingBreachPattern,
  WorkPatternOpts,
} from './types';
import { DAY, HOUR } from './constants';
import { dayKey, fmtBlockLabel } from './helpers';

interface SessionHistory {
  sessions?: WorkSession[];
  now?: number;
}

// ── W0a — deep-focus hours ────────────────────────────────────────────

export function detectDeepFocusHours(
  history: SessionHistory | null | undefined,
  opts?: WorkPatternOpts,
): DeepFocusHoursPattern | null {
  const o = opts ?? {};
  const now = history && typeof history.now === 'number' ? history.now : (o.now ?? 0);
  const windowDays = o.windowDays ?? 90;
  const minSessions = o.minSessions ?? 20;
  const minRunLength = o.minRunLength ?? 3;
  const minLift = typeof o.minLift === 'number' ? o.minLift : 1.2;
  const windowStart = now - windowDays * DAY;

  const sessions: WorkSession[] = Array.isArray(history?.sessions) ? history!.sessions! : [];
  const inWindow = sessions.filter(
    (s) =>
      s &&
      typeof s.at === 'number' &&
      s.at >= windowStart &&
      s.at <= now &&
      typeof s.duration_min === 'number' &&
      s.duration_min > 0,
  );
  if (inWindow.length < minSessions) return null;

  const blocks = new Array(12).fill(null).map(() => ({ count: 0, total: 0 }));
  let overallTotal = 0;
  for (const s of inWindow) {
    const h = new Date(s.at!).getHours();
    const idx = Math.floor(h / 2);
    blocks[idx].count++;
    blocks[idx].total += s.duration_min!;
    overallTotal += s.duration_min!;
  }
  const overallMean = overallTotal / inWindow.length;

  let peakIdx = -1;
  let peakMean = 0;
  for (let i = 0; i < 12; i++) {
    if (blocks[i].count < minRunLength) continue;
    const m = blocks[i].total / blocks[i].count;
    if (m > peakMean) { peakMean = m; peakIdx = i; }
  }
  if (peakIdx === -1) return null;
  if (peakMean < minLift * overallMean) return null;

  const peakN = blocks[peakIdx].count;
  const lift = peakMean / overallMean;
  const confidence = lift >= 1.5 ? 'high' : lift >= 1.3 ? 'medium' : 'low';
  const dates = inWindow.map((s) => dayKey(s.at!)).sort();

  return {
    pattern: 'deep-focus-hours',
    confidence,
    sample_n: inWindow.length,
    date_range: { start: dates[0], end: dates[dates.length - 1] },
    peak_block: { start_hour: peakIdx * 2, end_hour: peakIdx * 2 + 2 },
    peak_mean_minutes: Math.round(peakMean),
    peak_n: peakN,
    overall_mean_minutes: Math.round(overallMean),
    copy:
      `your longest focus sessions cluster around ${fmtBlockLabel(peakIdx)} — ` +
      `${peakN} sessions averaging ${Math.round(peakMean)} min there, vs ${Math.round(overallMean)} min overall. ` +
      `pattern, not cause.`,
    copy_envelope:
      `your longest focus sessions cluster around ${fmtBlockLabel(peakIdx)}, ` +
      `${peakN} sessions averaging ${Math.round(peakMean)} min — past your safe pacing zone. ` +
      `body files the bill 24-72h later.`,
  };
}

// ── W0b — pacing breach ───────────────────────────────────────────────

export function detectPacingBreach(
  history: SessionHistory | null | undefined,
  opts?: WorkPatternOpts,
): PacingBreachPattern | null {
  const o = opts ?? {};
  const now = history && typeof history.now === 'number' ? history.now : (o.now ?? 0);
  const windowDays = o.windowDays ?? 14;
  const minBreachHours = typeof o.minBreachHours === 'number' ? o.minBreachHours : 8;
  const windowStart = now - windowDays * DAY;

  const sessions: WorkSession[] = Array.isArray(history?.sessions) ? history!.sessions! : [];
  const norm: { start: number; end: number; duration_min: number }[] = [];

  for (const s of sessions) {
    if (!s) continue;
    let start: number, end: number, dur: number;
    if (typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start) {
      start = s.start; end = s.end; dur = (end - start) / 60_000;
    } else if (typeof s.at === 'number' && typeof s.duration_min === 'number' && s.duration_min > 0) {
      start = s.at; end = s.at + s.duration_min * 60_000; dur = s.duration_min;
    } else {
      continue;
    }
    if (end < windowStart || start > now) continue;
    norm.push({ start, end, duration_min: dur });
  }
  if (norm.length === 0) return null;

  let pick: { start: number; end: number; duration_min: number } | null = null;
  for (const s of norm) {
    if (!pick || s.duration_min > pick.duration_min) pick = s;
  }
  if (!pick || pick.duration_min < minBreachHours * 60) return null;

  const hours = Math.floor(pick.duration_min / 60);
  const mins = Math.round(pick.duration_min - hours * 60);
  const fmt = `${hours}h ${String(mins).padStart(2, '0')}m`;

  return {
    pattern: 'pacing-breach',
    confidence: 'high',
    sample_n: norm.length,
    date_range: { start: dayKey(pick.start), end: dayKey(pick.end) },
    session: { start: pick.start, end: pick.end, duration_min: Math.round(pick.duration_min) },
    duration_label: fmt,
    copy: `${fmt} session. flow showed up. pattern, not cause.`,
    copy_envelope:
      `${fmt} session past your safe pacing zone. ` +
      `last time this took 72 hours to recover. body hasn't filed the bill yet.`,
    source: {
      citation: 'Goudsmit et al. 2012, Disability & Rehabilitation — Pacing as a strategy to improve energy management',
      url: 'https://doi.org/10.3109/09638288.2011.635746',
    },
  };
}
