/**
 * Sleep module · handler.
 *
 * Replaces the stub in modules/stubs.ts. Maps every sleep action the
 * router emits to a real repository call. Notes are kept short — the dump
 * UX is silent ("okay!" only); these notes feed dev logging + any future
 * surface that wants to show what happened.
 */

import type { ModuleHandler, HandlerResult, SleepAction } from '../../router/schema';
import { migrateSleep } from './migrate';
import { sleepRepo } from './repo';
import { parseHHMM } from './types';

export const sleepHandler: ModuleHandler<'sleep'> = {
  module: 'sleep',
  async apply(fragment): Promise<HandlerResult> {
    await migrateSleep();
    const p = fragment.payload as SleepAction;
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
          occurredAt,
        });
        const hrs = ev.kind === 'sleep' ? ev.data.hoursSlept : null;
        return {
          ok: true,
          note: hrs != null ? `logged ${hrs}h of sleep` : 'logged last night',
          deepLink: '/box/sleep',
        };
      }

      case 'wind_down_note': {
        await sleepRepo.addWindDown({ note: p.note });
        return {
          ok: true,
          note: 'saved a wind-down note',
          deepLink: '/box/sleep',
        };
      }

      case 'dream_log': {
        await sleepRepo.addDream({ text: p.text });
        return {
          ok: true,
          note: 'logged a dream',
          deepLink: '/box/sleep',
        };
      }

      case 'log_insomnia': {
        await sleepRepo.addInsomnia({
          durationAttemptedMin: p.duration_attempted_min ?? null,
          wokeCount: p.woke_count ?? null,
        });
        return {
          ok: true,
          note: 'logged a rough night',
          deepLink: '/box/sleep',
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
