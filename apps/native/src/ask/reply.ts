/**
 * ask/reply — one question from the router in, one Ollie reply out. The home chat calls only this.
 *
 * Every step that can fail ends in a reply, never a throw: an unchecked query, an unresolved name
 * or a database error all become the "can't answer that one yet" reply with example questions.
 */
import type { RouterQuestion } from '../router/schema';
import { COMPUTED_NOTE, EXAMPLES, headline, OTHER_LANGUAGE_REPLY, renderAnswer } from './copy';
import { answer, type AskResult } from './engine';
import { resolveScrubbedNames } from './names';
import { parseAskQuery, type AskLang } from './query';

export interface AskReply {
  /** The sentence Ollie says. */
  readonly text: string;
  /** The big number on the card, when the answer has one. */
  readonly headline: string | null;
  /** Tappable example questions (only on the "can't answer yet" reply). */
  readonly examples: readonly string[];
  /** True when the answer was computed from the person's data (the "worked out on your phone" note may show). */
  readonly computed: boolean;
  /** That note, in the asker's language. */
  readonly note: string;
}

const FALLBACK: AskResult = { kind: 'fallback' };

function toReply(result: AskResult, lang: AskLang, now: number): AskReply {
  return {
    text: renderAnswer(result, lang, now),
    headline: headline(result, lang),
    examples: result.kind === 'fallback' ? EXAMPLES[lang] : [],
    computed: result.kind !== 'fallback',
    note: COMPUTED_NOTE[lang],
  };
}

/**
 * @param question one entry of RouterOutput.questions
 * @param rawText  what the person typed, unscrubbed (names are resolved from it, on the phone)
 */
export async function replyTo(question: RouterQuestion, rawText: string, now: number = Date.now()): Promise<AskReply> {
  if (question.lang === 'other') {
    return { text: OTHER_LANGUAGE_REPLY, headline: null, examples: [], computed: false, note: '' };
  }
  const lang = question.lang;
  const parsed = question.query ? parseAskQuery({ ...question.query, lang }) : null;
  if (!parsed) return toReply(FALLBACK, lang, now);
  try {
    const resolved = await resolveScrubbedNames(parsed, rawText);
    return toReply(resolved ? await answer(resolved, now) : FALLBACK, lang, now);
  } catch (err) {
    console.warn('[ask] answer failed; replying with the fallback', err);
    return toReply(FALLBACK, lang, now);
  }
}
