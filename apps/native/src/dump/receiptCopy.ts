/**
 * receiptCopy — pure copy builder for the post-dump receipt.
 *
 * After a dump routes silently, the home screen shows ONE calm line telling
 * the user which life areas were updated ("Saved to Groceries + Meds.") so a
 * silent high-confidence save is no longer invisible (report §H, first ticket).
 *
 * Discipline (Ollie DNA):
 *   - module NAMES only, never the dumped text/items — safe on a glance, no
 *     sensitive specifics (doses, amounts, who/what).
 *   - no feed, no count, no confidence, no celebration, no shame.
 *   - generic / unrouted captures (dump_only, journal) collapse to "Noted."
 *
 * This is intentionally a pure function (no React) so the mapping + dedupe +
 * "+ more" overflow are unit-tested without rendering.
 */

/** Friendly destination names — what the user calls the place, not the id. */
const MODULE_RECEIPT_LABELS: Record<string, string> = {
  grocery: 'Groceries',
  medication: 'Meds',
  finance: 'Money',
  cycle: 'Cycle',
  mood: 'Mood',
  sleep: 'Sleep',
  body: 'Body',
  work: 'Work',
  admin: 'To-do',
  chores: 'Chores',
  goals: 'Goals',
  habits: 'Habits',
  pets: 'Pets',
};

/** Modules that carry no nameable destination — they collapse to "Noted." */
const GENERIC_MODULES = new Set(['dump_only', 'journal', 'crisis', '']);

/** How many destinations we name before collapsing the tail into "+ more". */
const MAX_NAMED = 3;

/**
 * Build the receipt line from the modules a dump actually wrote to.
 *
 * @param writtenModules module ids of fragments that were SAVED (drafts awaiting
 *   confirm must be filtered out by the caller — they weren't written yet).
 * @returns the calm line, or null when there is nothing to acknowledge.
 */
export function buildReceiptText(writtenModules: readonly string[]): string | null {
  // Map → friendly names, dropping generic/unroutable buckets, deduped in
  // first-seen order so "milk, eggs" doesn't say "Groceries + Groceries".
  const seen = new Set<string>();
  const named: string[] = [];
  for (const id of writtenModules) {
    if (GENERIC_MODULES.has(id)) continue;
    const label = MODULE_RECEIPT_LABELS[id] ?? titleCase(id);
    if (seen.has(label)) continue;
    seen.add(label);
    named.push(label);
  }

  if (named.length === 0) {
    // Something was processed but it had no nameable home (e.g. a pure
    // dump_only capture) → a quiet "Noted." Nothing at all → no receipt.
    return writtenModules.length > 0 ? 'Noted.' : null;
  }

  const shown = named.slice(0, MAX_NAMED);
  const parts = named.length > MAX_NAMED ? [...shown, 'more'] : shown;
  return `Saved to ${parts.join(' + ')}.`;
}

/** Fallback for an unknown module id: "side_effect" → "Side effect". */
function titleCase(id: string): string {
  const s = id.replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
