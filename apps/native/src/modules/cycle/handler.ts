/**
 * Cycle module · handler.
 *
 * Maps every cycle action the router emits to a real repository call.
 * Notes are deliberately neutral — sensitive surface, no warnings, no
 * medical framing, just a quiet ack of what was logged.
 */

import type { CycleAction, ModuleHandler, HandlerResult } from '../../router/schema';
import { migrateCycle } from './migrate';
import { cycleRepo } from './repo';

export const cycleHandler: ModuleHandler<'cycle'> = {
  module: 'cycle',
  async apply(fragment): Promise<HandlerResult> {
    await migrateCycle();
    const p = fragment.payload as CycleAction;

    // Single undo factory — every cycle_events kind funnels through the same
    // remove(id) path.
    const undoFor = (id: string) => () => cycleRepo.remove(id);

    switch (p.action) {
      case 'log_period_start': {
        const ev = await cycleRepo.logPeriodStart();
        return { ok: true, note: 'period start logged', deepLink: '/box/cycle', undo: undoFor(ev.id) };
      }

      case 'log_period_end': {
        const ev = await cycleRepo.logPeriodEnd();
        return { ok: true, note: 'period end logged', deepLink: '/box/cycle', undo: undoFor(ev.id) };
      }

      case 'log_symptom': {
        const ev = await cycleRepo.logSymptom(p.symptom);
        return { ok: true, note: `logged ${p.symptom}`, deepLink: '/box/cycle', undo: undoFor(ev.id) };
      }

      case 'pill_logged': {
        const ev = await cycleRepo.logPill();
        return { ok: true, note: 'pill logged', deepLink: '/box/cycle', undo: undoFor(ev.id) };
      }

      case 'set_pregnant': {
        // Pause the cycle. Neutral, quiet ack — no congratulations assumed.
        const ev = await cycleRepo.setPregnant();
        return { ok: true, note: 'cycle paused', deepLink: '/box/cycle', undo: undoFor(ev.id) };
      }

      case 'end_pregnancy': {
        // Resume. Stays neutral for ANY end (birth / miscarriage / termination).
        const ev = await cycleRepo.endPregnancy();
        return { ok: true, note: 'cycle resumed', deepLink: '/box/cycle', undo: undoFor(ev.id) };
      }

      default:
        // Make new actions a build error rather than a silent skip.
        return exhaustive(p);
    }
  },
};

function exhaustive(p: never): never {
  throw new Error(`cycle: unhandled action ${JSON.stringify(p)}`);
}
