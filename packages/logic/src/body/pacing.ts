/**
 * @ollie/logic · body pacing-breach helpers (C3)
 *
 * Energy-envelope / pacing frame: long hyperfocus sessions are treated as
 * capacity borrowed from future recovery. Source: Goudsmit et al. 2012,
 * Disability and Rehabilitation — "Pacing as a strategy to improve energy
 * management in ME/CFS".
 *
 * Pure: no store / DOM / wall-clock reads. `now` is always injected.
 */

import type { SessionRef, PacingBreachEpisode, FocusSession } from './types';
import { HOUR_MS } from '../util';

export const DEFAULT_RECOVERY_HOURS = 72;
export const MIN_BREACH_HOURS = 8;

/**
 * Detect the longest focus session >= minHours within the supplied list.
 * Returns null when nothing qualifies.
 */
export function detectBreachSession(
  sessions: FocusSession[],
  opts?: { minHours?: number; now?: number },
): SessionRef | null {
  const o = opts || {};
  const minHours = typeof o.minHours === 'number' ? o.minHours : MIN_BREACH_HOURS;
  const now = typeof o.now === 'number' ? o.now : Date.now();
  if (!Array.isArray(sessions) || sessions.length === 0) return null;

  let pick: SessionRef | null = null;
  let pickHours = 0;
  for (const s of sessions) {
    if (!s || typeof s.start !== 'number' || typeof s.end !== 'number') continue;
    if (s.end <= s.start || s.end > now) continue;
    const hours = (s.end - s.start) / HOUR_MS;
    if (hours < minHours) continue;
    if (hours > pickHours) {
      pickHours = hours;
      pick = { start: s.start, end: s.end, duration_hours: Number(hours.toFixed(2)) };
    }
  }
  return pick;
}

/**
 * Build a new pacing_breach episode. randomFn injected for deterministic tests.
 */
export function newBreachEpisode(
  sessionRef: SessionRef,
  opts?: { now?: number; recoveryHours?: number; randomFn?: () => string },
): PacingBreachEpisode {
  const o = opts || {};
  const openedAt = typeof o.now === 'number' ? o.now : Date.now();
  const recoveryHours = typeof o.recoveryHours === 'number' ? o.recoveryHours : DEFAULT_RECOVERY_HOURS;
  const r = typeof o.randomFn === 'function'
    ? o.randomFn()
    : Math.random().toString(36).slice(2, 8);

  return {
    id: 'ep_' + openedAt + '_' + r,
    kind: 'pacing_breach',
    label: 'pacing breach',
    opened_at: openedAt,
    started_at: openedAt,
    closed_at: null,
    ended_at: undefined,
    hyperfocus_session_ref: sessionRef,
    expected_recovery_hours: recoveryHours,
    symptoms: [],
    meds: [],
    severity_log: [],
    notes: [],
    tags: ['pacing-breach', 'energy-envelope'],
    source: 'goudsmit-2012',
  };
}

/**
 * True when an open breach has aged past its recovery window.
 */
export function isBreachExpired(
  episode: Partial<PacingBreachEpisode>,
  now: number,
): boolean {
  if (!episode || episode.kind !== 'pacing_breach') return false;
  if (episode.closed_at) return false;
  const opened = typeof episode.opened_at === 'number'
    ? episode.opened_at
    : episode.started_at;
  if (typeof opened !== 'number') return false;
  const hours = typeof episode.expected_recovery_hours === 'number'
    ? episode.expected_recovery_hours
    : DEFAULT_RECOVERY_HOURS;
  return (now - opened) >= hours * HOUR_MS;
}

/**
 * Auto-close every expired open breach. Returns a NEW array (immutable).
 */
export function autoCloseExpiredBreaches(
  episodes: Partial<PacingBreachEpisode>[],
  now: number,
): Partial<PacingBreachEpisode>[] {
  if (!Array.isArray(episodes)) return [];
  return episodes.map(ep => {
    if (!isBreachExpired(ep, now)) return ep;
    return { ...ep, closed_at: now, ended_at: now };
  });
}

/**
 * True if any open pacing_breach already references this exact session window.
 * Prevents duplicate episodes when the orchestrator runs twice on the same session.
 */
export function hasOpenBreachForSession(
  episodes: Partial<PacingBreachEpisode>[],
  sessionRef: SessionRef,
): boolean {
  if (!Array.isArray(episodes) || !sessionRef) return false;
  for (const ep of episodes) {
    if (!ep || ep.kind !== 'pacing_breach') continue;
    if (ep.closed_at) continue;
    const r = ep.hyperfocus_session_ref;
    if (!r) continue;
    if (r.start === sessionRef.start && r.end === sessionRef.end) return true;
  }
  return false;
}
