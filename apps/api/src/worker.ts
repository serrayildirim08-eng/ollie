/**
 * ollie-notifications · Cloudflare Worker
 *
 * Two endpoints:
 *   POST /register-token   — iOS client posts its APNs device token here
 *                            after Capacitor PushNotifications fires
 *                            the `registration` listener.
 *   POST /send             — server-side trigger that pushes a
 *                            NotificationSpec to one or more device
 *                            tokens via APNs.
 *
 * The worker signs an APNs JWT (ES256) using a .p8 auth key stored as a
 * worker secret. JWTs are cached in-process for 50 minutes (Apple's
 * max is 60). The HTTP/2 fan-out is one request per token via the
 * standard `fetch` API — Cloudflare's fetch supports HTTP/2 to Apple.
 *
 * Apple Developer setup (Serra one-time):
 *   1. Apple Developer → Certificates, Identifiers & Profiles → Keys
 *   2. + → "Apple Push Notifications service (APNs)" → Continue
 *   3. Name: "ollie · APNs key" → Register → Download → AuthKey_XXX.p8
 *      Save the 10-char key id shown on screen — never shown again.
 *   4. Note the Team ID from Membership page.
 *   5. Make sure the iOS app's bundle id (app.ollie.ollie) has Push
 *      Notifications capability enabled in the App ID config.
 *   6. Wrangler secrets:
 *        wrangler secret put APNS_KEY_ID
 *        wrangler secret put APNS_TEAM_ID
 *        wrangler secret put APNS_BUNDLE_ID         # app.ollie.ollie
 *        wrangler secret put APNS_AUTH_KEY < AuthKey_XXX.p8
 *        wrangler secret put REGISTER_SHARED_SECRET
 *   7. wrangler kv:namespace create DEVICE_TOKENS
 *      (paste the returned id into wrangler.toml)
 *   8. wrangler deploy
 */

import type { NotificationSpec } from '@ollie/notifications';
import { createApnsJwtSigner } from '@ollie/apns-jwt';
import { Router } from '@ollie/worker-http';
import { handleAccountDelete } from './account-delete';

export interface Env {
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_BUNDLE_ID: string;
  APNS_AUTH_KEY: string;
  // Supabase wiring for E4 cron — required only when SCHEDULED_JOBS_ENABLED='1'.
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SCHEDULED_JOBS_ENABLED?: string;
  APNS_USE_SANDBOX: string;
  REGISTER_SHARED_SECRET: string;
  DEVICE_TOKENS: KVNamespace;
}

// ──────────────────────────────────────────────────────────────────────────
// Routing
// ──────────────────────────────────────────────────────────────────────────

// itty-router declarative routing — replaces the hand-rolled
// `if (method && pathname)` chain. Same paths, same methods, same
// 404 fallthrough text.
const router = Router<Request, [Env]>();

router
  .post('/register-token', (req, env) => handleRegister(req, env))
  .post('/send', (req, env) => handleSend(req, env))
  .post('/account/delete', (req, env) => handleAccountDelete(req, env))
  // /health accepted any method in the hand-rolled version — keep that.
  .all('/health', () => new Response('ok', { status: 200 }))
  // Manual cron trigger — for local testing without waiting for the
  // cron schedule. Same auth as /send.
  .post('/cron/tick', async (req, env) => {
    const auth = req.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== env.REGISTER_SHARED_SECRET) {
      return new Response('unauthorized', { status: 401 });
    }
    const result = await runCron(env);
    return Response.json(result);
  })
  .all('*', () => new Response('not found', { status: 404 }));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return router.fetch(req, env);
  },

  /**
   * Cron entrypoint — DECOMMISSIONED (audit item #1).
   *
   * The `[triggers]` block in wrangler.toml is removed, so Cloudflare
   * never invokes this. The 5-min `flushNotificationQueue` in the
   * workers/cron worker is the single owner of the `scheduled_jobs`
   * scan; running this in parallel caused duplicate push delivery and
   * broke the daily cap.
   *
   * The handler is kept (inert) only so that re-arming the trigger is a
   * deliberate one-line change rather than a silent regression — if you
   * re-add the trigger you MUST also remove flushNotificationQueue's
   * scan, never run both. `runCron` itself stays reachable via the
   * manual POST /cron/tick endpoint for local testing.
   */
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    console.warn(
      '[cron] scheduled() invoked but the scheduled_jobs scan is decommissioned ' +
      '(audit item #1). ollie-cron owns delivery. No-op.',
    );
  },
};

// ──────────────────────────────────────────────────────────────────────────
// E4 · cron loop · scans scheduled_jobs for due rows + dispatches
// ──────────────────────────────────────────────────────────────────────────

interface ScheduledJobRow {
  id: string;
  user_id: string;
  fire_at: string;
  job_type: string;
  payload: Record<string, unknown> | null;
  status: string;
  attempts: number;
  dedupe_key: string | null;
}

interface CronResult {
  ok: boolean;
  scanned: number;
  fired: number;
  failed: number;
  skipped_no_token: number;
  reason?: string;
}

async function runCron(env: Env): Promise<CronResult> {
  if (env.SCHEDULED_JOBS_ENABLED !== '1') {
    return { ok: true, scanned: 0, fired: 0, failed: 0, skipped_no_token: 0, reason: 'disabled' };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, scanned: 0, fired: 0, failed: 0, skipped_no_token: 0, reason: 'missing-supabase-config' };
  }

  // Pull due jobs. We cap at 100 per tick to bound the worker's CPU.
  const nowIso = new Date().toISOString();
  const due = await supabaseSelect<ScheduledJobRow[]>(env, 'scheduled_jobs', {
    select: '*',
    status: 'eq.pending',
    fire_at: `lte.${nowIso}`,
    order: 'fire_at.asc',
    limit: '100',
  });
  if (!due) return { ok: false, scanned: 0, fired: 0, failed: 0, skipped_no_token: 0, reason: 'select-failed' };

  let fired = 0;
  let failed = 0;
  let skippedNoToken = 0;
  const jwt = (env.APNS_AUTH_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID) ? await getApnsJwt(env) : null;

  for (const job of due) {
    // Credibility audit C4: track attempt count properly. Transient
    // failures (network, 5xx) reschedule with exponential backoff;
    // permanent failures (unknown job_type, no jwt) flip to 'failed';
    // success flips to 'fired'. Cap at 5 attempts.
    const MAX_ATTEMPTS = 5;
    const nextAttempt = (job.attempts ?? 0) + 1;
    try {
      const spec = jobToSpec(job);
      if (!spec) {
        await updateJob(env, job.id, { status: 'failed', last_error: 'unknown job_type', attempts: nextAttempt });
        failed++; continue;
      }
      const tokens = await tokensForUser(env, job.user_id);
      if (tokens.length === 0) {
        // No registered device tokens — mark fired anyway so we don't
        // retry forever. Client-side fallback timers handle delivery
        // when the app is open.
        await updateJob(env, job.id, { status: 'fired', last_error: 'no-tokens', attempts: nextAttempt });
        skippedNoToken++;
        continue;
      }
      if (!jwt) {
        // Transient — APNs jwt may be missing if env not yet configured.
        // Reschedule with backoff so deployment fixes don't lose jobs.
        await rescheduleOrFail(env, job, nextAttempt, MAX_ATTEMPTS, 'no-apns-jwt');
        failed++; continue;
      }
      const results = await Promise.all(tokens.map((t) => sendApns(env, jwt, t, spec)));
      const anyOk = results.some((r) => r.ok);
      if (anyOk) {
        await updateJob(env, job.id, { status: 'fired', last_error: null, attempts: nextAttempt });
        fired++;
      } else {
        const reason = results.find((r) => !r.ok)?.reason ?? 'unknown';
        await rescheduleOrFail(env, job, nextAttempt, MAX_ATTEMPTS, reason);
        failed++;
      }
    } catch (err) {
      await rescheduleOrFail(env, job, nextAttempt, MAX_ATTEMPTS, String((err as Error).message ?? err).slice(0, 200));
      failed++;
    }
  }

  return { ok: true, scanned: due.length, fired, failed, skipped_no_token: skippedNoToken };
}

function jobToSpec(job: ScheduledJobRow): NotificationSpec | null {
  const p = (job.payload ?? {}) as Partial<NotificationSpec> & { title?: string; body?: string };
  if (!p.title) return null;
  const category: NotificationSpec['category'] =
    job.job_type === 'med_nudge' ? 'REMINDER' :
    job.job_type === 'monthly_digest' ? 'PATTERN_ALERT' :
    job.job_type === 'daily_reading' ? 'CONTENT_DELIVERY' :
    'REMINDER';
  return {
    title: p.title,
    body: p.body,
    category,
    dedupe_key: job.dedupe_key ?? `job:${job.id}`,
    action_url: (p.action_url as string | undefined),
    extra: { job_id: job.id, job_type: job.job_type, ...(p.extra ?? {}) },
  };
}

async function supabaseSelect<T>(env: Env, table: string, params: Record<string, string>): Promise<T | null> {
  const qs = new URLSearchParams(params).toString();
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${qs}`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      console.error('[cron] supabaseSelect failed', table, res.status, await res.text());
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error('[cron] supabaseSelect threw', err);
    return null;
  }
}

async function updateJob(env: Env, id: string, patch: Record<string, unknown>): Promise<void> {
  const url = `${env.SUPABASE_URL}/rest/v1/scheduled_jobs?id=eq.${id}`;
  try {
    await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      // Use the caller-supplied `attempts` (preserves history) and only
      // stamp fired_at when the new status is 'fired'.
      body: JSON.stringify({
        ...patch,
        fired_at: patch.status === 'fired' ? new Date().toISOString() : null,
      }),
    });
  } catch (err) {
    console.error('[cron] updateJob failed', id, err);
  }
}

/**
 * Credibility audit C4 · exponential-backoff reschedule helper.
 *
 * Transient failures keep `status='pending'` and push `fire_at`
 * forward by `2^attempts` minutes. After MAX_ATTEMPTS, mark 'failed'.
 */
async function rescheduleOrFail(
  env: Env,
  job: ScheduledJobRow,
  nextAttempt: number,
  maxAttempts: number,
  reason: string,
): Promise<void> {
  if (nextAttempt >= maxAttempts) {
    await updateJob(env, job.id, { status: 'failed', last_error: reason, attempts: nextAttempt });
    return;
  }
  const backoffMinutes = Math.pow(2, nextAttempt);
  const nextFireAt = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
  await updateJob(env, job.id, {
    status: 'pending',
    last_error: reason,
    attempts: nextAttempt,
    fire_at: nextFireAt,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// /register-token
// ──────────────────────────────────────────────────────────────────────────

interface RegisterBody {
  token: string;
  platform: 'ios' | 'macos';
  device_id?: string;
  user_id?: string;
}

async function handleRegister(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== env.REGISTER_SHARED_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  let body: RegisterBody;
  try { body = (await req.json()) as RegisterBody; }
  catch { return new Response('bad json', { status: 400 }); }

  if (!body.token || !body.platform) {
    return new Response('missing fields', { status: 400 });
  }
  const key = body.user_id ? `user:${body.user_id}` : `token:${body.token}`;
  await env.DEVICE_TOKENS.put(
    key,
    JSON.stringify({
      token: body.token,
      platform: body.platform,
      device_id: body.device_id,
      user_id: body.user_id,
      registered_at: Date.now(),
    }),
  );

  // ALSO mirror the token into the Postgres `push_tokens` table so the
  // cron worker's notification drain (workers/cron · flushNotificationQueue)
  // can JOIN it on user_id. KV is not joinable from that worker. Best
  // effort — a Postgres failure must not fail registration (the legacy
  // KV-based apps/api cron path still works off the KV write above).
  if (body.user_id) {
    await mirrorTokenToPostgres(env, body).catch((err) => {
      console.error('[register] push_tokens mirror failed', err);
    });
  }

  return Response.json({ ok: true });
}

/**
 * Upsert one device-token row into Postgres `push_tokens`. The unique
 * index on `device_token` makes this an idempotent rebind: re-registering
 * the same token (token rotation, app reinstall under a new account)
 * updates user_id + platform + bumps updated_at.
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. If either is missing
 * the mirror is skipped (the worker stays functional for KV-only flows).
 */
async function mirrorTokenToPostgres(env: Env, body: RegisterBody): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const url = `${env.SUPABASE_URL}/rest/v1/push_tokens?on_conflict=device_token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id: body.user_id,
      device_token: body.token,
      platform: body.platform,
    }),
  });
  if (!res.ok) {
    throw new Error(`push_tokens upsert http ${res.status}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// /send
// ──────────────────────────────────────────────────────────────────────────

interface SendBody {
  /** One or more device tokens to push to. */
  tokens?: string[];
  /** OR a user_id whose tokens are looked up in KV. */
  user_id?: string;
  /** The notification spec. */
  spec: NotificationSpec;
}

async function handleSend(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== env.REGISTER_SHARED_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  let body: SendBody;
  try { body = (await req.json()) as SendBody; }
  catch { return new Response('bad json', { status: 400 }); }
  if (!body.spec || !body.spec.title || !body.spec.category) {
    return new Response('missing spec', { status: 400 });
  }

  const tokens = body.tokens?.length
    ? body.tokens
    : await tokensForUser(env, body.user_id);
  if (!tokens.length) {
    return Response.json({ ok: false, reason: 'no_tokens' }, { status: 200 });
  }

  const jwt = await getApnsJwt(env);
  const results = await Promise.all(
    tokens.map((t) => sendApns(env, jwt, t, body.spec)),
  );
  const ok = results.filter((r) => r.ok).length;
  return Response.json({ ok: true, delivered: ok, total: tokens.length, results });
}

async function tokensForUser(env: Env, userId?: string): Promise<string[]> {
  if (!userId) return [];
  const raw = await env.DEVICE_TOKENS.get(`user:${userId}`);
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as { token?: string };
    return j.token ? [j.token] : [];
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// APNs JWT (ES256). The signing routine lives in the shared @ollie/apns-jwt
// package — one copy, shared with workers/apns-push. The signer caches the
// token in this module's scope (Apple: valid 1h; this re-signs ~15 min
// before expiry, so a token is reused for ~45 min).
// ──────────────────────────────────────────────────────────────────────────

const apnsSigner = createApnsJwtSigner();

async function getApnsJwt(env: Env): Promise<string> {
  return apnsSigner.getApnsJwt({
    authKey: env.APNS_AUTH_KEY,
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// APNs HTTP/2 send
// ──────────────────────────────────────────────────────────────────────────

interface ApnsResult {
  ok: boolean;
  status: number;
  apns_id?: string;
  reason?: string;
}

async function sendApns(
  env: Env,
  jwt: string,
  deviceToken: string,
  spec: NotificationSpec,
): Promise<ApnsResult> {
  // Validate the device token before interpolating it into the request URL
  // (audit #2). APNs tokens are hex; reject anything else so a malformed/hostile
  // token cannot inject path segments or headers into the APNs request.
  if (!/^[0-9a-fA-F]{32,200}$/.test(deviceToken)) {
    return { ok: false, status: 400, reason: 'invalid_device_token' };
  }
  const host = env.APNS_USE_SANDBOX === '1'
    ? 'api.sandbox.push.apple.com'
    : 'api.push.apple.com';
  const url = `https://${host}/3/device/${deviceToken}`;

  // APNs payload. `alert` is the user-visible bit; everything else
  // (dedupe_key, category, action_url) goes in the custom keys.
  const payload = {
    aps: {
      alert: { title: spec.title, body: spec.body ?? '' },
      'thread-id': spec.aggregation_group ?? spec.category,
      'mutable-content': 1,
    },
    ollie: {
      dedupe_key: spec.dedupe_key,
      category: spec.category,
      action_url: spec.action_url,
      ...spec.extra,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `bearer ${jwt}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': spec.category === 'REMINDER' ? 'alert' : 'alert',
      'apns-priority': '10',
      'apns-collapse-id': spec.dedupe_key.slice(0, 64),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const apnsId = res.headers.get('apns-id') ?? undefined;
  if (res.ok) return { ok: true, status: res.status, apns_id: apnsId };
  let reason: string | undefined;
  try {
    const j = (await res.json()) as { reason?: string };
    reason = j.reason;
  } catch { /* noop */ }
  return { ok: false, status: res.status, apns_id: apnsId, reason };
}
