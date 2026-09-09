/**
 * apps/native · notify/reminderCascade.ts — manual one-shot reminder logic.
 *
 * The deterministic "BODY" half of the manual-reminder feature. Layer 1 (the
 * AI router) only decides reminder INTENT + extracts a clock time when the user
 * named one ("at 6pm" → "18:00"). Everything below — turning a clock time into
 * an absolute fire timestamp, rolling a past time forward, and the 7pm fallback
 * for time-less reminders — is pure, testable harness code with NO LLM in the
 * loop.
 *
 * Three entry points the rest of the app uses:
 *   - resolveTimeOfDayFireAt("HH:MM", now) → next wall-clock occurrence (today
 *     if still ahead, else tomorrow). Never returns a time in the past.
 *   - fallbackFireAt(now)                  → the dismiss fallback: TODAY at
 *     19:00, or tomorrow 19:00 if 7pm already passed (never the past).
 *   - WHEN_PRESETS                         → the quick-pick chips the "when?"
 *     card offers; each resolves to a fireAt via resolveTimeOfDayFireAt.
 *
 * Reuses @ollie/notifications' parseHHMM so the "HH:MM" grammar matches the
 * medication schedule + quiet-hours code exactly (one parser, no drift).
 */

import { parseHHMM } from '@ollie/notifications';

/** The dismiss / no-answer fallback clock time: 7pm local. */
export const FALLBACK_HHMM = '19:00';

/**
 * Resolve an "HH:MM" 24h-local clock time to the next absolute wall-clock
 * occurrence at or after `now`:
 *   - today at HH:MM when that moment is still in the future;
 *   - otherwise tomorrow at HH:MM (so we NEVER schedule in the past — the
 *     "remind me to call mom at 6pm" said at 8pm rolls to 6pm tomorrow).
 *
 * Returns null when the string isn't a valid HH:MM (caller then drops the
 * absolute time and falls back to the cascade). `now` is injectable for tests.
 */
export function resolveTimeOfDayFireAt(hhmm: string, now: Date = new Date()): number | null {
  const minutes = parseHHMM(hhmm);
  if (minutes === null) return null;

  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;

  const fire = new Date(now);
  fire.setHours(hh, mm, 0, 0);

  // Past or exactly now → roll to the same time tomorrow (never the past).
  if (fire.getTime() <= now.getTime()) {
    fire.setDate(fire.getDate() + 1);
  }
  return fire.getTime();
}

/**
 * The fallback fire time when the user dismisses (or never answers) the
 * "when?" prompt: 7pm TODAY, rolling to 7pm tomorrow if it's already past 7pm
 * (so a late dump still gets a sensible, non-past reminder). Pure; `now`
 * injectable for tests.
 */
export function fallbackFireAt(now: Date = new Date()): number {
  // resolveTimeOfDayFireAt already rolls a passed time to tomorrow, so this is
  // exactly the desired "today 19:00 unless it's passed" behaviour.
  return resolveTimeOfDayFireAt(FALLBACK_HHMM, now)!;
}

/** A quick-pick option shown on the "when?" card. */
export interface WhenPreset {
  /** Editorial label (lowercase per DNA). */
  readonly label: string;
  /** 24h-local "HH:MM" this preset resolves to. */
  readonly hhmm: string;
}

/**
 * The quick-pick chips the "when?" card offers, in order. Kept tiny + concrete
 * (ADHD-minimal): a morning slot, an afternoon slot, and the 7pm default. Each
 * resolves through resolveTimeOfDayFireAt, so any preset whose time has already
 * passed today simply lands tomorrow — no special-casing in the card.
 */
export const WHEN_PRESETS: readonly WhenPreset[] = [
  { label: 'this morning', hhmm: '09:00' },
  { label: 'this afternoon', hhmm: '14:00' },
  { label: 'tonight', hhmm: FALLBACK_HHMM },
];
