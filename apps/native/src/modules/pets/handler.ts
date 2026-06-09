/**
 * Pets module · handler.
 *
 * Maps every pets action the router emits to a real repository call.
 * Notes are kept short — the dump UX is silent ("okay!" only); these
 * notes are for dev logging + any future surface that wants to show
 * what happened.
 *
 * The scurvy-critical case is `log_supplement` with supplement
 * `vitamin_c`: missing it for a guinea pig is dangerous. We don't gate
 * here (the dump should always succeed), but we surface a clearer note
 * so the JournalNoticed feed reads as confirmation rather than a shrug.
 */

import type { ModuleHandler, HandlerResult, PetsAction } from '../../router/schema';
import { migratePets } from './migrate';
import { events } from './repo';
import { petNameLabel, supplementLabel } from './types';

export const petsHandler: ModuleHandler<'pets'> = {
  module: 'pets',
  async apply(fragment): Promise<HandlerResult> {
    await migratePets();
    const p = fragment.payload as PetsAction;

    // Single undo factory — every pets_events kind funnels through the same
    // remove(id) path.
    const undoFor = (id: string) => () => events.remove(id);

    switch (p.action) {
      case 'log_care': {
        const ev = await events.logCare({ petName: p.petName, what: p.what });
        const who = p.petName ? petNameLabel(p.petName) : 'them';
        return {
          ok: true,
          note: `logged care for ${who}: ${p.what}`,
          deepLink: '/box/pets',
          undo: undoFor(ev.id),
        };
      }

      case 'log_observation': {
        const ev = await events.logObservation({ petName: p.petName, note: p.note });
        const who = p.petName ? petNameLabel(p.petName) : 'them';
        return {
          ok: true,
          note: `noted: ${who} · ${p.note}`,
          deepLink: '/box/pets',
          undo: undoFor(ev.id),
        };
      }

      case 'log_vet': {
        const ev = await events.logVet({ petName: p.petName, reason: p.reason });
        const who = p.petName ? petNameLabel(p.petName) : 'them';
        const tail = p.reason ? ` · ${p.reason}` : '';
        return {
          ok: true,
          note: `vet log for ${who}${tail}`,
          deepLink: '/box/pets',
          undo: undoFor(ev.id),
        };
      }

      case 'log_feed': {
        const ev = await events.logFeed({ petName: p.petName });
        const who = p.petName ? petNameLabel(p.petName) : 'them';
        return {
          ok: true,
          note: `fed ${who}`,
          deepLink: '/box/pets',
          undo: undoFor(ev.id),
        };
      }

      case 'log_supplement': {
        // `pet_id` is in the schema but unused for now — we key by name.
        const ev = await events.logSupplement({
          petName: p.petName,
          supplement: p.supplement,
          dose: p.dose,
        });
        const who = p.petName ? petNameLabel(p.petName) : 'them';
        const dose = p.dose ? ` (${p.dose})` : '';
        return {
          ok: true,
          note: `${supplementLabel(p.supplement)} logged for ${who}${dose}`,
          deepLink: '/box/pets',
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
  throw new Error(`pets: unhandled action ${JSON.stringify(p)}`);
}
