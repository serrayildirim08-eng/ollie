/**
 * Ask Ollie · question detection + question-to-query, one JSON call per dump.
 *
 * Runs BEFORE the embedding cache and the Layer-1 classifier: a question
 * ("how much water did I drink?") sits close to a log ("drank water") in
 * embedding space, so a cache hit could file a question as a log. Fragments
 * marked as questions skip the cache, the classifier and the inbox entirely.
 *
 * The model makes one judgment per fragment — log or question, and for a
 * question the small query it asks for. It never answers: the phone computes
 * the answer from its own data (apps/native/src/ask). The fragments it sees are
 * already PII-scrubbed; a scrubbed name comes back as "[NAME]" and the phone
 * resolves it against its own records.
 *
 * Failure is safe: if every provider fails, every fragment is treated as a log,
 * which is exactly how Ollie behaved before questions existed.
 */
import { jsonCascade, type JsonProviders } from './json-cascade';

export const ASK_SHAPES = ['how_much', 'when_last', 'how_many', 'list'] as const;
export const ASK_AREAS = [
  'finance', 'admin', 'work', 'grocery', 'body', 'medication', 'sleep',
  'mood', 'cycle', 'chores', 'pets', 'habits', 'goals',
] as const;
export const ASK_PERIODS = ['today', 'this_week', 'last_week', 'this_month', 'last_month'] as const;
export const ASK_STATUSES = ['missed', 'taken', 'bad', 'good', 'low', 'open'] as const;

/** A question found in a dump. `query` is what the phone validates strictly again. */
export interface AskedQuestion {
  /** Index into the dump's fragment list. */
  readonly index: number;
  /**
   * When one fragment holds a log AND a question ("paid 40 for gas, how much this week?"), the log
   * part, to be routed like any other fragment. Undefined when the fragment is only a question.
   */
  readonly logText?: string;
  /** "en" and "nl" are answered; "other" gets a polite "English or Dutch for now". */
  readonly lang: 'en' | 'nl' | 'other';
  readonly query: {
    readonly shape: string;
    readonly area: string;
    readonly filter: Record<string, string>;
    readonly period: string | null;
  } | null;
}

const SYSTEM_PROMPT = `You read short messages people type into Ollie, a personal assistant that keeps track of their life.
For EACH numbered fragment decide: is it a LOG (something to keep, remember, remind or do) or a QUESTION about what the person already told Ollie?
Asking Ollie to do something is a LOG, even with a question mark: "can you remind me to call mom?" = LOG. Statements are LOGs.
A QUESTION asks for an amount, a last time, a count or a list of the person's own records.

If ONE fragment holds both a log and a question ("paid 40 for gas, how much this week?"), give kind "both", the log part copied as written in "log", and the question fields below.

For a QUESTION (or "both") give:
- shape: how_much (a total: money, water, sleep hours) | when_last (the last time something happened) | how_many (how many times) | list (what is on a list)
- area: finance (money, spending, bills, subscriptions) | admin (errands, calls, appointments, paperwork) | work (work tasks, meetings) | grocery (shopping list, pantry, running low, cooking) | body (water, symptoms, walks, exercise, supplements) | medication (meds, doses, running low on meds) | sleep | mood (mood, energy, good or bad days) | cycle (period) | chores (housework) | pets | habits (things done repeatedly: running, reading) | goals
- filter (only what the question names, copied as written, "[NAME]" stays "[NAME]"): item (a thing: "headache", "pasta", "laundry", "run") | merchant (a shop) | category (a spending category) | person | pet | status: missed | taken | bad | good | low | open
- period: today | this_week | last_week | this_month | last_month | null when none is named
- lang: en | nl | other (the language of the fragment)
If a question fits none of these, still mark it QUESTION with shape null.

Return JSON only: {"fragments":[{"i":0,"kind":"log"},{"i":1,"kind":"question","lang":"en","shape":"how_much","area":"finance","filter":{"merchant":"Albert Heijn"},"period":"this_week"}]}

Examples:
"how much did I spend this week?" -> question en how_much finance {} this_week
"hoeveel heb ik deze maand bij de Jumbo uitgegeven?" -> question nl how_much finance {"merchant":"Jumbo"} this_month
"when did I last take my meds" -> question en when_last medication {} null
"wanneer was [NAME] voor het laatst bij de dierenarts?" -> question nl when_last pets {"pet":"[NAME]","item":"vet"} null
"how many bad nights did I have last week?" -> question en how_many sleep {"status":"bad"} last_week
"wat staat er op mijn boodschappenlijst?" -> question nl list grocery {} null
"what's running low?" -> question en list grocery {"status":"low"} null
"what do I have to do this week" -> question en list admin {} this_week
"am I sleeping enough?" -> question en shape null
"paid 40 for gas, how much this week?" -> both, log "paid 40 for gas", en how_much finance {} this_week
"drank 2 glasses of water" -> log
"remind me to pay rent on the 1st" -> log
"kan je me morgen herinneren de huur te betalen?" -> log`;

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/** Validate one model answer. Anything off-contract becomes a question with no query (the fallback). */
function toQuestion(raw: Record<string, unknown>, index: number): AskedQuestion {
  const lang = raw.lang === 'en' || raw.lang === 'nl' ? raw.lang : 'other';
  if (!isOneOf(ASK_SHAPES, raw.shape) || !isOneOf(ASK_AREAS, raw.area)) return { index, lang, query: null };
  const filter: Record<string, string> = {};
  if (raw.filter && typeof raw.filter === 'object' && !Array.isArray(raw.filter)) {
    for (const [key, value] of Object.entries(raw.filter as Record<string, unknown>)) {
      if (typeof value !== 'string' || !value.trim() || value.length > 80) continue;
      if (key === 'status') {
        if (isOneOf(ASK_STATUSES, value)) filter.status = value;
      } else if (['item', 'merchant', 'category', 'person', 'pet'].includes(key)) {
        filter[key] = value.trim();
      }
    }
  }
  const period = isOneOf(ASK_PERIODS, raw.period) ? raw.period : null;
  return { index, lang, query: { shape: raw.shape, area: raw.area, filter, period } };
}

/**
 * Returns the questions among `fragments` (by index). Every index not returned is a log.
 * On total failure returns [] — every fragment stays a log, as before this feature.
 */
export async function findQuestions(
  fragments: readonly string[],
  providers: JsonProviders,
): Promise<AskedQuestion[]> {
  if (fragments.length === 0) return [];
  const user = fragments.map((text, i) => `${String(i)}: ${text}`).join('\n');
  try {
    return await jsonCascade(
      { system: SYSTEM_PROMPT, user, maxTokens: 600, label: 'ask' },
      providers,
      (rawText, provider) => {
        let parsed: { fragments?: unknown };
        try {
          parsed = JSON.parse(rawText) as { fragments?: unknown };
        } catch {
          throw new Error(`ask ${provider} bad json`);
        }
        if (!Array.isArray(parsed.fragments)) throw new Error(`ask ${provider} no fragments array`);
        const questions: AskedQuestion[] = [];
        for (const entry of parsed.fragments as unknown[]) {
          if (!entry || typeof entry !== 'object') continue;
          const e = entry as Record<string, unknown>;
          const i = typeof e.i === 'number' ? e.i : Number.NaN;
          if (!Number.isInteger(i) || i < 0 || i >= fragments.length) continue;
          if (e.kind === 'question') questions.push(toQuestion(e, i));
          if (e.kind === 'both') {
            const log = typeof e.log === 'string' ? e.log.trim() : '';
            // A "both" without a usable log part would lose the log: keep the fragment a log instead.
            if (log && log.length < fragments[i].length) questions.push({ ...toQuestion(e, i), logText: log });
          }
        }
        return questions;
      },
    );
  } catch (err) {
    console.warn('[route/dump] ask detection failed; treating every fragment as a log', err);
    return [];
  }
}
