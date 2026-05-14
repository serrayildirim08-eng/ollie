/**
 * ollie · cron Cloudflare Worker
 *
 * Two schedules now:
 *   - `0 3 * * *`  — daily intelligence layer (pattern / period / subscription
 *                    detection + APNs notification fan-out). Stubs today.
 *   - `*​/5 * * * *` — drain the brain-dump enrichment queue (KV → Anthropic
 *                    Haiku 4.5 → Supabase raw_dumps + enriched_signals). See
 *                    drain.ts.
 *
 * Privacy posture:
 *   The drain handler reads ONLY PII-scrubbed text from the queue (ai-proxy
 *   /enrich-dump applies the regex scrub before queueing). The Anthropic
 *   system prompt forbids echoing any PII the regex missed. Decryption of
 *   user-data payloads (for the daily intelligence layer) happens inside the
 *   worker boundary; nothing is logged.
 *
 * NOTE: the daily handlers are skeleton stubs. Algorithms live in
 *       packages/logic/* on the client today.
 */

import { drainEnrichQueue, type DrainEnv } from './drain';

export interface Env extends DrainEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  AI_PROXY: Fetcher;
  CACHE_KV: KVNamespace;

  // Service binding to the APNs Worker (configured in wrangler.toml).
  APNS_PUSH: Fetcher;
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
      ctx.waitUntil(safe('enrich-drain', async () => {
        const stats = await drainEnrichQueue(env);
        console.log('[cron:enrich-drain]', JSON.stringify(stats));
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
      ctx.waitUntil(safe('notification-queue', () => flushNotificationQueue(env)));
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
    const url = new URL(req.url);
    if (req.method !== 'POST') {
      return notFound();
    }

    if (url.pathname === '/run') {
      ctx.waitUntil(safe('manual-run', async () => {
        await runPatternDetection(env);
        await runPeriodPrediction(env);
        await runSubscriptionDetection(env);
        await flushNotificationQueue(env);
      }));
      return new Response(JSON.stringify({ queued: true }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Manual trigger for body weekly review:
    //   curl -X POST https://<worker>/weekly-review
    if (url.pathname === '/weekly-review') {
      ctx.waitUntil(safe('manual-weekly-review', () => runBodyWeeklyReview(env)));
      return new Response(JSON.stringify({ queued: true }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Manual trigger for body-correlation registry pass:
    //   curl -X POST https://<worker>/body-correlations
    if (url.pathname === '/body-correlations') {
      ctx.waitUntil(safe('manual-body-correlations', () => runBodyCorrelations(env)));
      return new Response(JSON.stringify({ queued: true }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/drain') {
      const stats = await drainEnrichQueue(env);
      return new Response(JSON.stringify({ ok: true, ...stats }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return notFound();
  },
};

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
 * Drain pending notifications from Supabase and fan out to APNs via the
 * service binding. Service-binding call is in-cluster; no public network
 * hop.
 */
async function flushNotificationQueue(_env: Env): Promise<void> {
  // intentionally empty until notifications layer lands.
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

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}
