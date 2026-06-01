/**
 * apps/native · dump/mood-lexicon.ts  —  local, offline dump-mood tagger
 *
 * Tags a dump's mood from its raw text with NO model and NO cloud call — it
 * reuses the SAME low-mood lexicon the goals low-mood delete-lock detector
 * uses (`@ollie/logic/goals` → LOW_MOOD_RE: exhausted/done/hopeless/empty/numb/
 * crashing/burnt out/… + Turkish bittim/tükendim/umutsuz/…). Keeping one
 * lexicon means the tag we attach here and the lock the orchestrator computes
 * agree by construction.
 *
 * `high` is detected with a small positive lexicon so the signal isn't purely
 * negative; everything else is `neutral`. Low-mood is the load-bearing case
 * (it gates goal deletion + feeds finance doom-buying), so we bias toward
 * recall there and treat ambiguity as neutral.
 *
 * Shared by:
 *   - dump/archive.ts (via DumpScreen) — stamps the archived row's mood
 *   - bridge/mood.ts (recordMoodFromDump) — feeds the goals_mood_log signal
 */

import { LOW_MOOD_RE } from '@ollie/logic/goals';

export type DumpMood = 'low' | 'neutral' | 'high';

/**
 * A small positive-affect lexicon (EN + ES + TR) — deliberately narrow so a
 * neutral logistics dump ("bought milk") never reads as `high`. Low mood wins
 * ties: a dump that is both ("finally shipped it but i'm exhausted") tags low,
 * because the lock + doom-buying signals are the ones that matter.
 */
const HIGH_MOOD_RE =
  /\b(great|amazing|excited|happy|joy|proud|grateful|energized|energised|wonderful|fantastic|love(?:d|ing)?\s+(?:it|this|today)|harika|mutlu|heyecanl[ıi]|gururlu|minnettar|genial|feliz|emocionad[oa]|orgullos[oa])\b/i;

/**
 * Tag a dump's mood from its raw text. Pure + synchronous + offline.
 * Empty / non-string input → 'neutral'.
 */
export function tagDumpMood(text: string): DumpMood {
  if (typeof text !== 'string' || !text.trim()) return 'neutral';
  if (LOW_MOOD_RE.test(text)) return 'low';
  if (HIGH_MOOD_RE.test(text)) return 'high';
  return 'neutral';
}
