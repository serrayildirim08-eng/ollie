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
 *
 * Layer 2 re-routing:
 *   When Layer 1 returns `module: 'dump_only'` for a body fragment OR marks
 *   the fragment `needsConfirm: true` (confidence 0.60–0.80), we call
 *   `routeModule('body', text)` to let the body-specific AI model attempt a
 *   precise classification. If it returns at least one action we use the
 *   first; otherwise we fall through to the original Layer 1 action.
 */

import type { BodyAction, ModuleHandler, HandlerResult, Fragment } from '../../router/schema';
import { migrateBody } from './migrate';
import { events } from './repo';
import { DEFAULT_GLASS_ML, normaliseLabel } from './types';
import { routeModule } from '../../api/workers';
import { getSupabaseClient } from '../../api/supabase';
import { migratePets } from '../pets/migrate';
import { events as petsEvents } from '../pets/repo';

// ─── bearer helper ────────────────────────────────────────────────────────────

async function getBearer(): Promise<string | null> {
  try {
    const { data } = await getSupabaseClient().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

// ─── Layer 2 re-routing ───────────────────────────────────────────────────────

/**
 * Returns an upgraded fragment if Layer 2 returns at least one action.
 * Returns the original fragment unchanged on any failure path.
 */
async function maybeUpgradeFragment(fragment: Fragment): Promise<Fragment> {
  const needsLayer2 =
    fragment.module === 'dump_only' || fragment.needsConfirm === true;

  if (!needsLayer2) return fragment;

  const bearer = await getBearer();
  if (!bearer) {
    // No auth session — fall back silently.
    return fragment;
  }

  const res = await routeModule('body', fragment.text, { bearer });

  if (!res.ok || res.data.actions.length === 0) {
    // Network / parse / empty — preserve original.
    return fragment;
  }

  const first = res.data.actions[0];
  let parsed: unknown;
  try {
    parsed = JSON.parse(first.data);
  } catch {
    // data isn't valid JSON — can't upgrade, fall back.
    return fragment;
  }

  // Validate the AI payload against known actions + required fields BEFORE
  // adopting it. An invalid action would otherwise hit exhaustive() (which
  // throws, breaking the fallback path) or write an undefined row. On any
  // validation failure we preserve the original Layer 1 fragment.
  const validated = validateBodyAction(parsed);
  if (!validated) return fragment;

  return {
    ...fragment,
    module: 'body',
    payload: validated,
  };
}

/**
 * Required string fields per action — the discriminant payload fields the
 * handler reads unconditionally. Actions with no required field map to [].
 */
const BODY_REQUIRED_FIELDS: Record<BodyAction['action'], readonly string[]> = {
  log_symptom: ['symptom'],
  log_water: [],
  log_supplement: ['name'],
  log_episode: ['kind'],
  log_posture: [],
  log_hunger: [],
  log_movement: ['type'],
};

/**
 * Narrows arbitrary parsed JSON to a BodyAction the handler can safely apply.
 * Returns null when the shape is unknown or a required field is missing/empty.
 */
function validateBodyAction(value: unknown): BodyAction | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;

  if (obj.module !== 'body') return null;
  if (typeof obj.action !== 'string') return null;
  if (!(obj.action in BODY_REQUIRED_FIELDS)) return null;

  const required = BODY_REQUIRED_FIELDS[obj.action as BodyAction['action']];
  for (const field of required) {
    const v = obj[field];
    if (typeof v !== 'string' || v.trim().length === 0) return null;
  }

  return obj as unknown as BodyAction;
}

// ─── handler ──────────────────────────────────────────────────────────────────

export const bodyHandler: ModuleHandler<'body'> = {
  module: 'body',
  async apply(rawFragment): Promise<HandlerResult> {
    await migrateBody();

    const fragment = await maybeUpgradeFragment(rawFragment);
    const p = fragment.payload as BodyAction;

    // Single undo factory — every persisted action runs through the same
    // remove(id) path, so we hand the card a stable closure regardless of
    // which action variant fired.
    const undoFor = (id: string) => () => events.remove(id);

    switch (p.action) {
      case 'log_symptom': {
        const label = normaliseLabel(p.symptom);
        const row = await events.add({
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
          undo: undoFor(row.id),
        };
      }

      case 'log_water': {
        const amountMl = p.amountMl ?? DEFAULT_GLASS_ML;
        const row = await events.add({
          kind: 'water',
          data: { amountMl },
        });
        return {
          ok: true,
          note: `logged ${amountMl} mL of water`,
          deepLink: '/box/body',
          undo: undoFor(row.id),
        };
      }

      case 'log_supplement': {
        const label = normaliseLabel(p.name);
        const row = await events.add({
          kind: 'supplement',
          data: { label, dose: p.dose ?? null },
        });
        return {
          ok: true,
          note: `logged supplement: ${label}`,
          deepLink: '/box/body',
          undo: undoFor(row.id),
        };
      }

      case 'log_episode': {
        const label = normaliseLabel(p.kind);
        const row = await events.add({
          kind: 'episode',
          data: { label, duration: p.duration ?? null },
        });
        return {
          ok: true,
          note: `logged episode: ${label}`,
          deepLink: '/box/body',
          undo: undoFor(row.id),
        };
      }

      case 'log_posture': {
        const row = await events.add({ kind: 'posture', data: {} });
        return {
          ok: true,
          note: 'logged posture check',
          deepLink: '/box/body',
          undo: undoFor(row.id),
        };
      }

      case 'log_hunger': {
        const row = await events.add({ kind: 'hunger', data: {} });
        return {
          ok: true,
          note: 'logged hunger',
          deepLink: '/box/body',
          undo: undoFor(row.id),
        };
      }

      case 'log_movement': {
        const label = normaliseLabel(p.type);
        const row = await events.add({
          kind: 'movement',
          data: { label, durationMin: p.duration_min ?? null },
        });

        // Downstream multi-route: "walked the dog" / "tontin'i gezdirdim" —
        // the router classifies as body.log_movement and sets `pet` to the
        // proper noun. Mirror to pets.log_care so both boxes update. Per
        // Approach B (primary handler emits secondary), matching grocery's
        // price→finance pattern. Primary write already succeeded above; this
        // mirror is best-effort.
        const pet = (p as { pet?: string | null }).pet;
        if (typeof pet === 'string' && pet.trim().length > 0) {
          try {
            await migratePets();
            await petsEvents.logCare({ petName: pet, what: label });
          } catch (err) {
            console.error('[body] pets mirror failed', err);
          }
        }

        const tail = p.duration_min ? ` (${p.duration_min} min)` : '';
        return {
          ok: true,
          note: `logged movement: ${label}${tail}`,
          deepLink: '/box/body',
          undo: undoFor(row.id),
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
