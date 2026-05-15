/**
 * Tests for the server-side notification delivery drain.
 *   - Supabase REST (select / count / patch) mocked via global fetch.
 *   - APNs delivery mocked via the APNS_PUSH service-binding stub.
 *
 * Coverage:
 *   - drains pending jobs past fire_at
 *   - leaves future jobs alone (they are never selected)
 *   - banned-phrase payload → 'rejected', no APNs call
 *   - APNs failure → retry; 3 failures → 'failed'
 *   - budget over cap → 'budget_skipped'
 *   - muted category → 'muted'
 *   - multi-device → delivers to all tokens
 *   - idempotency: PATCH is guarded by status=eq.pending
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushNotificationQueue, type ScheduledJobRow, type FlushEnv } from '../src/flush-notifications';

// ─── job factory ────────────────────────────────────────────────────────────

function job(over: Partial<ScheduledJobRow> = {}): ScheduledJobRow {
  return {
    id: 'job-' + Math.random().toString(36).slice(2, 8),
    user_id: 'user-1',
    fire_at: '2026-05-15T00:00:00Z',
    job_type: 'reminder_fire',
    payload: { title: 'bill due tomorrow', body: 'electric bill, $84' },
    status: 'pending',
    attempts: 0,
    dedupe_key: 'finance:bill:electric',
    daily_cap: 4,
    notification_category: 'REMINDER',
    category_muted: false,
    ...over,
  };
}

// ─── mock harness ───────────────────────────────────────────────────────────
//
// Models the Supabase REST surface the drain hits:
//   GET  scheduled_jobs?status=eq.pending&fire_at=lte... → due jobs
//   GET  scheduled_jobs?status=eq.sent&...               → sent-today count
//   GET  push_tokens?user_id=eq...                       → device tokens
//   PATCH scheduled_jobs?id=eq...&status=eq.pending      → status update
//
// APNs is the APNS_PUSH service binding — a Fetcher stub.

interface Harness {
  env: FlushEnv;
  patches: Array<{ id: string; body: Record<string, unknown> }>;
  apnsCalls: Array<{ deviceToken: string }>;
}

function makeHarness(opts: {
  dueJobs: ScheduledJobRow[];
  tokensByUser?: Record<string, string[]>;
  sentTodayByUser?: Record<string, number>;
  apns?: (deviceToken: string) => { status: number; reason?: string };
}): Harness {
  const patches: Array<{ id: string; body: Record<string, unknown> }> = [];
  const apnsCalls: Array<{ deviceToken: string }> = [];
  const tokensByUser = opts.tokensByUser ?? { 'user-1': ['tok-aaa'] };
  const sentTodayByUser = opts.sentTodayByUser ?? {};
  const apns = opts.apns ?? (() => ({ status: 200 }));

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    // PATCH scheduled_jobs?id=eq.<id>&status=eq.pending
    if (method === 'PATCH' && url.includes('/rest/v1/scheduled_jobs')) {
      const m = url.match(/id=eq\.([^&]+)/);
      const id = m ? m[1] : 'unknown';
      patches.push({ id, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(null, { status: 204 });
    }

    // GET scheduled_jobs — either the due-jobs select or the sent-today count
    if (method === 'GET' && url.includes('/rest/v1/scheduled_jobs')) {
      if (url.includes('status=eq.sent')) {
        const m = url.match(/user_id=eq\.([^&]+)/);
        const userId = m ? m[1] : '';
        const n = sentTodayByUser[userId] ?? 0;
        return new Response(JSON.stringify(new Array(n).fill({ id: 'x' })), {
          status: 200,
          headers: { 'content-range': `0-${Math.max(0, n - 1)}/${n}` },
        });
      }
      // due-jobs select
      return new Response(JSON.stringify(opts.dueJobs), { status: 200 });
    }

    // GET push_tokens?user_id=eq.<id>
    if (method === 'GET' && url.includes('/rest/v1/push_tokens')) {
      const m = url.match(/user_id=eq\.([^&]+)/);
      const userId = m ? m[1] : '';
      const tokens = (tokensByUser[userId] ?? []).map((t) => ({
        device_token: t,
        platform: 'ios',
      }));
      return new Response(JSON.stringify(tokens), { status: 200 });
    }

    throw new Error('unexpected fetch ' + method + ' ' + url);
  });

  vi.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl as typeof fetch);

  const env: FlushEnv = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-fake',
    APNS_PUSH: {
      fetch: async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { deviceToken: string };
        apnsCalls.push({ deviceToken: body.deviceToken });
        const r = apns(body.deviceToken);
        if (r.status >= 200 && r.status < 300) {
          return new Response('{}', { status: r.status });
        }
        return new Response(JSON.stringify({ reason: r.reason ?? 'BadDeviceToken' }), {
          status: r.status,
        });
      },
    } as unknown as Fetcher,
  };

  return { env, patches, apnsCalls };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('flushNotificationQueue · happy path', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('drains a pending due job and marks it sent', async () => {
    const j = job();
    const h = makeHarness({ dueJobs: [j] });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.processed).toBe(1);
    expect(stats.sent).toBe(1);
    expect(stats.rejected).toBe(0);
    expect(stats.failed).toBe(0);
    expect(h.apnsCalls).toHaveLength(1);
    expect(h.apnsCalls[0].deviceToken).toBe('tok-aaa');

    const patch = h.patches.find((p) => p.id === j.id);
    expect(patch?.body.status).toBe('sent');
    expect(patch?.body.sent_at).toBeTruthy();
  });

  it('selects only pending+due rows — future jobs never reach the drain', async () => {
    // The query string itself encodes status=eq.pending & fire_at=lte.now.
    // We assert the drain issues exactly that filter, so a future job is
    // never returned by the select in the first place.
    const h = makeHarness({ dueJobs: [] });
    await flushNotificationQueue(h.env);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const selectCall = fetchMock.mock.calls.find(
      (c: unknown[]) =>
        String(c[0]).includes('/rest/v1/scheduled_jobs') &&
        String(c[0]).includes('status=eq.pending') &&
        !String(c[0]).includes('status=eq.sent'),
    );
    expect(selectCall).toBeTruthy();
    expect(String(selectCall![0])).toContain('fire_at=lte.');
    expect(String(selectCall![0])).toContain('order=fire_at.asc');
    expect(String(selectCall![0])).toContain('limit=100');
  });

  it('multi-device: delivers to every registered token', async () => {
    const j = job({ user_id: 'user-multi' });
    const h = makeHarness({
      dueJobs: [j],
      tokensByUser: { 'user-multi': ['tok-iphone', 'tok-ipad', 'tok-mac'] },
    });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.sent).toBe(1);
    expect(h.apnsCalls.map((c) => c.deviceToken).sort()).toEqual([
      'tok-ipad',
      'tok-iphone',
      'tok-mac',
    ]);
  });
});

describe('flushNotificationQueue · banned-phrase gate', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('rejects a payload with cheerleading copy — no APNs call', async () => {
    const j = job({ payload: { title: 'great job tracking today', body: 'keep it up' } });
    const h = makeHarness({ dueJobs: [j] });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.rejected).toBe(1);
    expect(stats.sent).toBe(0);
    expect(h.apnsCalls).toHaveLength(0);

    const patch = h.patches.find((p) => p.id === j.id);
    expect(patch?.body.status).toBe('rejected');
    expect(String(patch?.body.last_error)).toContain('banned-phrase');
  });

  it('rejects streak language in the body', async () => {
    const j = job({ payload: { title: 'habit reminder', body: "don't break your streak" } });
    const h = makeHarness({ dueJobs: [j] });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.rejected).toBe(1);
    expect(h.apnsCalls).toHaveLength(0);
  });

  it('rejects an exclamation mark in push copy', async () => {
    const j = job({ payload: { title: 'water break', body: 'time to hydrate!' } });
    const h = makeHarness({ dueJobs: [j] });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.rejected).toBe(1);
    expect(h.apnsCalls).toHaveLength(0);
  });
});

describe('flushNotificationQueue · retry + failure', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('APNs failure on a fresh job → stays pending, attempts bumped to 1', async () => {
    const j = job({ attempts: 0 });
    const h = makeHarness({
      dueJobs: [j],
      apns: () => ({ status: 400, reason: 'BadDeviceToken' }),
    });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.retried).toBe(1);
    expect(stats.failed).toBe(0);
    const patch = h.patches.find((p) => p.id === j.id);
    expect(patch?.body.status).toBe('pending');
    expect(patch?.body.attempts).toBe(1);
  });

  it('APNs failure on a job already at attempts=2 → flips to failed', async () => {
    const j = job({ attempts: 2 });
    const h = makeHarness({
      dueJobs: [j],
      apns: () => ({ status: 500, reason: 'InternalServerError' }),
    });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.failed).toBe(1);
    expect(stats.retried).toBe(0);
    const patch = h.patches.find((p) => p.id === j.id);
    expect(patch?.body.status).toBe('failed');
    expect(patch?.body.attempts).toBe(3);
  });

  it('no registered device token → retry, then fail after 3 attempts', async () => {
    const j = job({ user_id: 'user-notoken', attempts: 2 });
    const h = makeHarness({ dueJobs: [j], tokensByUser: { 'user-notoken': [] } });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.no_token).toBe(1);
    expect(stats.failed).toBe(1);
    const patch = h.patches.find((p) => p.id === j.id);
    expect(patch?.body.status).toBe('failed');
  });
});

describe('flushNotificationQueue · budget + mute', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('over daily cap → budget_skipped, no APNs call', async () => {
    const j = job({ user_id: 'user-overcap', daily_cap: 4 });
    const h = makeHarness({
      dueJobs: [j],
      sentTodayByUser: { 'user-overcap': 4 },
    });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.budget_skipped).toBe(1);
    expect(stats.sent).toBe(0);
    expect(h.apnsCalls).toHaveLength(0);
    const patch = h.patches.find((p) => p.id === j.id);
    expect(patch?.body.status).toBe('budget_skipped');
  });

  it('under cap → delivers normally', async () => {
    const j = job({ user_id: 'user-undercap', daily_cap: 4 });
    const h = makeHarness({
      dueJobs: [j],
      tokensByUser: { 'user-undercap': ['tok-uc'] },
      sentTodayByUser: { 'user-undercap': 3 },
    });

    const stats = await flushNotificationQueue(h.env);
    expect(stats.sent).toBe(1);
  });

  it('two due jobs for the same user: second is budget_skipped once cap is hit mid-batch', async () => {
    const a = job({ id: 'job-a', user_id: 'user-edge', daily_cap: 1 });
    const b = job({ id: 'job-b', user_id: 'user-edge', daily_cap: 1, dedupe_key: 'd2' });
    const h = makeHarness({
      dueJobs: [a, b],
      tokensByUser: { 'user-edge': ['tok-edge'] },
      sentTodayByUser: { 'user-edge': 0 },
    });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.sent).toBe(1);
    expect(stats.budget_skipped).toBe(1);
  });

  it('muted category → muted, no APNs call', async () => {
    const j = job({ category_muted: true });
    const h = makeHarness({ dueJobs: [j] });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.muted).toBe(1);
    expect(stats.sent).toBe(0);
    expect(h.apnsCalls).toHaveLength(0);
    const patch = h.patches.find((p) => p.id === j.id);
    expect(patch?.body.status).toBe('muted');
  });
});

describe('flushNotificationQueue · idempotency + edge cases', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('every status PATCH is guarded by status=eq.pending', async () => {
    const j = job();
    const h = makeHarness({ dueJobs: [j] });
    await flushNotificationQueue(h.env);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const patchCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls.length).toBeGreaterThan(0);
    for (const c of patchCalls) {
      expect(String(c[0])).toContain('status=eq.pending');
    }
  });

  it('a job with no title → failed (not retried — no deliverable copy)', async () => {
    const j = job({ payload: { body: 'orphan body' } });
    const h = makeHarness({ dueJobs: [j] });

    const stats = await flushNotificationQueue(h.env);

    expect(stats.failed).toBe(1);
    expect(h.apnsCalls).toHaveLength(0);
    const patch = h.patches.find((p) => p.id === j.id);
    expect(patch?.body.status).toBe('failed');
  });

  it('empty queue → all-zero stats, no APNs call', async () => {
    const h = makeHarness({ dueJobs: [] });
    const stats = await flushNotificationQueue(h.env);
    expect(stats).toEqual({
      processed: 0,
      sent: 0,
      rejected: 0,
      failed: 0,
      retried: 0,
      budget_skipped: 0,
      muted: 0,
      no_token: 0,
    });
    expect(h.apnsCalls).toHaveLength(0);
  });

  it('missing Supabase config → no-op, all-zero stats', async () => {
    const stats = await flushNotificationQueue({
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE: '',
      APNS_PUSH: { fetch: async () => new Response('{}') } as unknown as Fetcher,
    });
    expect(stats.processed).toBe(0);
  });
});
