/**
 * @ollie/logic/dissection
 *
 * Extracts structured actions from free-text brain-dump input.
 * Keyword-based fallback; the async AI router wraps this when available.
 *
 * All functions are pure: no I/O, no DOM, no globals.
 */

export type { Action, AnswerRoute, DissectionContext, ModuleName, Route } from './types';
export { fallbackRoute } from './fallback-route';

import type { DissectionContext, Route } from './types';
import { fallbackRoute } from './fallback-route';

/**
 * Extract structured actions from a brain-dump string.
 *
 * @param text     — raw user input
 * @param context  — optional hint (reserved; not used by keyword router)
 */
export function extract(text: string, _context?: DissectionContext): Route {
  return fallbackRoute(text);
}
