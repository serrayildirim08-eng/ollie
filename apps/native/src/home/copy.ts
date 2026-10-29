/**
 * copy — the home screen's words, pure.
 *
 *   greeting()  the line under the date: "Good afternoon, Serra. Two things
 *               left today."
 *   buildReply() Ollie's chat bubble after a message: what it did and, for a
 *               reminder, exactly when it will ping. Built only from what the
 *               harness actually did (scheduled times, saved modules) — never
 *               promises anything that didn't happen.
 */

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

function partOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Evening';
  return 'Hi';
}

/** Just the salutation: "Good afternoon, Serra." — used alone on first open. */
export function hello(now: Date, firstName: string | null | undefined): string {
  const name = firstName?.trim();
  return name ? `${partOfDay(now.getHours())}, ${name}.` : `${partOfDay(now.getHours())}.`;
}

export function greeting(now: Date, firstName: string | null | undefined, openToday: number): string {
  const hi = hello(now, firstName);
  if (openToday <= 0) return `${hi} Nothing left for today.`;
  const n = NUMBER_WORDS[openToday] ?? String(openToday);
  return `${hi} ${n} ${openToday === 1 ? 'thing' : 'things'} left today.`;
}

// ─── reply ────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "at 18:00" · "tomorrow at 09:00" · "on Wednesday at 14:30" · "on 13 Oct at 10:00" */
export function whenPhrase(fireAt: number, now: number): string {
  const d = new Date(fireAt);
  const days = Math.round((startOfDay(fireAt) - startOfDay(now)) / DAY_MS);
  if (days <= 0) {
    const mins = Math.round((fireAt - now) / 60_000);
    if (mins > 0 && mins < 60) return `in ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    return `at ${hhmm(d)}`;
  }
  if (days === 1) return `tomorrow at ${hhmm(d)}`;
  if (days < 7) return `on ${WEEKDAYS[d.getDay()]} at ${hhmm(d)}`;
  return `on ${d.getDate()} ${MONTHS[d.getMonth()]} at ${hhmm(d)}`;
}

export interface TurnOutcome {
  /** Reminders the harness scheduled during this turn (fire times, ms). */
  readonly reminders: readonly number[];
  /** "Saved to To-do." style receipt, or null when nothing was written. */
  readonly receipt: string | null;
  /** A time-less "remind me" — the "when?" card is showing. */
  readonly askedWhen: boolean;
  /** Fragments waiting on a keep/undo card. */
  readonly needsConfirm: number;
}

/** First-open intro + example chips (tap → fills the composer). */
export const INTRO =
  "Hi, I'm Ollie. Tell me anything you need to remember — I'll keep the list and ping you on time.";
export const EXAMPLES = ['Call mom at 6', 'Pay rent on the 1st', 'Dentist Wednesday 2:30'] as const;

export function buildReply(o: TurnOutcome, now: number): string {
  const parts: string[] = [];
  const times = [...o.reminders].sort((a, b) => a - b);
  if (times.length === 1) {
    parts.push(`Got it — I'll remind you ${whenPhrase(times[0]!, now)}.`);
  } else if (times.length > 1) {
    parts.push(`Got it — ${times.length} reminders: ${times.map((t) => whenPhrase(t, now)).join(', ')}.`);
  } else if (o.askedWhen) {
    parts.push('Saved. When should I remind you?');
  } else if (o.receipt) {
    parts.push(o.receipt);
  }
  if (o.needsConfirm > 0) {
    parts.push(o.needsConfirm === 1 ? "I wasn't sure about one part — check below." : `I wasn't sure about ${o.needsConfirm} parts — check below.`);
  }
  return parts.length > 0 ? parts.join(' ') : 'Noted.';
}
