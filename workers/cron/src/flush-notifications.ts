/**
 * ollie · cron worker · notification delivery drain
 *
 * The DRAIN side of server-side notifications. The WRITE side already
 * works: `scheduleServerJob()` in packages/notifications writes rows into
 * the Supabase `scheduled_jobs` table. This module consumes them.
 *
 * Each tick (every 5 minutes — see DRAIN cron in wrangler.toml):
 *
 *   1. SELECT scheduled_jobs WHERE status='pending' AND fire_at<=now()
 *      ordered oldest-first, LIMIT 100.
 *   2. For each job:
 *      a. Banned-phrase scan the payload copy (defense-in-depth — the
 *         LAST gate before a push leaves our infra). Fail → 'rejected'.
 *      b. Per-category mute check (client stamps `category_muted`).
 *         Muted → 'muted'.
 *      c. Daily-budget check — count today's 'sent' jobs for the user
 *         vs the client-stamped `daily_cap`. Over → 'budget_skipped'.
 *      d. Look up the user's device tokens (push_tokens table, joined on
 *         user_id). Multi-device → deliver to all.
 *      e. POST each token to the APNs worker via the APNS_PUSH service
 *         binding.
 *      f. Any token delivered → 'sent' + sent_at. All failed → bump
 *         attempts; >=3 → 'failed', else leave 'pending' for next tick.
 *
 * Idempotency: only `status='pending'` rows are scanned, and the moment a
 * job reaches a terminal status it can never be re-selected. A job that is
 * already 'sent' is never re-delivered.
 *
 * Privacy: the worker reads notification COPY (title/body) — already
 * prepared, lawyer-readable English — never decrypts user source data.
 * Budget cap + mute flag are stamped onto the row by the client (which
 * CAN read the encrypted budget); the worker only counts and compares.
 */

import { checkNotificationCopy } from './banned-phrases';

// ─── env ────────────────────────────────────────────────────────────────────

export interface FlushEnv {
  SUPABASE_URL: string;
  /** Service-role key — server-only, bypasses RLS. */
  SUPABASE_SERVICE_ROLE: string;
  /** Service binding to ollie-apns-push (in-cluster, no public hop). */
  APNS_PUSH: Fetcher;
  /**
   * Shared secret presented to the apns-push worker's /push endpoint.
   * MUST equal apns-push's APNS_INTERNAL_SECRET. Without it /push returns
   * 401 and no notification is delivered.
   */
  APNS_INTERNAL_SECRET: string;
}

// ─── shapes ─────────────────────────────────────────────────────────────────

/** A row from scheduled_jobs as the drain reads it. */
export interface ScheduledJobRow {
  id: string;
  user_id: string;
  fire_at: string;
  job_type: string;
  payload: Record<string, unknown> | null;
  status: string;
  attempts: number;
  dedupe_key: string | null;
  daily_cap: number | null;
  notification_category: string | null;
  category_muted: boolean | null;
}

/** A push_tokens row. */
interface PushTokenRow {
  device_token: string;
  platform: string;
}

export interface FlushStats {
  processed: number;
  sent: number;
  rejected: number;
  failed: number;
  retried: number;
  budget_skipped: number;
  muted: number;
  no_token: number;
}

// ─── tuning ─────────────────────────────────────────────────────────────────

const BATCH_CAP = 100;
const MAX_ATTEMPTS = 3;
const DEFAULT_DAILY_CAP = 4;

// ─── orchestrator ───────────────────────────────────────────────────────────

/**
 * Drain due notification jobs and deliver via APNs.
 *
 * Returns delivery stats. Never throws on a per-job failure — one bad job
 * never starves the rest of the batch.
 */
export async function flushNotificationQueue(env: FlushEnv): Promise<FlushStats> {
  const stats: FlushStats = {
    processed: 0,
    sent: 0,
    rejected: 0,
    failed: 0,
    retried: 0,
    budget_skipped: 0,
    muted: 0,
    no_token: 0,
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
    console.error('[flush] missing Supabase config — skipping run');
    return stats;
  }

  const due = await selectDueJobs(env);
  if (due.length === 0) return stats;

  // Per-user "sent today" counts, fetched once and incremented locally as
  // we deliver within this batch — so two due jobs for the same user in
  // one tick correctly count against the same cap.
  const sentTodayCache = new Map<string, number>();
  // Per-user token lists, cached so a user with several due jobs only
  // costs one push_tokens query.
  const tokenCache = new Map<string, PushTokenRow[]>();

  for (const job of due) {
    stats.processed++;
    try {
      await processJob(env, job, stats, sentTodayCache, tokenCache);
    } catch (err) {
      // Unexpected error — treat as a transient delivery failure so the
      // job retries rather than getting stuck 'pending' forever.
      console.error(`[flush] job ${job.id} threw:`, String(err));
      await applyRetry(env, job, stats, String(err).slice(0, 200));
    }
  }

  return stats;
}

// ─── per-job pipeline ───────────────────────────────────────────────────────

async function processJob(
  env: FlushEnv,
  job: ScheduledJobRow,
  stats: FlushStats,
  sentTodayCache: Map<string, number>,
  tokenCache: Map<string, PushTokenRow[]>,
): Promise<void> {
  const payload = job.payload ?? {};
  const title = typeof payload.title === 'string' ? payload.title : '';
  const body = typeof payload.body === 'string' ? payload.body : undefined;

  // A job with no title has no deliverable copy — terminal, not retryable.
  if (!title) {
    await updateJob(env, job.id, { status: 'failed', last_error: 'missing-title' });
    stats.failed++;
    return;
  }

  // ── (a) Banned-phrase gate — defense-in-depth, the LAST copy check ──────
  const copyCheck = checkNotificationCopy({ title, body });
  if (!copyCheck.clean) {
    const reason = `banned-phrase: ${copyCheck.hits.map((h) => h.id).join(',')}`;
    console.warn(`[flush] job ${job.id} REJECTED — ${reason}`);
    await updateJob(env, job.id, { status: 'rejected', last_error: reason.slice(0, 200) });
    stats.rejected++;
    return;
  }

  // ── (b) Per-category mute ───────────────────────────────────────────────
  if (job.category_muted === true) {
    await updateJob(env, job.id, { status: 'muted', last_error: 'category-muted' });
    stats.muted++;
    return;
  }

  // ── (c) Daily budget cap ────────────────────────────────────────────────
  const cap = clampCap(job.daily_cap);
  let sentToday = sentTodayCache.get(job.user_id);
  if (sentToday === undefined) {
    sentToday = await countSentToday(env, job.user_id);
    sentTodayCache.set(job.user_id, sentToday);
  }
  // Fail CLOSED (audit #13): if the count query failed we cannot prove
  // the user is under budget. Leave the job 'pending' (via applyRetry) so
  // it retries on the next 5-min tick when Supabase may be reachable —
  // rather than 'budget_skipped' (terminal) which would silently drop it.
  if (sentToday === COUNT_UNAVAILABLE) {
    await applyRetry(env, job, stats, 'count-unavailable');
    return;
  }
  if (sentToday >= cap) {
    await updateJob(env, job.id, {
      status: 'budget_skipped',
      last_error: `over-cap (${sentToday}/${cap})`,
    });
    stats.budget_skipped++;
    return;
  }

  // ── (d) Device token lookup — deliver to ALL of the user's devices ──────
  let tokens = tokenCache.get(job.user_id);
  if (tokens === undefined) {
    tokens = await tokensForUser(env, job.user_id);
    tokenCache.set(job.user_id, tokens);
  }
  if (tokens.length === 0) {
    // No registered device. Treat as a delivery failure so the retry
    // budget eventually flips it to 'failed' — but the client-side
    // fallback timer still covers the app-open case meanwhile.
    await applyRetry(env, job, stats, 'no-device-token');
    stats.no_token++;
    return;
  }

  // ── (e) Dispatch to APNs via the service binding ────────────────────────
  const apnsPayload = buildApnsPayload(job, title, body);
  const results = await Promise.all(
    tokens.map((t) => pushOne(env, t.device_token, job.user_id, apnsPayload)),
  );
  const anyOk = results.some((r) => r.ok);

  // ── (f) Terminal status ─────────────────────────────────────────────────
  if (anyOk) {
    await updateJob(env, job.id, {
      status: 'sent',
      sent_at: new Date().toISOString(),
      last_error: null,
    });
    stats.sent++;
    // Reflect the new delivery in the local budget cache for this batch.
    sentTodayCache.set(job.user_id, (sentTodayCache.get(job.user_id) ?? 0) + 1);
  } else {
    const reason = results.find((r) => !r.ok)?.reason ?? 'apns-failed';
    await applyRetry(env, job, stats, reason);
  }
}

/**
 * Increment attempts and either fail-out or leave pending for retry.
 * attempts >= MAX_ATTEMPTS → 'failed'; otherwise stay 'pending'.
 */
async function applyRetry(
  env: FlushEnv,
  job: ScheduledJobRow,
  stats: FlushStats,
  reason: string,
): Promise<void> {
  const nextAttempt = (job.attempts ?? 0) + 1;
  if (nextAttempt >= MAX_ATTEMPTS) {
    await updateJob(env, job.id, {
      status: 'failed',
      attempts: nextAttempt,
      last_error: reason.slice(0, 200),
    });
    stats.failed++;
  } else {
    await updateJob(env, job.id, {
      status: 'pending',
      attempts: nextAttempt,
      last_error: reason.slice(0, 200),
    });
    stats.retried++;
  }
}

// ─── APNs payload ───────────────────────────────────────────────────────────

/**
 * Build the body the apns-push worker expects on POST /push.
 * apns-push wraps `payload` straight into the APNs JSON, so we shape the
 * full `aps` + custom `ollie` block here.
 */
function buildApnsPayload(
  job: ScheduledJobRow,
  title: string,
  body: string | undefined,
): Record<string, unknown> {
  const p = job.payload ?? {};
  const actionUrl = typeof p.action_url === 'string' ? p.action_url : undefined;
  const extra = p.extra && typeof p.extra === 'object' && !Array.isArray(p.extra)
    ? (p.extra as Record<string, unknown>)
    : {};
  return {
    aps: {
      alert: { title, body: body ?? '' },
      'thread-id': job.notification_category ?? job.job_type,
      'mutable-content': 1,
    },
    ollie: {
      dedupe_key: job.dedupe_key ?? `job:${job.id}`,
      category: job.notification_category ?? null,
      job_type: job.job_type,
      action_url: actionUrl,
      ...extra,
    },
  };
}

interface PushResult {
  ok: boolean;
  status: number;
  reason?: string;
}

/** POST one device token to the apns-push worker via the service binding. */
async function pushOne(
  env: FlushEnv,
  deviceToken: string,
  userId: string,
  payload: Record<string, unknown>,
): Promise<PushResult> {
  try {
    const resp = await env.APNS_PUSH.fetch('https://apns-push.internal/push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Shared-secret bearer — apns-push /push rejects without it.
        authorization: `Bearer ${env.APNS_INTERNAL_SECRET}`,
      },
      body: JSON.stringify({ deviceToken, payload, userId }),
    });
    if (resp.ok) return { ok: true, status: resp.status };
    let reason = `apns-${resp.status}`;
    try {
      const j = (await resp.json()) as { reason?: string; error?: string };
      reason = j.reason ?? j.error ?? reason;
    } catch {
      /* keep status-derived reason */
    }
    return { ok: false, status: resp.status, reason };
  } catch (err) {
    return { ok: false, status: 0, reason: String(err).slice(0, 120) };
  }
}

// ─── Supabase REST ──────────────────────────────────────────────────────────

function supabaseHeaders(env: FlushEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
    'content-type': 'application/json',
  };
}

/** SELECT pending jobs whose fire_at has elapsed, oldest first, LIMIT 100. */
async function selectDueJobs(env: FlushEnv): Promise<ScheduledJobRow[]> {
  const nowIso = new Date().toISOString();
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const qs = new URLSearchParams({
    select:
      'id,user_id,fire_at,job_type,payload,status,attempts,dedupe_key,daily_cap,notification_category,category_muted',
    status: 'eq.pending',
    fire_at: `lte.${nowIso}`,
    order: 'fire_at.asc',
    limit: String(BATCH_CAP),
  });
  const url = `${base}/rest/v1/scheduled_jobs?${qs.toString()}`;
  const resp = await fetch(url, { headers: supabaseHeaders(env) });
  if (!resp.ok) {
    console.error('[flush] selectDueJobs failed', resp.status, await safeText(resp));
    return [];
  }
  return (await resp.json()) as ScheduledJobRow[];
}

/**
 * Sentinel returned by `countSentToday` when the count query fails.
 * `processJob` treats this as "fail closed": the job is left pending and
 * retried on the next tick rather than delivered against an unknown
 * budget. Number.MAX_SAFE_INTEGER guarantees `sentToday >= cap` for any
 * clamped cap, so the job never slips past the daily cap on an error.
 */
export const COUNT_UNAVAILABLE = Number.MAX_SAFE_INTEGER;

/**
 * Count this user's notifications already delivered today (UTC day).
 * The budget is a calendar-day cap; the worker uses UTC because it has no
 * access to the user's timezone (that lives in encrypted state). Close
 * enough for a soft cap — see the memo for the deferred-precision note.
 *
 * Returns COUNT_UNAVAILABLE on a query error so the caller fails CLOSED
 * (audit item #13). The previous `return 0` silently disabled the daily
 * cap for every user on a single transient Supabase error.
 */
async function countSentToday(env: FlushEnv, userId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const qs = new URLSearchParams({
    select: 'id',
    user_id: `eq.${userId}`,
    status: 'eq.sent',
    sent_at: `gte.${startOfDay.toISOString()}`,
  });
  const url = `${base}/rest/v1/scheduled_jobs?${qs.toString()}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { ...supabaseHeaders(env), prefer: 'count=exact' },
    });
  } catch (err) {
    // Network throw — fail closed.
    console.error('[flush] countSentToday threw', String(err));
    return COUNT_UNAVAILABLE;
  }
  if (!resp.ok) {
    // Fail CLOSED on a count error — we cannot prove the user is under
    // budget, so we skip + retry rather than risk blowing the daily cap
    // (or, on a sustained outage, every cap at once). Logged for ops.
    console.error('[flush] countSentToday failed', resp.status);
    return COUNT_UNAVAILABLE;
  }
  // PostgREST returns the exact count in the Content-Range header
  // ("0-24/25") when prefer=count=exact. Fall back to row length.
  const range = resp.headers.get('content-range');
  if (range) {
    const total = range.split('/')[1];
    const n = Number(total);
    if (Number.isFinite(n)) return n;
  }
  const rows = (await resp.json()) as unknown[];
  return Array.isArray(rows) ? rows.length : 0;
}

/** All device tokens registered to a user. Empty array if none. */
async function tokensForUser(env: FlushEnv, userId: string): Promise<PushTokenRow[]> {
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const qs = new URLSearchParams({
    select: 'device_token,platform',
    user_id: `eq.${userId}`,
  });
  const url = `${base}/rest/v1/push_tokens?${qs.toString()}`;
  const resp = await fetch(url, { headers: supabaseHeaders(env) });
  if (!resp.ok) {
    console.error('[flush] tokensForUser failed', resp.status);
    return [];
  }
  const rows = (await resp.json()) as PushTokenRow[];
  return Array.isArray(rows) ? rows.filter((r) => typeof r.device_token === 'string') : [];
}

/**
 * PATCH a job row. Only ever called on a job we selected as 'pending',
 * and PostgREST applies the update by id — so a job that some other
 * process already moved off 'pending' would just no-op-update, never
 * re-deliver.
 */
async function updateJob(
  env: FlushEnv,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  // Guard: only patch a row that is STILL pending. This makes the update
  // a no-op if another tick (or the legacy apps/api cron) already moved
  // the job to a terminal state — the idempotency backstop.
  const url = `${base}/rest/v1/scheduled_jobs?id=eq.${id}&status=eq.pending`;
  try {
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: { ...supabaseHeaders(env), prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      console.error('[flush] updateJob failed', id, resp.status, await safeText(resp));
    }
  } catch (err) {
    console.error('[flush] updateJob threw', id, String(err));
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function clampCap(raw: number | null): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_DAILY_CAP;
  return Math.min(10, Math.max(1, Math.round(raw)));
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 300);
  } catch {
    return '';
  }
}
