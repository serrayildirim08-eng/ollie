/**
 * @ollie/logic/prompts
 *
 * Starter-prompt engine for the blank-cursor rescue. Rule-based,
 * deterministic, no LLM. Builds candidate prompts from stale-module
 * + cycle + time-of-day signals; rate-limits per id (6h); avoids
 * repeating any of the last 20 shown ids.
 *
 * Grounded in Gollwitzer's if-then planning + JITAI (Nahum-Shani 2018):
 * surface a relevant prompt when a module is stale enough to matter,
 * not on a clock.
 *
 * `now` is an explicit param (no Date.now() reads inside).
 */

import { currentPeakMatch, type Peak } from '../ritual';

export interface PromptCandidate {
  id: string;
  text: string;
  priority: number;
  why?: string;
}

export interface ShownEntry {
  id: string;
  shownAt: number;
}

export interface BuildCandidatesState {
  now: number;
  sleepSessions?: Array<{ ts?: number; night_of?: string }>;
  prediction?: { nextPeriodTs?: number };
  petGaps?: Array<{ severity?: string }>;
  reminders?: Array<{ state?: string; fireAt?: number }>;
  actionLog?: Array<{ ts?: number }>;
  waterLog?: Array<number | { ts: number }>;
  habitsItems?: Array<{ ts: number }>;
  ritualPeaks?: readonly Peak[];
  /** Pluralizer for water glasses. Defaults to "glass / glasses" in English. */
  glassLabel?: (n: number) => string;
}

export const FALLBACK: PromptCandidate = {
  id: 'fallback',
  text: "what's on your mind...",
  priority: 0,
};

const RATE_LIMIT_MS = 6 * 3_600_000;
const MAX_SHOWN_HISTORY = 20;
const HOUR_MS = 3_600_000;

function defaultGlassLabel(n: number): string {
  return n === 1 ? 'glass' : 'glasses';
}

export function buildCandidates(state: BuildCandidatesState): PromptCandidate[] {
  const now = state.now;
  const out: PromptCandidate[] = [];

  // Sleep gap — last logged sleep > 48h ago (or never)
  const sleepSessions = Array.isArray(state.sleepSessions) ? state.sleepSessions : [];
  const lastSleepTs = sleepSessions.reduce((m, ss) => {
    const t = ss?.ts ?? (ss?.night_of ? Date.parse(ss.night_of + 'T12:00:00Z') : NaN);
    return typeof t === 'number' && Number.isFinite(t) && t > m ? t : m;
  }, 0);
  const hoursSinceSleep = lastSleepTs ? (now - lastSleepTs) / HOUR_MS : Infinity;
  if (hoursSinceSleep >= 48) {
    out.push({
      id: 'sleep-gap',
      text: "haven't logged bed in a while. anything to say?",
      priority: 0.75,
      why: 'sleep-gap',
    });
  }

  // Cycle approaching — predicted next period within 3 days
  if (state.prediction && typeof state.prediction.nextPeriodTs === 'number') {
    const daysUntil = (state.prediction.nextPeriodTs - now) / 86_400_000;
    if (daysUntil > -1 && daysUntil <= 3) {
      out.push({
        id: 'cycle-approaching',
        text: "period might be close. how's the body?",
        priority: 0.85,
        why: 'cycle-approaching',
      });
    }
  }

  // Pet care gap — any pet with non-ok severity
  const petGaps = Array.isArray(state.petGaps) ? state.petGaps : [];
  if (petGaps.some((g) => g && g.severity && g.severity !== 'ok')) {
    out.push({
      id: 'pets-overdue',
      text: 'pet care due. log or schedule?',
      priority: 0.7,
      why: 'pets-overdue',
    });
  }

  // Reminder follow-up — any reminder fired in the last 4h still scheduled
  const reminders = Array.isArray(state.reminders) ? state.reminders : [];
  const recentFired = reminders.some((r) => {
    if (!r || r.state !== 'scheduled') return false;
    if (typeof r.fireAt !== 'number') return false;
    const hoursSinceFire = (now - r.fireAt) / HOUR_MS;
    return hoursSinceFire > 0 && hoursSinceFire < 4;
  });
  if (recentFired) {
    out.push({
      id: 'reminder-followup',
      text: 'did you do the thing i reminded you about?',
      priority: 0.65,
      why: 'reminder-followup',
    });
  }

  // Dump drought — nothing logged in last 24h at all
  const actionLog = Array.isArray(state.actionLog) ? state.actionLog : [];
  const lastLog = actionLog.reduce((m, e) => {
    const t = e?.ts;
    return typeof t === 'number' && t > m ? t : m;
  }, 0);
  if (lastLog && now - lastLog > 24 * HOUR_MS) {
    out.push({
      id: 'dump-drought',
      text: "it's been quiet. what's happening.",
      priority: 0.5,
      why: 'dump-drought',
    });
  }

  // Water gap — past 2pm local, fewer than 3 glasses today
  const hourOfDay = new Date(now).getHours();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const waterLog = Array.isArray(state.waterLog) ? state.waterLog : [];
  const waterToday = waterLog.filter((w) =>
    typeof w === 'number' ? w >= todayMs : !!w && w.ts >= todayMs,
  ).length;
  if (hourOfDay >= 14 && waterToday < 3) {
    const glassLabel = (state.glassLabel ?? defaultGlassLabel)(waterToday);
    out.push({
      id: 'water-gap',
      text: `only ${waterToday} ${glassLabel} today. drink something.`,
      priority: 0.55,
      why: 'water-gap',
    });
  }

  // Habit gap — nothing logged in habits today past noon
  const habitsItems = Array.isArray(state.habitsItems) ? state.habitsItems : [];
  const habitsToday = habitsItems.filter((i) => i && i.ts >= todayMs).length;
  if (hourOfDay >= 12 && habitsToday === 0) {
    out.push({
      id: 'habit-gap',
      text: 'no habits checked today. one small thing?',
      priority: 0.55,
      why: 'habit-gap',
    });
  }

  // Time-of-day nudges — low priority, always-on
  if (hourOfDay >= 6 && hourOfDay < 11) {
    out.push({
      id: 'morning-plan',
      text: "what's the one thing for today?",
      priority: 0.4,
      why: 'morning',
    });
  } else if (hourOfDay >= 20 || hourOfDay < 2) {
    out.push({
      id: 'evening-reflect',
      text: 'how was today?',
      priority: 0.4,
      why: 'evening',
    });
  }

  // Ritual-moment — we're inside one of her natural usage peaks
  if (Array.isArray(state.ritualPeaks) && state.ritualPeaks.length > 0) {
    const match = currentPeakMatch(state.ritualPeaks, now, 1);
    if (match) {
      out.push({
        id: 'ritual-moment',
        text: 'your usual ollie time. anything?',
        priority: 0.6,
        why: 'ritual-' + match.hour,
      });
    }
  }

  out.push(FALLBACK);
  return out;
}

export function pick(
  candidates: readonly PromptCandidate[] | undefined | null,
  shownHistory: readonly ShownEntry[] | undefined | null,
  now: number,
): PromptCandidate | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const hist = Array.isArray(shownHistory) ? shownHistory : [];
  const recentByTime = new Set(
    hist
      .filter((h) => h && typeof h.shownAt === 'number' && now - h.shownAt < RATE_LIMIT_MS)
      .map((h) => h.id),
  );
  const eligible = candidates.filter((c) => c && c.id && !recentByTime.has(c.id));
  const pool =
    eligible.length > 0 ? eligible : candidates.filter((c) => c && c.id === 'fallback');
  if (pool.length === 0) return null;
  return pool.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
}

export function recordShown(
  shownHistory: readonly ShownEntry[] | undefined | null,
  id: string,
  now: number,
): ShownEntry[] {
  const safe: ShownEntry[] = Array.isArray(shownHistory) ? shownHistory.slice() : [];
  if (!id) return safe;
  safe.push({ id: String(id), shownAt: now });
  return safe.length > MAX_SHOWN_HISTORY ? safe.slice(-MAX_SHOWN_HISTORY) : safe;
}
