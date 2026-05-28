/**
 * Habits module · handler.
 *
 * Maps every HabitsAction the router emits to a real repository call.
 * Habits auto-register on first `complete` — there's no separate "create
 * habit" path. The streak-break and identity events are persisted as
 * append-only journal entries that the box surface renders.
 */

import type { HabitsAction, ModuleHandler, HandlerResult } from '../../router/schema';
import { migrateHabits } from './migrate';
import { registry, completions, events } from './repo';

export const habitsHandler: ModuleHandler<'habits'> = {
  module: 'habits',
  async apply(fragment): Promise<HandlerResult> {
    await migrateHabits();
    const p = fragment.payload as HabitsAction;
    switch (p.action) {
      case 'complete': {
        const habit = await registry.ensure(p.habitName);
        await completions.add(habit.id);
        return {
          ok: true,
          note: `marked ${habit.name} as done`,
          deepLink: '/box/habits',
        };
      }

      case 'streak_break_note': {
        await events.logStreakBreak({
          habitName: p.habitName,
          reason: p.reason,
        });
        return {
          ok: true,
          note: `noted a break in ${p.habitName}`,
          deepLink: '/box/habits',
        };
      }

      case 'identity_statement': {
        await events.logIdentity(p.text);
        return {
          ok: true,
          note: 'saved your identity note',
          deepLink: '/box/habits',
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
