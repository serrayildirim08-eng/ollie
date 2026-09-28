/**
 * upcoming — the home screen's "what's coming" list, pure.
 *
 * Joins the open to-dos (every module, via aggregateTodos) with the reminder
 * ledger (the only place the clock time lives) and groups by horizon:
 *
 *   today     — due today, overdue, or a reminder that already fired but
 *               whose task is still open
 *   thisWeek  — the next 7 days
 *   thisMonth — the next 31 days
 *   anytime   — open to-dos with no date and no reminder
 *
 * Anything beyond a month is left off on purpose: the screen answers "what do
 * I need to do soon", not "everything I've ever dumped". Grocery rows are
 * excluded — the shopping list isn't a reminder.
 */

import type { TodoItem } from '../todo/aggregateTodos';
import type { LedgerEntry } from '../notify/reminderLedger';

export type HorizonId = 'today' | 'thisWeek' | 'thisMonth' | 'anytime';

export interface UpcomingItem {
  readonly id: string;
  readonly text: string;
  readonly todo: TodoItem;
  /** Sort key: reminder fire time, else local midnight of the due day. */
  readonly at: number | null;
  /** True when `at` is a real clock time (from a reminder), not just a day. */
  readonly hasTime: boolean;
}

export interface Horizon {
  readonly id: HorizonId;
  readonly items: readonly UpcomingItem[];
}

const ORDER: readonly HorizonId[] = ['today', 'thisWeek', 'thisMonth', 'anytime'];
const DAY_MS = 86_400_000;

/** Local midnight (ms) of an ISO yyyy-mm-dd day, or null if unparseable. */
function localMidnight(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

function startOfDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function buildUpcoming(
  todos: readonly TodoItem[],
  ledger: ReadonlyMap<string, LedgerEntry>,
  now: number = Date.now(),
): Horizon[] {
  const today0 = startOfDay(now);
  const endToday = today0 + DAY_MS;
  const endWeek = today0 + 8 * DAY_MS;
  const endMonth = today0 + 32 * DAY_MS;

  const groups: Record<HorizonId, UpcomingItem[]> = {
    today: [],
    thisWeek: [],
    thisMonth: [],
    anytime: [],
  };

  for (const todo of todos) {
    if (todo.source === 'grocery') continue;
    const reminder = todo.kind === 'task' ? ledger.get(todo.rowId) : undefined;
    const at = reminder ? reminder.fireAt : todo.date ? localMidnight(todo.date) : null;
    const item: UpcomingItem = {
      id: todo.id,
      text: todo.text,
      todo,
      at,
      hasTime: reminder !== undefined,
    };
    if (at === null) groups.anytime.push(item);
    else if (at < endToday) groups.today.push(item);
    else if (at < endWeek) groups.thisWeek.push(item);
    else if (at < endMonth) groups.thisMonth.push(item);
    // beyond a month: intentionally hidden
  }

  const byTime = (a: UpcomingItem, b: UpcomingItem): number =>
    (a.at ?? 0) - (b.at ?? 0) || a.todo.createdAt - b.todo.createdAt;
  groups.today.sort(byTime);
  groups.thisWeek.sort(byTime);
  groups.thisMonth.sort(byTime);
  groups.anytime.sort((a, b) => b.todo.createdAt - a.todo.createdAt);

  return ORDER.map((id) => ({ id, items: groups[id] })).filter((h) => h.items.length > 0);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The quiet right-column label for a row: "14:00" today, "tue 14:00" this
 * week, "12 oct" this month; "overdue" when a day-only item is in the past,
 * nothing for a day-only item due today.
 */
export function whenLabel(item: UpcomingItem, horizon: HorizonId, now: number = Date.now()): string {
  if (item.at === null) return '';
  const d = new Date(item.at);
  if (horizon === 'today') {
    if (item.hasTime) return hhmm(d);
    // The section header already says "today" — only flag the overdue ones.
    return item.at < startOfDay(now) ? 'overdue' : '';
  }
  if (horizon === 'thisWeek') {
    const day = WEEKDAYS[d.getDay()];
    return item.hasTime ? `${day} ${hhmm(d)}` : day;
  }
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return item.hasTime ? `${date} ${hhmm(d)}` : date;
}
