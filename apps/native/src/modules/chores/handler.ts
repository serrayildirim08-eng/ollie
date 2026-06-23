/**
 * Chores module · handler.
 *
 * Maps every chores action the router emits to a real repository call. Notes
 * are kept short — the dump UX is silent ("okay!" only); these notes feed dev
 * logging + any future surface that wants to show what happened. Mirrors the
 * grocery / admin handler shape.
 */

import type { ChoresAction, ModuleHandler, HandlerResult } from '../../router/schema';
import { migrateChores } from './migrate';
import { chores } from './repo';
import { normaliseChoreName, normaliseWeekdays, formatWeekdays } from './types';

/** Cadence fallback when "every week"-style language reaches us without a
 *  parsed day count (the Layer-1 classifier should fill `cadenceDays`, but we
 *  never want a recurring chore with no clock). One week is the most common
 *  household rhythm. */
const DEFAULT_CADENCE_DAYS = 7;

export const choresHandler: ModuleHandler<'chores'> = {
  module: 'chores',
  async apply(fragment): Promise<HandlerResult> {
    await migrateChores();
    const p = fragment.payload as ChoresAction;

    switch (p.action) {
      case 'chore_done': {
        const chore = await chores.markDone(p.chore);
        const note =
          chore.kind === 'recurring'
            ? `done: ${chore.name} — clock reset`
            : `done: ${chore.name}`;
        // No undo: markDone appends a completion event (cadence signal) and
        // either resets a recurring clock or marks a one-off done. Unwinding
        // that cleanly (delete the right log row + restore prior state) is more
        // surface area than the silent-dump UX warrants; re-state via a dump.
        return { ok: true, note, deepLink: '/box/chores' };
      }

      case 'add_chore': {
        const chore = await chores.upsert({ name: p.chore, kind: 'one_off' });
        return {
          ok: true,
          note: `added chore: ${chore.name}`,
          deepLink: '/box/chores',
          undo: () => chores.remove(chore.id),
        };
      }

      case 'add_recurring_chore': {
        // Weekday-anchored ("laundry on wednesdays") takes precedence: it recurs
        // by day-of-week and carries no interval cadence. Otherwise fall back to
        // an interval cadence (parsed days, or the weekly default).
        const weekdays = normaliseWeekdays(p.weekdays);
        const cadenceDays =
          weekdays != null
            ? null
            : typeof p.cadenceDays === 'number' &&
                Number.isFinite(p.cadenceDays) &&
                p.cadenceDays > 0
              ? Math.round(p.cadenceDays)
              : DEFAULT_CADENCE_DAYS;
        const chore = await chores.upsert({
          name: p.chore,
          kind: 'recurring',
          cadenceDays,
          weekdays,
        });
        const note =
          weekdays != null
            ? `recurring chore: ${normaliseChoreName(p.chore)} on ${formatWeekdays(weekdays)}`
            : `recurring chore: ${normaliseChoreName(p.chore)} every ${cadenceDays} days`;
        return {
          ok: true,
          note,
          deepLink: '/box/chores',
          undo: () => chores.remove(chore.id),
        };
      }

      default:
        // Make new actions a build error rather than a silent skip.
        return exhaustive(p);
    }
  },
};

function exhaustive(p: never): never {
  throw new Error(`chores: unhandled action ${JSON.stringify(p)}`);
}
