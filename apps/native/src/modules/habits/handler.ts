/**
 * Habits module · handler.
 *
 * Maps every HabitsAction the router emits to a real repository call.
 * Habits auto-register on first `complete` — there's no separate "create
 * habit" path. Identity events are persisted as append-only journal entries
 * that the box surface renders. (No streak actions — see no-streaks mandate.)
 */

import type { HabitsAction, ModuleHandler, HandlerResult } from '../../router/schema';
import { migrateHabits } from './migrate';
import { registry, completions, events } from './repo';

export const habitsHandler: ModuleHandler<'habits'> = {
  module: 'habits',
  async apply(fragment): Promise<HandlerResult> {
    await migrateHabits();
    const p = fragment.payload as HabitsAction;

    // Undo factory for identity rows (habits_events). Completions live in
    // their own table and undo through completions.remove.
    const undoEvent = (id: string) => () => events.remove(id);

    switch (p.action) {
      case 'complete': {
        const habit = await registry.ensure(p.habitName);
        const comp = await completions.add(habit.id);
        // Undo removes the completion row only — registry rows persist by
        // design (the habit was always going to auto-register on first sight;
        // undoing this completion shouldn't retroactively un-register it).
        return {
          ok: true,
          note: `marked ${habit.name} as done`,
          deepLink: '/box/habits',
          undo: () => completions.remove(comp.id),
        };
      }

      case 'identity_statement': {
        const ev = await events.logIdentity(p.text);
        return {
          ok: true,
          note: 'saved your identity note',
          deepLink: '/box/habits',
          undo: undoEvent(ev.id),
        };
      }

      default:
        // Exhaustiveness — adding a new HabitsAction is a build error here
        // until this switch is updated.
        return exhaustive(p);
    }
  },
};

function exhaustive(p: never): never {
  throw new Error(`habits: unhandled action ${JSON.stringify(p)}`);
}
