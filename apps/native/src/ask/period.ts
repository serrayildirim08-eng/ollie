/**
 * ask/period — named periods as [from, to) in the phone's local time, epoch ms.
 * Weeks start on Monday (the Netherlands and most of Europe).
 */
import type { NamedPeriod } from './query';

export interface Range {
  readonly from: number;
  readonly to: number;
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const sinceMonday = (day.getDay() + 6) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - sinceMonday);
}

const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function resolvePeriod(period: NamedPeriod, now: number): Range {
  const today = startOfDay(new Date(now));
  switch (period) {
    case 'today':
      return { from: today.getTime(), to: addDays(today, 1).getTime() };
    case 'this_week': {
      const monday = startOfWeek(today);
      return { from: monday.getTime(), to: addDays(monday, 7).getTime() };
    }
    case 'last_week': {
      const monday = startOfWeek(today);
      return { from: addDays(monday, -7).getTime(), to: monday.getTime() };
    }
    case 'this_month':
      return {
        from: new Date(today.getFullYear(), today.getMonth(), 1).getTime(),
        to: new Date(today.getFullYear(), today.getMonth() + 1, 1).getTime(),
      };
    case 'last_month':
      return {
        from: new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime(),
        to: new Date(today.getFullYear(), today.getMonth(), 1).getTime(),
      };
  }
}

/** Local calendar day as YYYY-MM-DD, the format due dates are stored in. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
