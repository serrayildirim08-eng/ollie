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
import { goals, events, GoalCapError } from './repo';

export const goalsHandler: ModuleHandler<'goals'> = {
  module: 'goals',
  async apply(fragment): Promise<HandlerResult> {
    await migrateGoals();
    const p = fragment.payload as GoalsAction;

    // Undo factory for goals_events rows. `create_goal` uses goals.remove
    // directly since the registry has its own DELETE path.
    const undoEvent = (id: string) => () => events.remove(id);

    switch (p.action) {
      case 'create_goal': {
        try {
          const goal = await goals.ensure(p.what, p.why ?? null);
          return {
            ok: true,
            note: `added goal "${goal.name}"`,
            deepLink: '/box/goals',
            undo: () => goals.remove(goal.id),
          };
        } catch (err) {
          // At the active-goal cap a dump must NOT silently create another
          // goal (it would skip the required why/obstacle/premortem capture).
          // Refuse and point the user at the goals box to make room (brief G2).
          if (err instanceof GoalCapError) {
            return {
              ok: false,
              note: 'already at your goal limit — finish or drop one first',
              deepLink: '/box/goals',
            };
          }
          throw err;
        }
      }

      case 'progress_note': {
        const goalId = await resolveGoalId(p.goalName);
        const ev = await events.add({ goalId, kind: 'progress', text: p.note });
        return {
          ok: true,
          note: goalId
            ? `logged progress on "${p.goalName}"`
            : 'logged a progress note',
          deepLink: '/box/goals',
          undo: undoEvent(ev.id),
        };
      }

      case 'milestone_hit': {
        const goalId = await resolveGoalId(p.goalName);
        const ev = await events.add({ goalId, kind: 'milestone', text: p.milestone });
        return {
          ok: true,
          note: goalId
            ? `milestone on "${p.goalName}": ${p.milestone}`
            : `milestone: ${p.milestone}`,
          deepLink: '/box/goals',
          undo: undoEvent(ev.id),
        };
      }

      case 'obstacle_note': {
        const goalId = await resolveGoalId(p.goalName);
        const ev = await events.add({ goalId, kind: 'obstacle', text: p.obstacle });
        return {
          ok: true,
          note: goalId
            ? `noted obstacle on "${p.goalName}"`
            : 'noted an obstacle',
          deepLink: '/box/goals',
          undo: undoEvent(ev.id),
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
  try {
    const goal = await goals.ensure(goalName);
    return goal.id;
  } catch (err) {
    // At the active-goal cap `ensure` refuses to auto-create. For a note
    // (progress / milestone / obstacle) that's fine — let it land in the
    // unassigned bucket rather than dropping it or breaching the cap.
    if (err instanceof GoalCapError) return null;
    throw err;
  }
}

function exhaustive(p: never): never {
  throw new Error(`goals: unhandled action ${JSON.stringify(p)}`);
}
