/**
 * ask/query — the contract between the AI and the phone for "Ask Ollie".
 *
 * The AI's only job is to turn a question into one of these. It never returns
 * a number, a date or an answer: the phone computes those from its own data
 * (ask/engine). Anything that does not parse into a known shape + area is
 * answered with the honest fallback, never guessed.
 *
 * Plan: "Ask Ollie — roadmap, framework and methodology" (Claude Doc, 2026-09-28).
 */

export const SHAPES = ['how_much', 'when_last', 'how_many', 'list'] as const;
export type Shape = (typeof SHAPES)[number];

export const AREAS = [
  'finance',
  'admin',
  'work',
  'grocery',
  'body',
  'medication',
  'sleep',
  'mood',
  'cycle',
  'chores',
  'pets',
  'habits',
  'goals',
] as const;
export type Area = (typeof AREAS)[number];

export const NAMED_PERIODS = ['today', 'this_week', 'last_week', 'this_month', 'last_month'] as const;
export type NamedPeriod = (typeof NAMED_PERIODS)[number];

export const LANGS = ['en', 'nl'] as const;
export type AskLang = (typeof LANGS)[number];

/** What narrows a question down. Free text is matched loosely against stored names and labels. */
export interface AskFilter {
  /** A thing: "pasta", "headache", "running", "vitamin d", "bathroom". */
  readonly item?: string;
  /** Where money went: "Albert Heijn". */
  readonly merchant?: string;
  /** A spending category, when one was captured. */
  readonly category?: string;
  /** Who: "Ana". */
  readonly person?: string;
  /** Which pet: "Luna". */
  readonly pet?: string;
  /** A state the question is about. */
  readonly status?: 'missed' | 'taken' | 'bad' | 'good' | 'low' | 'open';
}

export interface AskQuery {
  readonly shape: Shape;
  readonly area: Area;
  readonly filter: AskFilter;
  readonly period: NamedPeriod | null;
  readonly lang: AskLang;
}

const STATUSES = ['missed', 'taken', 'bad', 'good', 'low', 'open'] as const;
const TEXT_FILTERS = ['item', 'merchant', 'category', 'person', 'pet'] as const;
const MAX_FILTER_TEXT = 80;

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/**
 * Strict: returns null for anything that is not exactly a known query. Unknown keys, unknown
 * values, over-long text and wrong types are all refused, so a confused or tampered AI answer
 * can only ever lead to the fallback.
 */
export function parseAskQuery(raw: unknown): AskQuery | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const allowedKeys = ['kind', 'shape', 'area', 'filter', 'period', 'lang'];
  if (Object.keys(r).some((k) => !allowedKeys.includes(k))) return null;
  if (r.kind !== undefined && r.kind !== 'question') return null;
  if (!isOneOf(SHAPES, r.shape) || !isOneOf(AREAS, r.area) || !isOneOf(LANGS, r.lang)) return null;

  let period: NamedPeriod | null = null;
  if (r.period !== undefined && r.period !== null) {
    if (!isOneOf(NAMED_PERIODS, r.period)) return null;
    period = r.period;
  }

  const filter: Record<string, string> = {};
  if (r.filter !== undefined && r.filter !== null) {
    if (typeof r.filter !== 'object' || Array.isArray(r.filter)) return null;
    for (const [key, value] of Object.entries(r.filter as Record<string, unknown>)) {
      if (value === null || value === undefined || value === '') continue;
      if (key === 'status') {
        if (!isOneOf(STATUSES, value)) return null;
        filter.status = value;
      } else if (isOneOf(TEXT_FILTERS, key)) {
        if (typeof value !== 'string' || value.length > MAX_FILTER_TEXT) return null;
        filter[key] = value.trim();
      } else {
        return null;
      }
    }
  }

  return { shape: r.shape, area: r.area, filter: filter as AskFilter, period, lang: r.lang };
}
