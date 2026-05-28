/**
 * Goals module · handler.
 *
 * Maps every goals action the router emits to a real repository call.
 * Notes are kept short — the dump UX is silent; these notes are for dev
 * logging + any future surface that wants to show what happened.
 *
 * Auto-register rule: when an action carries a `goalName` that doesn't
 * match anything in the registry, we insert it. That keeps the user's
 * brain-dump frictionless ("crushed the duolingo streak" works even if
 * they never typed "duolingo" into a goal-create flow).
 */

import type { GoalsAction, ModuleHandler, HandlerResult } from '../../router/schema';
import { migrateGoals } from './migrate';
import { goals, events } from './repo';

export const goalsHandler: ModuleHandler<'goals'> = {
  module: 'goals',
  async apply(fragment): Promise<HandlerResult> {
    await migrateGoals();
    const p = fragment.payload as GoalsAction;
    switch (p.action) {
      case 'create_goal': {
        const goal = await goals.ensure(p.what, p.why ?? null);
        return {
          ok: true,
          note: `added goal "${goal.name}"`,
          deepLink: '/box/goals',
        };
      }

      case 'progress_note': {
        const goalId = await resolveGoalId(p.goalName);
        await events.add({ goalId, kind: 'progress', text: p.note });
        return {
          ok: true,
          note: goalId
            ? `logged progress on "${p.goalName}"`
            : 'logged a progress note',
          deepLink: '/box/goals',
        };
      }

      case 'milestone_hit': {
        const goalId = await resolveGoalId(p.goalName);
        await events.add({ goalId, kind: 'milestone', text: p.milestone });
        return {
          ok: true,
          note: goalId
            ? `milestone on "${p.goalName}": ${p.milestone}`
            : `milestone: ${p.milestone}`,
          deepLink: '/box/goals',
        };
      }

      case 'obstacle_note': {
        const goalId = await resolveGoalId(p.goalName);
        await events.add({ goalId, kind: 'obstacle', text: p.obstacle });
        return {
          ok: true,
          note: goalId
            ? `noted obstacle on "${p.goalName}"`
            : 'noted an obstacle',
          deepLink: '/box/goals',
        };
      }

      default:
        // Make new actions a build error rather than a silent skip.
        return exhaustive(p);
    }
  },
};

/**
 * When the router supplies a `goalName`, ensure-or-find the matching
 * registry row and return its id. When it's absent, return null so the
 * event lands in the unassigned bucket.
 */
async function resolveGoalId(goalName: string | undefined): Promise<string | null> {
  if (!goalName || !goalName.trim()) return null;
  const goal = await goals.ensure(goalName);
  return goal.id;
}

function exhaustive(p: never): never {
  throw new Error(`goals: unhandled action ${JSON.stringify(p)}`);
}
