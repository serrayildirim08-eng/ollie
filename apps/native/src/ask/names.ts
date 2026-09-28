/**
 * ask/names — puts back names the router could not see.
 *
 * Before a message leaves the phone for the AI, names and health words are scrubbed ("[NAME]",
 * "[MEDICATION]"), so a question about Luna comes back with filter { pet: "[NAME]" }. The phone
 * still has the words the person typed and its own records: the name is whichever stored name
 * appears in the typed question. Found nowhere means unresolved, and the engine answers with the
 * fallback rather than a guess (a vet visit of the wrong pet is worse than no answer).
 */
import { sql } from '../storage';
import type { AskFilter, AskQuery } from './query';

const SCRUBBED = /\[[A-Z_]+\]/;

type TextKey = 'item' | 'merchant' | 'category' | 'person' | 'pet';

/** Where each filter's real values live, per area. */
function candidatesQuery(area: AskQuery['area'], key: TextKey): string | null {
  if (key === 'pet') return 'SELECT DISTINCT pet_name AS v FROM pets_events';
  if (key === 'person') return "SELECT DISTINCT json_extract(data, '$.with') AS v FROM work_events WHERE kind = 'meeting'";
  if (key === 'merchant') return 'SELECT DISTINCT merchant AS v FROM finance_transactions';
  if (key === 'category') return 'SELECT DISTINCT category AS v FROM finance_transactions';
  switch (area) {
    case 'medication':
      return 'SELECT name AS v FROM medications_registry UNION SELECT name AS v FROM medication_cabinet';
    case 'habits':
      return 'SELECT name AS v FROM habits_registry';
    case 'chores':
      return 'SELECT name AS v FROM chores UNION SELECT name AS v FROM chore_completion';
    case 'body':
      return "SELECT DISTINCT json_extract(data, '$.label') AS v FROM body_events";
    case 'grocery':
      return 'SELECT recipe_name AS v FROM grocery_cook_history';
    case 'finance':
      return 'SELECT DISTINCT merchant AS v FROM finance_transactions';
    default:
      return null;
  }
}

/** The longest stored value that appears in the typed text, or null. */
async function findIn(rawText: string, query: string): Promise<string | null> {
  const typed = rawText.toLowerCase();
  const rows = await sql.select<{ v: unknown }>(query);
  let best: string | null = null;
  for (const { v } of rows) {
    if (typeof v !== 'string' || v.trim().length < 2) continue;
    if (typed.includes(v.toLowerCase()) && (!best || v.length > best.length)) best = v;
  }
  return best;
}

/**
 * The query with every scrubbed filter value replaced by the real one, or null when one cannot be
 * resolved (the caller answers with the fallback).
 */
export async function resolveScrubbedNames(q: AskQuery, rawText: string): Promise<AskQuery | null> {
  const filter: Record<string, string> = { ...q.filter } as Record<string, string>;
  for (const key of ['item', 'merchant', 'category', 'person', 'pet'] as const) {
    const value = q.filter[key];
    if (!value || !SCRUBBED.test(value)) continue;
    const source = candidatesQuery(q.area, key);
    const found = source ? await findIn(rawText, source) : null;
    if (!found) return null;
    filter[key] = found;
  }
  return { ...q, filter: filter as AskFilter };
}
