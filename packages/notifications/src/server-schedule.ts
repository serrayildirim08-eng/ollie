/**
 * @ollie/notifications · server-side schedule helper (E4)
 *
 * When the user is signed in AND sync is enabled, we promote any
 * `schedule_at` notification from a client-side timer to a server-side
 * Supabase `scheduled_jobs` row. The Cloudflare Worker cron consumes
 * the row, JWT-signs an APNs request, and the push fires even with
 * the app fully closed.
 *
 * Falls back gracefully (no-op) when:
 *   - sync disabled
 *   - user not signed in
 *   - api not configured
 *
 * Pure orchestrator-level wiring — UI never imports this. The
 * dispatcher in `index.ts` calls scheduleServerJob() alongside its
 * own in-process timer; whichever fires first wins via the dedupe_key.
 */

import type { OllieAPI } from '@ollie/api';
import type { NotificationBudget, NotificationSpec } from './types';
import { DEFAULT_BUDGET, isMuted } from './budget';

export interface ServerScheduleDeps {
  api: OllieAPI;
  authJwt: string;
  userId: string;
  /**
   * The user's notification budget, read from encrypted client state.
   * Stamped onto the job row so the cron worker — which CANNOT decrypt
   * the budget itself — can still enforce the daily cap + per-category
   * mute when it delivers. Optional: omitted → worker uses defaults.
   */
  budget?: NotificationBudget;
}

export async function scheduleServerJob(
  deps: ServerScheduleDeps,
  spec: NotificationSpec,
  fireAt: number,
): Promise<{ ok: boolean; jobId?: string; reason?: string }> {
  if (!deps.api || !deps.authJwt || !deps.userId) {
    return { ok: false, reason: 'not-authenticated' };
  }
  const jobType =
    spec.category === 'PATTERN_ALERT' ? 'monthly_digest' :
    spec.category === 'CONTENT_DELIVERY' ? 'daily_reading' :
    spec.extra && (spec.extra as { feature?: string }).feature === 'med-nudge' ? 'med_nudge' :
    'reminder_fire';

  // Worker-readable budget snapshot. The worker cannot decrypt the user's
  // budget, so we stamp the daily cap + this category's mute state onto
  // the row. The cron drain reads these to enforce cap + mute server-side.
  const budget = deps.budget ?? DEFAULT_BUDGET;

  const row = {
    user_id: deps.userId,
    fire_at: new Date(fireAt).toISOString(),
    job_type: jobType,
    payload: {
      title: spec.title,
      body: spec.body,
      action_url: spec.action_url,
      extra: spec.extra,
    },
    dedupe_key: spec.dedupe_key,
    daily_cap: budget.daily_cap,
    notification_category: spec.category,
    category_muted: isMuted(budget, spec.category),
  };

  const r = await deps.api.supabase.rest.upsert<Array<{ id: string }>>(
    'scheduled_jobs',
    [row],
    { authJwt: deps.authJwt },
  );
  if (!r.ok) return { ok: false, reason: r.error.code };
  return { ok: true, jobId: r.data?.[0]?.id };
}

export async function cancelServerJob(
  deps: ServerScheduleDeps,
  dedupeKey: string,
): Promise<void> {
  if (!deps.api || !deps.authJwt) return;
  try {
    await deps.api.supabase.rest.delete('scheduled_jobs', {
      authJwt: deps.authJwt,
      params: { dedupe_key: `eq.${dedupeKey}`, status: 'eq.pending' },
    });
  } catch { /* non-fatal */ }
}
