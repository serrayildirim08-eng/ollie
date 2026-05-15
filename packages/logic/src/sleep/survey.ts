/**
 * @ollie/logic · sleep · insomnia severity survey
 *
 * The "go deeper" lite survey (Serra decision 2026-05-15):
 *   NOT a full clinical battery (no MCTQ/PSQI/ISI/ESS set) — a single
 *   ~7-question insomnia-severity questionnaire modelled on the ISI.
 *
 * Every item scores 0–4; total 0–28. Bands follow the standard ISI
 * cut-offs. This file owns the question text and the pure scoring
 * function — no I/O, no DOM, no wall-clock reads (now is a parameter).
 *
 * The UI presents INSOMNIA_SURVEY_QUESTIONS, collects one 0–4 option
 * index per question, and hands the answer array to scoreInsomniaSurvey.
 */

import type {
  InsomniaSurveyAnswers,
  InsomniaSurveyResult,
  InsomniaSeverityBand,
} from './types';

export const INSOMNIA_SURVEY_LENGTH = 7;

export interface InsomniaSurveyQuestion {
  /** Stable id — UI keys answers + telemetry by this, never by index. */
  id: string;
  /** Question prompt (English — Ollie ships EN + ES, ES lives in strings). */
  prompt: string;
  /** Exactly 5 option labels, scored 0–4 by their array index. */
  options: [string, string, string, string, string];
}

/**
 * The 7 items. Items 0–2 are ISI-style severity-of-difficulty ratings,
 * item 3 is satisfaction (reverse-worded but options stay 0=best→4=worst),
 * items 4–6 cover daytime impact / noticeability / worry.
 */
export const INSOMNIA_SURVEY_QUESTIONS: readonly InsomniaSurveyQuestion[] = [
  {
    id: 'falling_asleep',
    prompt: 'Over the last 2 weeks — difficulty falling asleep.',
    options: ['none', 'mild', 'moderate', 'severe', 'very severe'],
  },
  {
    id: 'staying_asleep',
    prompt: 'Difficulty staying asleep.',
    options: ['none', 'mild', 'moderate', 'severe', 'very severe'],
  },
  {
    id: 'waking_early',
    prompt: 'Waking up too early.',
    options: ['none', 'mild', 'moderate', 'severe', 'very severe'],
  },
  {
    id: 'satisfaction',
    prompt: 'How satisfied are you with your current sleep?',
    options: [
      'very satisfied',
      'satisfied',
      'neutral',
      'dissatisfied',
      'very dissatisfied',
    ],
  },
  {
    id: 'daytime_impact',
    prompt: 'How much does sleep interfere with your daytime functioning?',
    options: ['not at all', 'a little', 'somewhat', 'much', 'very much'],
  },
  {
    id: 'noticeable',
    prompt: 'How noticeable to others is your sleep problem?',
    options: ['not at all', 'a little', 'somewhat', 'much', 'very much'],
  },
  {
    id: 'worry',
    prompt: 'How worried are you about your current sleep?',
    options: ['not at all', 'a little', 'somewhat', 'much', 'very much'],
  },
] as const;

/** Map a 0–28 total to a severity band using standard ISI cut-offs. */
export function insomniaSeverityBand(score: number): InsomniaSeverityBand {
  if (score <= 7) return 'none';
  if (score <= 14) return 'subthreshold';
  if (score <= 21) return 'moderate';
  return 'severe';
}

/** True when a value is a valid 0–4 integer answer. */
function isValidAnswer(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4;
}

/**
 * Score a completed insomnia survey.
 *
 * Returns null unless ALL 7 questions carry a valid 0–4 answer — a
 * partial survey is not scored (the UI gates submission on completion,
 * this is the defensive backstop). `now` stamps `scored_at`.
 */
export function scoreInsomniaSurvey(
  answers: readonly number[] | InsomniaSurveyAnswers | null | undefined,
  now: number,
): InsomniaSurveyResult | null {
  if (!Array.isArray(answers)) return null;
  if (answers.length !== INSOMNIA_SURVEY_LENGTH) return null;
  if (!answers.every(isValidAnswer)) return null;

  const score = answers.reduce((sum, v) => sum + v, 0);
  return {
    score,
    band: insomniaSeverityBand(score),
    answered: INSOMNIA_SURVEY_LENGTH,
    scored_at: typeof now === 'number' && isFinite(now) ? now : 0,
  };
}
