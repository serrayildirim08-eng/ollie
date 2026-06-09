/**
 * Medication module · handler.
 *
 * Maps every medication action the router emits to a real repository call.
 * The registry auto-populates: any action references a `medName` and we
 * ensure it exists before logging the event.
 *
 * Notes are kept short — the dump UX is silent ("okay!" only); these notes
 * are for dev logging + any future surface that wants to show what happened.
 */

import type {
  HandlerResult,
  MedicationAction,
  ModuleHandler,
} from '../../router/schema';
import { migrateMedication } from './migrate';
import { events } from './repo';

export const medicationHandler: ModuleHandler<'medication'> = {
  module: 'medication',
  async apply(fragment): Promise<HandlerResult> {
    await migrateMedication();
    const p = fragment.payload as MedicationAction;

    // Single undo factory — every medications_events row removes by id.
    // Registry rows aren't touched on undo (the med stays registered).
    const undoFor = (id: string) => () => events.remove(id);

    switch (p.action) {
      case 'log_dose': {
        const ev = await events.logDose({ medName: p.medName, dose: p.dose });
        return {
          ok: true,
          note: `logged ${p.medName}${p.dose ? ` (${p.dose})` : ''}`,
          deepLink: '/box/medication',
          undo: undoFor(ev.id),
        };
      }

      case 'missed_dose': {
        const ev = await events.logMissed({ medName: p.medName });
        return {
          ok: true,
          note: `noted missed ${p.medName}`,
          deepLink: '/box/medication',
          undo: undoFor(ev.id),
        };
      }

      case 'side_effect_note': {
        const ev = await events.logSideEffect({ medName: p.medName, note: p.note });
        return {
          ok: true,
          note: `noted side effect for ${p.medName}`,
          deepLink: '/box/medication',
          undo: undoFor(ev.id),
        };
      }

      default:
        // Make new actions a build error rather than a silent skip.
        return exhaustive(p);
    }
  },
};

function exhaustive(p: never): never {
  throw new Error(`medication: unhandled action ${JSON.stringify(p)}`);
}
