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
    switch (p.action) {
      case 'log_period_start': {
        await cycleRepo.logPeriodStart();
        return { ok: true, note: 'period start logged', deepLink: '/box/cycle' };
      }

      case 'log_period_end': {
        await cycleRepo.logPeriodEnd();
        return { ok: true, note: 'period end logged', deepLink: '/box/cycle' };
      }

      case 'log_symptom': {
        await cycleRepo.logSymptom(p.symptom);
        return { ok: true, note: `logged ${p.symptom}`, deepLink: '/box/cycle' };
      }

      case 'pill_logged': {
        await cycleRepo.logPill();
        return { ok: true, note: 'pill logged', deepLink: '/box/cycle' };
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
