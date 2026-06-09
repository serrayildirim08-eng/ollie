/**
 * F2 — the cron worker's manual HTTP trigger routes (/run, /drain,
 * /flush-notifications, /weekly-review, /body-correlations) must be
 * gated by the CRON_TRIGGER_SECRET shared-secret bearer header.
 *
 * Unauthenticated these routes were a cost-amplification vector: anyone
 * could POST /drain and force the enrich queue to grind. These tests
 * assert the gate rejects (401) without the secret and fails CLOSED when
 * the secret is unset, and that a correct secret lets the route through.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker, { type Env } from '../src/index';

const TRIGGER_ROUTES = [
  '/run',
  '/drain',
  '/flush-notifications',
  '/weekly-review',
  '/body-correlations',
] as const;

function makeEnv(over: Partial<Env> = {}): Env {
  // Only the fields the auth gate + the lightest route touch. The 401
  // path short-circuits before any handler, so most of Env is unused.
  return {
    CRON_TRIGGER_SECRET: 'cron-secret',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE: 'sr',
    SUPABASE_SERVICE_ROLE_KEY: 'sr-key',
    ...over,
  } as Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://cron.test${path}`, { method: 'POST', headers });
}

describe('cron worker · F2 trigger-route auth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects every trigger route with 401 when no Authorization header', async () => {
    for (const path of TRIGGER_ROUTES) {
      const res = await worker.fetch(req(path), makeEnv(), ctx);
      expect(res.status, `${path} should be 401`).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'unauthorized' });
    }
  });

  it('rejects with 401 on a wrong secret', async () => {
    for (const path of TRIGGER_ROUTES) {
      const res = await worker.fetch(
        req(path, { authorization: 'Bearer wrong-secret' }),
        makeEnv(),
        ctx,
      );
      expect(res.status, `${path} should be 401`).toBe(401);
    }
  });

  it('fails CLOSED — 401 even with a Bearer header when CRON_TRIGGER_SECRET is unset', async () => {
    const env = makeEnv({ CRON_TRIGGER_SECRET: '' });
    for (const path of TRIGGER_ROUTES) {
      const res = await worker.fetch(
        req(path, { authorization: 'Bearer anything' }),
        env,
        ctx,
      );
      expect(res.status, `${path} should be 401`).toBe(401);
    }
  });

  it('allows /run with the correct secret (202 queued)', async () => {
    // /run only schedules ctx.waitUntil work — no synchronous network.
    const res = await worker.fetch(
      req('/run', { authorization: 'Bearer cron-secret' }),
      makeEnv(),
      ctx,
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: true });
  });

  it('allows /weekly-review and /body-correlations with the correct secret', async () => {
    for (const path of ['/weekly-review', '/body-correlations']) {
      const res = await worker.fetch(
        req(path, { authorization: 'Bearer cron-secret' }),
        makeEnv(),
        ctx,
      );
      expect(res.status, `${path} should be 202`).toBe(202);
    }
  });

  it('unknown paths still 404 (auth gate does not swallow them)', async () => {
    const res = await worker.fetch(
      req('/nope', { authorization: 'Bearer cron-secret' }),
      makeEnv(),
      ctx,
    );
    expect(res.status).toBe(404);
  });
});
