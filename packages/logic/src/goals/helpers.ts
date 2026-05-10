/**
 * @ollie/logic · goals helpers
 *
 * Pure utility functions: tokeniser, now-resolver, regex builder.
 * No I/O. No DOM. No wall-clock reads.
 */

import type { GoalsOpts, DumpHistory, GoalsHistory } from './types';

export const STOP = new Set([
  'the','and','for','with','that','this','have','from','about','just','like','what',
  'your','they','their','them','then','some','very','really','today','i','a','an','to',
  'of','in','on','is','it','at','be','my','me','was','are','so','am','do','did','not',
  'will','would','could','should','because','when','then','than','there','these','those',
  'been','being','into','over','under','out','off','but','or','if','as','by','we','us',
  'our','you','he','she','him','her','his','hers','its','too','also','more','most','less',
  'least','only','even','still','now','here','where','which','who','whom','whose','why',
  'how','can','may','might','must','shall',
]);

export function tokens(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 3 && !STOP.has(t));
}

export function resolveNow(
  history: DumpHistory | GoalsHistory | null | undefined,
  opts: GoalsOpts | null | undefined,
): number {
  if (opts && typeof opts.now === 'number') return opts.now;
  if (history && typeof (history as GoalsHistory).now === 'number') return (history as GoalsHistory).now!;
  // Fallback to Date.now() — callers should always pass opts.now in tests.
  return Date.now();
}

const LEFT  = '(?:^|[\\s,.!?;:\'"()\\[\\]\\-/])';
const RIGHT = '(?=[\\s,.!?;:\'"()\\[\\]\\-/]|$)';
export function wrap(alts: string[]): RegExp {
  return new RegExp(LEFT + '(?:' + alts.join('|') + ')' + RIGHT, 'iu');
}

/** Resolve label from a goal object */
export function goalLabel(g: { label?: string; title?: string; id: string }): string {
  return (typeof g.label === 'string' && g.label.trim())
    || (typeof g.title === 'string' && g.title.trim())
    || g.id;
}
