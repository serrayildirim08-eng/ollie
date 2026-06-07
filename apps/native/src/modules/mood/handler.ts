/**
 * Mood module · handler.
 *
 * Maps every MoodAction the router emits to a real repository call. The
 * dump UX is silent ("okay!" only); these notes are for dev logging + the
 * journal surface.
 *
 * Every action collapses to an append into `mood_events` with a typed
 * `kind` + a small `data` payload. The screen does the grouping at read
 * time.
 *
 * Unlike body, mood does NOT run the Layer-2 routeModule upgrade — mood is
 * a low-stakes, high-frequency log, so we persist the Layer-1 action
 * directly with no extra model round-trip.
 */

import type { ModuleHandler, HandlerResult } from '../../router/schema';
import { migrateMood } from './migrate';
import { events } from './repo';
import type { MoodAction } from './types';

// ─── handler ──────────────────────────────────────────────────────────────────

export const moodHandler: ModuleHandler<'mood'> = {
  module: 'mood',
  async apply(fragment): Promise<HandlerResult> {
    await migrateMood();

    // `mood` is not yet in the schema's ActionPayload union (Serra wires the
    // schema entry herself), so we narrow through `unknown`. Once MoodAction
    // joins ActionPayload this stays correct.
    const p = fragment.payload as unknown as MoodAction;

    // Single undo factory — every persisted action runs through the same
    // remove(id) path, so we hand the card a stable closure regardless of
    // which action variant fired.
    const undoFor = (id: string) => () => events.remove(id);

    switch (p.action) {
      case 'log_mood': {
        const row = await events.add({
          kind: 'mood',
          data: {
            label: p.label,
            valence: p.valence ?? null,
            intensity: p.intensity ?? null,
          },
        });
        return {
          ok: true,
          note: `mood logged: ${p.label}`,
          deepLink: '/box/mood',
          undo: undoFor(row.id),
        };
      }

      case 'log_energy': {
        const row = await events.add({
          kind: 'energy',
          data: { level: p.level, label: p.label ?? null },
        });
        return {
          ok: true,
          note: `energy: ${p.level}`,
          deepLink: '/box/mood',
          undo: undoFor(row.id),
        };
      }

      case 'self_talk': {
        const row = await events.add({
          kind: 'self_talk',
          data: { statement: p.statement, valence: p.valence ?? null },
        });
        return {
          ok: true,
          note: 'noted',
          deepLink: '/box/mood',
          undo: undoFor(row.id),
        };
      }

      default:
        // Unknown / future action — soft-fail rather than throw so a router
        // ahead of this build can't crash the dump pipeline.
        return { ok: false, note: 'unknown mood action' };
    }
  },
};
