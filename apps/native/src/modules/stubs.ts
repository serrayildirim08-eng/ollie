/**
 * apps/native · modules/stubs.ts
 *
 * v0 handler stubs for all 13 router-output modules. Each handler accepts
 * a routed Fragment and returns a friendly `note` for the journal feed —
 * NO persistence yet. Persistence + cues + downstream multi-routing (e.g.
 * body.log_movement → habits.complete) land in a later sprint, one
 * module at a time.
 *
 * The single-file shape is intentional during the stub phase: 13 modules
 * × ~30 actions = compact, easily scanned. When real side-effects land
 * each module graduates to its own folder (modules/grocery/, etc.).
 *
 * Convention: notes are written in second-person, lowercase, no
 * trailing punctuation, matching the journal's editorial tone (see
 * JournalNoticed task #22). Examples:
 *   "added pasta to your shopping list"
 *   "logged tontin's vitamin C"
 *   "noted: 7 hours of sleep"
 */

import type { ModuleHandler, HandlerResult, Module } from '../router/schema';
import type { ActionPayload, DumpOnlyAction } from '../router/schema';
import { groceryHandler } from './grocery';
import { petsHandler } from './pets';
import { bodyHandler } from './body';
import { moodHandler } from './mood';
import { workHandler } from './work';
import { financeHandler } from './finance';
import { sleepHandler } from './sleep';
import { adminHandler } from './admin';
import { habitsHandler } from './habits';
import { goalsHandler } from './goals';
import { medicationHandler } from './medication';
import { cycleHandler } from './cycle';

// ─── helpers ──────────────────────────────────────────────────────────────

function ok(note: string, deepLink?: string, needsConfirm?: boolean): HandlerResult {
  return { ok: true, note, deepLink, needsConfirm };
}

// ─── grocery ──────────────────────────────────────────────────────────────
// Grocery graduated from a stub to a real persistence-backed handler. The
// implementation lives in modules/grocery/ — we re-export it through the
// registry below so dispatch.ts can stay registry-agnostic.

// ─── pets / finance / work ────────────────────────────────────────────────
// Graduated to real persistence-backed handlers — see modules/pets/,
// modules/finance/, modules/work/. Imported above; wired into the registry below.

// ─── admin ────────────────────────────────────────────────────────────────
// Graduated to a real persistence-backed handler — see modules/admin/.

// ─── sleep / body ─────────────────────────────────────────────────────────
// Graduated to real persistence-backed handlers — see modules/sleep/,
// modules/body/.

// ─── habits / goals / medication / cycle ──────────────────────────────────
// Graduated to real persistence-backed handlers — see modules/habits/,
// modules/goals/, modules/medication/, modules/cycle/.

// ─── crisis ───────────────────────────────────────────────────────────────
// Crisis fragments are short-circuited by the dispatcher (RouterOutput.crisis
// causes us to skip module handlers entirely). This handler exists for
// completeness — it should normally not be invoked, but if a fragment lands
// here we just acknowledge it and let the crisis surface take over.

const crisisHandler: ModuleHandler<'crisis'> = {
  module: 'crisis',
  async apply() {
    return ok(`crisis surface engaged`);
  },
};

// ─── dump_only ────────────────────────────────────────────────────────────

const dumpOnlyHandler: ModuleHandler<'dump_only'> = {
  module: 'dump_only',
  async apply(fragment) {
    const p = fragment.payload as DumpOnlyAction;
    const reason = p.reason ?? 'no_module_match';
    // Friendly note — this is the "I heard you, archived" reply.
    const text = fragment.text.length > 40 ? `${fragment.text.slice(0, 40)}…` : fragment.text;
    if (reason === 'low_confidence') {
      return ok(`saved as a note — wasn't sure where it belongs`);
    }
    return ok(`saved to your dump: "${text}"`);
  },
};

// ─── registry ─────────────────────────────────────────────────────────────

export const stubHandlers: Record<Module, ModuleHandler<Module>> = {
  grocery: groceryHandler as unknown as ModuleHandler<Module>,
  pets: petsHandler as unknown as ModuleHandler<Module>,
  finance: financeHandler as unknown as ModuleHandler<Module>,
  work: workHandler as unknown as ModuleHandler<Module>,
  admin: adminHandler as unknown as ModuleHandler<Module>,
  sleep: sleepHandler as unknown as ModuleHandler<Module>,
  body: bodyHandler as unknown as ModuleHandler<Module>,
  mood: moodHandler as unknown as ModuleHandler<Module>,
  habits: habitsHandler as unknown as ModuleHandler<Module>,
  goals: goalsHandler as unknown as ModuleHandler<Module>,
  medication: medicationHandler as unknown as ModuleHandler<Module>,
  cycle: cycleHandler as unknown as ModuleHandler<Module>,
  crisis: crisisHandler as unknown as ModuleHandler<Module>,
  dump_only: dumpOnlyHandler as unknown as ModuleHandler<Module>,
};

// Silence unused-import linter for ActionPayload — the type is exported
// indirectly via the per-module subtypes above. Keep the import explicit
// so the file remains a clean entry point for future action additions.
export type { ActionPayload };
