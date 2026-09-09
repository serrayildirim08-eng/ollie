/**
 * ollie · cron Cloudflare Worker
 *
 * Three schedules now:
 *   - `0 3 * * *`  — daily intelligence layer (pattern / period / subscription
 *                    detection). Stubs today.
 *   - `every 5 min` — drain the brain-dump enrichment queue (KV → Anthropic
 *                    Haiku 4.5 → Supabase raw_dumps + enriched_signals). See
 *                    drain.ts. ALSO drains the notification delivery queue
 *                    (scheduled_jobs → APNs). See flush-notifications.ts.
 *
 * Privacy posture:
 *   The enrich-drain handler reads ONLY PII-scrubbed text from the queue.
 *   The notification drain reads prepared notification COPY (title/body) —
 *   never decrypts user source data. Decryption of user-data payloads (for
 *   the daily intelligence layer) happens inside the worker boundary;
 *   nothing is logged.
 *
 * NOTE: the daily handlers are skeleton stubs. Algorithms live in
 *       packages/logic/* on the client today. flushNotificationQueue is
 *       NOT a stub — it is the live server-side notification delivery path.
 */

import { Router, json, notFound } from '@ollie/worker-http';
import {
  drainEnrichQueue,
  handleEnrichQueueBatch,
  type DrainEnv,
  type QueuedDump,
} from './drain';
import { flushNotificationQueue, type FlushEnv } from './flush-notifications';

export interface Env extends DrainEnv, FlushEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  AI_PROXY: Fetcher;
  CACHE_KV: KVNamespace;

  // Service binding to the APNs Worker (configured in wrangler.toml).
  APNS_PUSH: Fetcher;

  // F2 — shared secret gating the manual HTTP trigger routes (/run,
  // /drain, /flush-notifications, /weekly-review, /body-correlations).
  // Without it anyone could force-trigger a drain and amplify cost.
  // Set via `wrangler secret put CRON_TRIGGER_SECRET`. Mirrors
  // apps/api's REGISTER_SHARED_SECRET pattern.
  CRON_TRIGGER_SECRET: string;
}

const DRAIN_SCHEDULE = '*/5 * * * *';
const DAILY_SCHEDULE = '0 3 * * *';
// Sunday 19:00 UTC — body weekly review server-side trigger.
// NOTE: cron trigger commented out in wrangler.toml pending Serra sign-off
// on server-cron path (deferred). Primary path is client-side scheduling
// via scheduleWeeklyReview() in packages/orchestrator/src/body-weekly.ts.
// Uncomment the wrangler.toml crons entry when server path is ready.
const WEEKLY_REVIEW_SCHEDULE = '0 19 * * 0';
// 03:00 UTC daily — body-correlation registry pass (cross-module).
// Same as DAILY_SCHEDULE so we don't add a new cron entry; the handler
// is a stub today and the primary path is client-side scheduling via
// `scheduleBodyCorrelationPass()` in packages/orchestrator/src/body-correlations.ts.
// When server-side per-user data access is wired, this stub becomes
// real and runs alongside pattern-detection on the existing trigger.
const BODY_CORRELATION_SCHEDULE = '0 3 * * *';

export default {
  /**
   * Cron entrypoint — runs on the schedules defined in wrangler.toml.
   * Branch on event.cron string so the 5-min tick doesn't trigger the
   * heavy daily passes.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === DRAIN_SCHEDULE) {
      // 5-min tick: drain BOTH queues. Brain-dump enrichment AND
      // notification delivery. They are independent — wrap each so one
      // failing doesn't starve the other.
      ctx.waitUntil(safe('enrich-drain', async () => {
        const stats = await drainEnrichQueue(env);
        console.log('[cron:enrich-drain]', JSON.stringify(stats));
      }));
      ctx.waitUntil(safe('notification-drain', async () => {
        const stats = await flushNotificationQueue(env);
        console.log('[cron:notification-drain]', JSON.stringify(stats));
      }));
      return;
    }

    // Default branch covers the daily 03:00 UTC tick. Wrap each task in
    // waitUntil so a slow upstream call doesn't starve the others, and a
    // failure in one task doesn't kill the run.
    if (event.cron === DAILY_SCHEDULE || !event.cron) {
      ctx.waitUntil(safe('pattern-detection',  () => runPatternDetection(env)));
      ctx.waitUntil(safe('period-prediction',  () => runPeriodPrediction(env)));
      ctx.waitUntil(safe('subscription-detect', () => runSubscriptionDetection(env)));
      // Body-correlation registry pass — same 03:00 UTC trigger. Stub
      // until per-user encrypted data access is wired. Primary path =
      // client-side scheduleBodyCorrelationPass().
      ctx.waitUntil(safe('body-correlations', () => runBodyCorrelations(env)));
    }

    // Sunday 19:00 UTC — body weekly review server-side trigger.
    // NOTE: server cron is deferred. Primary path = client-side scheduleWeeklyReview().
    // This branch is a stub ready for when server-side user data access is wired.
    if (event.cron === WEEKLY_REVIEW_SCHEDULE) {
      ctx.waitUntil(safe('body-weekly-review', () => runBodyWeeklyReview(env)));
    }
  },

  /**
   * Manual trigger (useful for ops + local dev):
   *
   *   curl -X POST https://<worker>/run          # daily stubs
   *   curl -X POST https://<worker>/drain        # drain queue once
   */
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return fetchRouter.fetch(req, env, ctx);
  },

  /**
   * Cloudflare Queues consumer (item #4). Invoked with a batch of
   * brain-dump enrichment messages when the [[queues.consumers]] binding
   * in wrangler.toml is configured. The Queue owns retry/backoff + DLQ, so
   * this replaces the every-5-min KV-prefix scan in drainEnrichQueue.
   *
   * This handler is a no-op cost until the queue is provisioned — see
   * DEPLOY_TODO.md §"Item #4". The 5-min `scheduled()` enrich-drain stays
   * wired as a belt-and-braces fallback; once the Queue is confirmed live
   * it can be removed.
   */
  async queue(batch: MessageBatch<QueuedDump>, env: Env): Promise<void> {
    await handleEnrichQueueBatch(batch, env);
  },
};

// ─── manual-trigger HTTP routing (itty-router) ─────────────────────────────────
// Replaces the hand-rolled `if (url.pathname …)` chain. All routes are POST;
// any other method or unknown path falls through to `notFound()` — identical
// to the previous `req.method !== 'POST'` guard.
//
// F2 SECURITY: every trigger route is gated by a shared-secret bearer
// header (`Authorization: Bearer <CRON_TRIGGER_SECRET>`). These routes
// force drains / heavy passes — unauthenticated they were a cost-
// amplification vector (anyone could spam /drain). The `requireSecret`
// guard runs first as an itty middleware: it returns a 401 Response
// (short-circuiting the route) when the secret is missing or wrong, and
// fails CLOSED when CRON_TRIGGER_SECRET itself is unset. Same pattern as
// apps/api/src/worker.ts · REGISTER_SHARED_SECRET.

const fetchRouter = Router<Request, [Env, ExecutionContext]>();

/**
 * itty middleware: when it returns a Response the route handler is
 * skipped. Returns 401 unless the request carries the exact
 * `Authorization: Bearer <CRON_TRIGGER_SECRET>` header. Fail-closed when
 * the secret is unconfigured.
 *
 * The full `(req, env, ctx)` signature is declared deliberately: itty
 * infers a route's handler arg-tuple from its FIRST handler, so a 2-arg
 * middleware would erase `ExecutionContext` from the route handlers that
 * follow it.
 */
function requireSecret(req: Request, env: Env, _ctx: ExecutionContext): Response | void {
  const auth = req.headers.get('authorization') ?? '';
  if (
    !env.CRON_TRIGGER_SECRET ||
    !auth.startsWith('Bearer ') ||
    auth.slice('Bearer '.length) !== env.CRON_TRIGGER_SECRET
  ) {
    return json({ error: 'unauthorized' }, 401);
  }
}

fetchRouter
  .post('/run', requireSecret, (_req, env, ctx) => {
    ctx.waitUntil(safe('manual-run', async () => {
      await runPatternDetection(env);
      await runPeriodPrediction(env);
      await runSubscriptionDetection(env);
    }));
    return json({ queued: true }, 202);
  })
  // Manual trigger for the notification delivery drain — runs it once
  // synchronously and returns the stats (useful for ops + local dev).
  .post('/flush-notifications', requireSecret, async (_req, env) => {
    const stats = await flushNotificationQueue(env);
    return json({ ok: true, ...stats });
  })
  // Manual trigger for body weekly review.
  .post('/weekly-review', requireSecret, (_req, env, ctx) => {
    ctx.waitUntil(safe('manual-weekly-review', () => runBodyWeeklyReview(env)));
    return json({ queued: true }, 202);
  })
  // Manual trigger for body-correlation registry pass.
  .post('/body-correlations', requireSecret, (_req, env, ctx) => {
    ctx.waitUntil(safe('manual-body-correlations', () => runBodyCorrelations(env)));
    return json({ queued: true }, 202);
  })
  .post('/drain', requireSecret, async (_req, env) => {
    const stats = await drainEnrichQueue(env);
    return json({ ok: true, ...stats });
  })
  .all('*', () => notFound());

// ─── tasks (stubs) ─────────────────────────────────────────────────────────────

/**
 * Scan opted-in encrypted payloads for ADHD pattern hits (e.g., repeat
 * morning-routine misses, doom-scroll windows). Writes detected patterns
 * back to a `patterns` table for the client to fetch.
 *
 * TODO(serra+backend-junior): port packages/logic/patterns/* server-side.
 *   - Decrypt payloads with user-key delegated via auth flow.
 *   - Run pattern coders.
 *   - Upsert into `patterns` table.
 */
async function runPatternDetection(_env: Env): Promise<void> {
  // intentionally empty until algorithms move server-side.
}

/**
 * For each user with cycle history, compute the next 5 predicted period
 * starts and persist into `cycle_predictions` so the client can render
 * without a network round-trip.
 *
 * TODO: reuse packages/logic/cycle predictNextPeriod once it's portable
 *       to the worker runtime (no DOM deps).
 */
async function runPeriodPrediction(_env: Env): Promise<void> {
  // intentionally empty until algorithms move server-side.
}

/**
 * Walk recent finance entries; cluster by amount + cadence to detect
 * recurring subscriptions the user might not have flagged. Surface as a
 * "did you forget about X?" digest.
 */
async function runSubscriptionDetection(_env: Env): Promise<void> {
  // intentionally empty until algorithms move server-side.
}

/**
 * Sunday 19:00 UTC — body weekly review server-side stub.
 *
 * Primary path today is CLIENT-SIDE: packages/orchestrator/src/body-weekly.ts
 * `scheduleWeeklyReview()` fires when the user is online on Sunday evening.
 * This server path is a follow-up once per-user encrypted data access is wired.
 *
 * TODO(backend-senior): decrypt per-user body/habits/sleep payload,
 *   call computeWeeklyReview(), fan out APNs push via APNS_PUSH service binding.
 */
async function runBodyWeeklyReview(_env: Env): Promise<void> {
  // intentionally empty: server-side cron deferred.
  // trigger in wrangler.toml is commented out — see note at top of file.
}

/**
 * 03:00 UTC — body-correlation registry pass (audit infra D follow-up).
 *
 * Primary path today is CLIENT-SIDE:
 *   packages/orchestrator/src/body-correlations.ts
 *   `scheduleBodyCorrelationPass()` fires daily at 03:00 LOCAL.
 *
 * This server path is a follow-up once per-user encrypted data access
 * is wired (same blocker as runBodyWeeklyReview). The schedule is
 * piggybacked on DAILY_SCHEDULE (0 3 * * *) — no new wrangler.toml
 * entry is needed. When the stub becomes real, it'll fan out via
 * APNS_PUSH service binding for any pattern:detected hits.
 *
 * TODO(backend-senior): decrypt per-user finance/sleep/habits/cycle/
 *   dump payloads, call runAllCorrelations(snapshot), fan out APNs push
 *   for each detected result whose copy passes the banned-phrase scanner.
 */
async function runBodyCorrelations(_env: Env): Promise<void> {
  // intentionally empty: server-side cron deferred.
  // Bound to DAILY_SCHEDULE inside scheduled(); no new cron entry.
  void BODY_CORRELATION_SCHEDULE;
}

// ─── helpers ───────────────────────────────────────────────────────────────────

async function safe(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[cron:${label}] failed`, err);
  }
}

// `notFound()` is the shared helper from @ollie/worker-http (imported above).
