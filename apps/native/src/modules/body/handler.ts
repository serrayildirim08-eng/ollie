/**
 * Body module · handler.
 *
 * Maps every BodyAction the router emits to a real repository call. The
 * dump UX is silent ("okay!" only); these notes are for dev logging + the
 * journal surface.
 *
 * Every action collapses to an append into `body_events` with a typed
 * `kind` + a small `data` payload. The screen does the grouping +
 * aggregation (e.g. "today's water" total) at read time.
 */

import type { BodyAction, ModuleHandler, HandlerResult } from '../../router/schema';
import { migrateBody } from './migrate';
import { events } from './repo';
import { DEFAULT_GLASS_ML, normaliseLabel } from './types';

export const bodyHandler: ModuleHandler<'body'> = {
  module: 'body',
  async apply(fragment): Promise<HandlerResult> {
    await migrateBody();
    const p = fragment.payload as BodyAction;
    switch (p.action) {
      case 'log_symptom': {
        const label = normaliseLabel(p.symptom);
        await events.add({
          kind: 'symptom',
          data: {
            label,
            severity: p.severity ?? null,
            bodyPart: p.bodyPart ?? null,
          },
        });
        const where = p.bodyPart ? ` (${p.bodyPart})` : '';
        return {
          ok: true,
          note: `logged symptom: ${label}${where}`,
          deepLink: '/box/body',
        };
      }

      case 'log_water': {
        const amountMl = p.amountMl ?? DEFAULT_GLASS_ML;
        await events.add({
          kind: 'water',
          data: { amountMl },
        });
        return {
          ok: true,
          note: `logged ${amountMl} mL of water`,
          deepLink: '/box/body',
        };
      }

      case 'log_supplement': {
        const label = normaliseLabel(p.name);
        await events.add({
          kind: 'supplement',
          data: { label, dose: p.dose ?? null },
        });
        return {
          ok: true,
          note: `logged supplement: ${label}`,
          deepLink: '/box/body',
        };
      }

      case 'log_episode': {
        const label = normaliseLabel(p.kind);
        await events.add({
          kind: 'episode',
          data: { label, duration: p.duration ?? null },
        });
        return {
          ok: true,
          note: `logged episode: ${label}`,
          deepLink: '/box/body',
        };
      }

      case 'log_posture': {
        await events.add({ kind: 'posture', data: {} });
        return { ok: true, note: 'logged posture check', deepLink: '/box/body' };
      }

      case 'log_hunger': {
        await events.add({ kind: 'hunger', data: {} });
        return { ok: true, note: 'logged hunger', deepLink: '/box/body' };
      }

      case 'log_movement': {
        const label = normaliseLabel(p.type);
        await events.add({
          kind: 'movement',
          data: { label, durationMin: p.duration_min ?? null },
        });
        const tail = p.duration_min ? ` (${p.duration_min} min)` : '';
        return {
          ok: true,
          note: `logged movement: ${label}${tail}`,
          deepLink: '/box/body',
        };
      }

      default:
        // Make new actions a build error rather than a silent skip.
        return exhaustive(p);
    }
  },
};

function exhaustive(p: never): never {
  throw new Error(`body: unhandled action ${JSON.stringify(p)}`);
}
