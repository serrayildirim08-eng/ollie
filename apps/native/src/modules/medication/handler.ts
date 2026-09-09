/**
 * Medication module · handler.
 *
 * Maps every medication action the router emits to a real repository call.
 * Two surfaces share one handler:
 *   - SCHEDULE (the "today" tab): log_dose / missed_dose / side_effect_note.
 *   - CABINET  (the "cabinet" tab): add_to_cabinet / set_low / set_have /
 *     mark_taken.
 *
 * Cross-surface link: logging a dose (log_dose / mark_taken) also auto-counts
 * DOWN the cabinet qty for that med (deterministic count-down — brain/body
 * split: the LLM only said "I took it", the decrement is harness logic).
 *
 * The registry + cabinet both auto-populate: any action references a `medName`
 * and we ensure the row exists before writing. Handlers are idempotent — the
 * cabinet upserts dedupe by normalised name, so the same "started X" dump twice
 * leaves one row.
 *
 * Notes are kept short — the dump UX is silent ("okay!" only); these notes are
 * for dev logging + any future surface that wants to show what happened.
 */

import type {
  HandlerResult,
  MedicationAction,
  ModuleHandler,
} from '../../router/schema';
import { migrateMedication } from './migrate';
import { cabinet, events, medications } from './repo';
import { coercePurpose, type MedPurpose } from './purposeMap';
import { parseSchedule } from './types';

export const medicationHandler: ModuleHandler<'medication'> = {
  module: 'medication',
  async apply(fragment): Promise<HandlerResult> {
    await migrateMedication();
    const p = fragment.payload as MedicationAction;

    // Single undo factory — every medications_events row removes by id.
    // Registry + cabinet rows aren't touched on undo (the med stays stocked).
    const undoFor = (id: string) => () => events.remove(id);

    // Validate-inputs guardrail: never create a registry/cabinet row keyed on a
    // blank name (a malformed router payload would otherwise upsert a junk row).
    if ('medName' in p && (typeof p.medName !== 'string' || !p.medName.trim())) {
      return { ok: false, note: 'medication needs a name' };
    }

    switch (p.action) {
      case 'log_dose': {
        const ev = await events.logDose({ medName: p.medName, dose: p.dose });
        // Auto count-down the cabinet (no-op when not stocked / no qty).
        await cabinet.decrementOnTaken(p.medName);
        return {
          ok: true,
          note: `logged ${p.medName}${p.dose ? ` (${p.dose})` : ''}`,
          deepLink: '/box/medication',
          undo: undoFor(ev.id),
        };
      }

      case 'mark_taken': {
        // The cabinet's own "tick = taken": logs a dose AND counts down stock.
        // Same downstream effect as log_dose; a distinct action keeps the dump
        // routing honest ("took my magnesium" reads as a cabinet tick).
        const ev = await events.logDose({ medName: p.medName, dose: p.dose });
        await cabinet.decrementOnTaken(p.medName);
        return {
          ok: true,
          note: `took ${p.medName}`,
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

      case 'add_to_cabinet': {
        // "started magnesium 400mg at night for sleep" → stock it (+ purpose,
        // dose, qty) and, when a time was parsed, add the schedule slot so it
        // appears on the today tab. Idempotent upsert dedupes by name.
        const purpose: MedPurpose | null = p.purpose ? coercePurpose(p.purpose) : null;
        const item = await cabinet.upsert({
          name: p.medName,
          purpose,
          doseLabel: p.doseLabel,
          qty: p.qty,
        });
        const slots = parseSchedule(p.schedule ?? []);
        if (slots.length > 0) {
          await medications.addScheduleSlots(p.medName, slots);
        }
        return {
          ok: true,
          note:
            `added ${item.name} to cabinet (${item.purpose})` +
            (slots.length > 0 ? ` · scheduled ${slots.join(', ')}` : ''),
          deepLink: '/box/medication',
          // Undo removes the freshly-added cabinet row. Schedule slots are left
          // (re-state via a dump) — they may pre-exist from the registry.
          undo: () => cabinet.remove(item.id),
        };
      }

      case 'set_low': {
        await cabinet.setLowByName(p.medName, true);
        return {
          ok: true,
          note: `flagged ${p.medName} running low`,
          deepLink: '/box/medication',
        };
      }

      case 'set_have': {
        await cabinet.setLowByName(p.medName, false);
        return {
          ok: true,
          note: `cleared low flag for ${p.medName}`,
          deepLink: '/box/medication',
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
