/**
 * @ollie/logic · sleep · Epworth Sleepiness Scale (ESS)
 *
 * The second "go deeper" instrument (Serra decision 2026-05-18). The ESS
 * measures DAYTIME sleepiness — how likely you are to doze in eight
 * everyday situations. It is the one instrument not redundant with the
 * stats Ollie already derives from logged nights: those describe the
 * night, the ESS describes the waking day.
 *
 * Eight items, each scored 0–3; total 0–24. Bands follow the standard
 * ESS cut-offs. This file owns the question text and the pure scoring
 * function — no I/O, no DOM, no wall-clock reads (now is a parameter).
 *
 * The UI presents EPWORTH_QUESTIONS with the shared EPWORTH_OPTIONS,
 * collects one 0–3 option index per question, and hands the answer
 * array to scoreEpworth.
 */

import type {
  EpworthAnswers,
  EpworthResult,
  EpworthSleepinessBand,
} from './types';

export const EPWORTH_LENGTH = 8;

export interface EpworthQuestion {
  /** Stable id — UI keys answers + telemetry by this, never by index. */
  id: string;
  /** The situation prompt (English — ES survey strings are a tracked follow-up). */
  prompt: string;
}

/**
 * The shared 0–3 dozing-likelihood scale. Every ESS item uses the same
 * options, so the labels live once here rather than per question.
 */
export const EPWORTH_OPTIONS = [
  'would never doze',
  'slight chance of dozing',
  'moderate chance of dozing',
  'high chance of dozing',
] as const;

/**
 * The standard eight ESS situations. Wording stays clinically faithful
 * (changing it would invalidate the score) — only the casing is dropped
 * to match the sleep module's voice.
 */
export const EPWORTH_QUESTIONS: readonly EpworthQuestion[] = [
  { id: 'reading',       prompt: 'Sitting and reading.' },
  { id: 'watching_tv',   prompt: 'Watching TV.' },
  { id: 'public_place',  prompt: 'Sitting still in a public place — a meeting, a theatre.' },
  { id: 'car_passenger', prompt: 'As a passenger in a car for an hour without a break.' },
  { id: 'lying_down',    prompt: 'Lying down to rest in the afternoon when you can.' },
  { id: 'talking',       prompt: 'Sitting and talking to someone.' },
  { id: 'after_lunch',   prompt: 'Sitting quietly after lunch, without alcohol.' },
  { id: 'car_stopped',   prompt: 'In a car, stopped for a few minutes in traffic.' },
] as const;

/** Map a 0–24 total to a sleepiness band using standard ESS cut-offs. */
export function epworthSleepinessBand(score: number): EpworthSleepinessBand {
  if (score <= 10) return 'normal';
  if (score <= 12) return 'mild';
  if (score <= 15) return 'moderate';
  return 'high';
}

/** True when a value is a valid 0–3 integer answer. */
function isValidAnswer(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3;
}

/**
 * Score a completed Epworth survey.
 *
 * Returns null unless ALL 8 questions carry a valid 0–3 answer — a
 * partial survey is not scored (the UI gates submission on completion;
 * this is the defensive backstop). `now` stamps `scored_at`.
 */
export function scoreEpworth(
  answers: readonly number[] | EpworthAnswers | null | undefined,
  now: number,
): EpworthResult | null {
  if (!Array.isArray(answers)) return null;
  if (answers.length !== EPWORTH_LENGTH) return null;
  if (!answers.every(isValidAnswer)) return null;

  const score = answers.reduce((sum, v) => sum + v, 0);
  return {
    score,
    band: epworthSleepinessBand(score),
    answered: EPWORTH_LENGTH,
    scored_at: typeof now === 'number' && isFinite(now) ? now : 0,
  };
}
