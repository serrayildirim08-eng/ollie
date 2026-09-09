/**
 * Sleep module · handler.
 *
 * Replaces the stub in modules/stubs.ts. Maps every sleep action the
 * router emits to a real repository call. Notes are kept short — the dump
 * UX is silent ("okay!" only); these notes feed dev logging + any future
 * surface that wants to show what happened.
 *
 * Layer 2 re-routing:
 *   When Layer 1 returns `module: 'dump_only'` for a sleep fragment OR
 *   marks the fragment `needsConfirm: true` (confidence 0.60–0.80), we
 *   call `routeModule('sleep', text)` to let the sleep-specific AI model
 *   attempt a precise classification. If it returns at least one action
 *   we use the first; otherwise we fall through to the original Layer 1
 *   action. Mirrors body's `maybeUpgradeFragment` one-to-one.
 */

import type { ModuleHandler, HandlerResult, SleepAction, Fragment } from '../../router/schema';
import { migrateSleep } from './migrate';
import { sleepRepo } from './repo';
import { parseHHMM } from './types';
import { migrateMedication } from '../medication/migrate';
import { events as medEvents } from '../medication/repo';
import { routeModule } from '../../api/workers';
import { getSupabaseClient } from '../../api/supabase';

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
  // A CONFIDENT sleep route still needs Layer 2 for field extraction: Layer 1
  // only picks module+action (it deliberately leaves detailed fields to Layer
  // 2), so "i slept 6 hours" lands as a bare log_sleep with no hours and the
  // screen shows "logged". Detect that bare log and run Layer 2 to pull hours/
  // quality/bedtime/wake (sleep.config.ts: "Always emit hours when the user
  // states a duration"). Without this, hours never get captured. #sleep-hours
  const sp = fragment.payload as { action?: string; hours?: unknown; bedtime?: unknown; wake?: unknown };
  const isBareSleepLog =
    fragment.module === 'sleep' &&
    sp.action === 'log_sleep' &&
    sp.hours == null &&
    sp.bedtime == null &&
    sp.wake == null;

  const needsLayer2 =
    fragment.module === 'dump_only' || fragment.needsConfirm === true || isBareSleepLog;

  if (!needsLayer2) return fragment;

  const bearer = await getBearer();
  if (!bearer) {
    // No auth session — fall back silently.
    return fragment;
  }

  const res = await routeModule('sleep', fragment.text, { bearer });

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
  const validated = validateSleepAction(parsed);
  if (!validated) return fragment;

  return {
    ...fragment,
    module: 'sleep',
    payload: validated,
  };
}

/**
 * Required string fields per action — the discriminant payload fields the
 * handler reads unconditionally. Actions with no required field map to [].
 */
const SLEEP_REQUIRED_FIELDS: Record<SleepAction['action'], readonly string[]> = {
  log_sleep: [],
  wind_down_note: ['note'],
  dream_log: ['text'],
  log_insomnia: [],
};

/**
 * Narrows arbitrary parsed JSON to a SleepAction the handler can safely apply.
 * Returns null when the shape is unknown or a required field is missing/empty.
 */
function validateSleepAction(value: unknown): SleepAction | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;

  if (obj.module !== 'sleep') return null;
  if (typeof obj.action !== 'string') return null;
  if (!(obj.action in SLEEP_REQUIRED_FIELDS)) return null;

  const required = SLEEP_REQUIRED_FIELDS[obj.action as SleepAction['action']];
  for (const field of required) {
    const v = obj[field];
    if (typeof v !== 'string' || v.trim().length === 0) return null;
  }

  return obj as unknown as SleepAction;
}

export const sleepHandler: ModuleHandler<'sleep'> = {
  module: 'sleep',
  async apply(rawFragment): Promise<HandlerResult> {
    await migrateSleep();
    const fragment = await maybeUpgradeFragment(rawFragment);
    const p = fragment.payload as SleepAction;

    // Single undo factory — every sleep_events kind funnels through the same
    // remove(id) path, so the card gets a stable closure regardless of which
    // action variant fired.
    const undoFor = (id: string) => () => sleepRepo.remove(id);

    switch (p.action) {
      case 'log_sleep': {
        // Prefer the wake date for ordering — "logged at 9am about last
        // night" should sort under today, not yesterday. When `wake` is
        // missing fall back to now (which already does the right thing).
        const occurredAt = wakeDateMs(p.wake) ?? Date.now();
        const ev = await sleepRepo.addSleepLog({
          bedtime: p.bedtime ?? null,
          wake: p.wake ?? null,
          quality: p.quality ?? null,
          hours: p.hours ?? null,
          occurredAt,
        });
        const hrs = ev.kind === 'sleep' ? ev.data.hoursSlept : null;
        return {
          ok: true,
          note: hrs != null ? `logged ${hrs}h of sleep` : 'logged last night',
          deepLink: '/box/sleep',
          undo: undoFor(ev.id),
        };
      }

      case 'wind_down_note': {
        const row = await sleepRepo.addWindDown({ note: p.note });
        return {
          ok: true,
          note: 'saved a wind-down note',
          deepLink: '/box/sleep',
          undo: undoFor(row.id),
        };
      }

      case 'dream_log': {
        const row = await sleepRepo.addDream({ text: p.text });
        return {
          ok: true,
          note: 'logged a dream',
          deepLink: '/box/sleep',
          undo: undoFor(row.id),
        };
      }

      case 'log_insomnia': {
        const row = await sleepRepo.addInsomnia({
          durationAttemptedMin: p.duration_attempted_min ?? null,
          wokeCount: p.woke_count ?? null,
        });

        // Downstream multi-route: "couldn't sleep so took melatonin" — router
        // classifies as sleep.log_insomnia and sets `med_taken` (and optional
        // `med_dose`). Mirror to medication.log_dose so the med adherence
        // surface picks it up. Approach B (primary handler emits secondary),
        // matching grocery's price→finance pattern.
        const med = (p as { med_taken?: string | null }).med_taken;
        const dose = (p as { med_dose?: string | null }).med_dose;
        let medRowId: string | null = null;
        if (typeof med === 'string' && med.trim().length > 0) {
          try {
            await migrateMedication();
            const medRow = await medEvents.logDose({ medName: med, dose: dose ?? undefined });
            medRowId = medRow.id;
          } catch (err) {
            console.error('[sleep] medication mirror failed', err);
          }
        }

        return {
          ok: true,
          note: 'logged a rough night',
          deepLink: '/box/sleep',
          undo: async () => {
            await sleepRepo.remove(row.id);
            if (medRowId) {
              try { await medEvents.remove(medRowId); } catch { /* best-effort */ }
            }
          },
        };
      }

      default:
        // Make new actions a build error rather than a silent skip.
        return exhaustive(p);
    }
  },
};

function exhaustive(p: never): never {
  throw new Error(`sleep: unhandled action ${JSON.stringify(p)}`);
}

/**
 * Build a ms-since-epoch timestamp for "today at HH:MM" from a wake-time
 * string. Returns null when the input doesn't parse. Used as the
 * `occurred_at` for kind='sleep' so the screen groups under today's date.
 */
function wakeDateMs(wake: string | undefined): number | null {
  const mins = parseHHMM(wake ?? null);
  if (mins == null) return null;
  const now = new Date();
  now.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return now.getTime();
}
