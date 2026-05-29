/**
 * Tests for GET /replenishment/:user.
 *
 * Covered:
 *   - 200: empty RPC → estimates: []
 *   - 200: 1-row purchase → low-data, medianIntervalDays falls back to SHELF_LIFE_MAP
 *   - 200: 3-row median → observed
 *   - 200: 5-row median → observed (larger sample)
 *   - 200: unknown canonical 1-row → low-data with STATIC_FALLBACK_DAYS=14
 *   - 400: malformed user_id (not a UUID)
 *   - 401: T0_JWT_ENFORCED with no auth; open-mode missing x-user-id
 *   - 403: x-user-id ≠ path user_id (cross-user block)
 *   - cache-control header present on success
 *   - SQL RPC 404 (not yet deployed) → empty estimates (graceful degrade)
 *   - SQL RPC 500 → 502 with redacted detail
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleReplenishment,
  type ReplenishmentEnv,
  type ReplenishmentEstimate,
} from '../src/router/replenishment';

// ─── env stub ────────────────────────────────────────────────────────────────

const FAKE_USER = '11111111-2222-3333-4444-555555555555';
const OTHER_USER = '99999999-8888-7777-6666-555555555555';

function makeEnv(overrides: Partial<ReplenishmentEnv> = {}): ReplenishmentEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-key',
    T0_JWT_ENFORCED: '0', // dev/open default; auth tests override with '1'
    ...overrides,
  };
}

function makeReq(user = FAKE_USER, headers: Record<string, string> = {}): Request {
  return new Request(`https://worker.dev/replenishment/${user}`, {
    method: 'GET',
    headers: {
      'x-user-id': user,
      ...headers,
    },
  });
}

// ─── RPC mock helper ─────────────────────────────────────────────────────────

interface RpcRow {
  canonical: string;
  sample_size: number;
  median_interval_days: number | null;
  last_purchase_ts: string;
}

function mockRpc(rows: RpcRow[], status = 200): typeof fetch {
  return (async (url) => {
    if (
      typeof url === 'string' &&
      url.includes('rpc/grocery_replenishment_estimates')
    ) {
      return new Response(JSON.stringify(rows), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function mockRpcRaw(body: string, status: number): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

// ─── tests ───────────────────────────────────────────────────────────────────

describe('GET /replenishment/:user', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── empty / zero rows ──────────────────────────────────────────────────────

  it('200: empty RPC returns estimates: []', async () => {
    fetchSpy.mockImplementation(mockRpc([]));

    const res = await handleReplenishment(makeReq(), makeEnv(), FAKE_USER);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { estimates: ReplenishmentEstimate[] };
    expect(body.estimates).toEqual([]);
  });

  // ── 1-row → low-data ───────────────────────────────────────────────────────

  it('200: 1-row purchase → confidence=low-data, static shelf-life cadence', async () => {
    fetchSpy.mockImplementation(mockRpc([
      {
        canonical: 'milk',
        sample_size: 1,
        median_interval_days: null,
        last_purchase_ts: isoDaysAgo(3),
      },
    ]));

    const res = await handleReplenishment(makeReq(), makeEnv(), FAKE_USER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { estimates: ReplenishmentEstimate[] };
    expect(body.estimates).toHaveLength(1);
    const e = body.estimates[0];
    expect(e.canonical).toBe('milk');
    expect(e.confidence).toBe('low-data');
    expect(e.sampleSize).toBe(1);
    expect(e.medianIntervalDays).toBe(7); // SHELF_LIFE_MAP.milk
    // 7 - 3 = 4 days left (with possible rounding tolerance)
    expect(e.daysLeft).toBeGreaterThan(3.5);
    expect(e.daysLeft).toBeLessThanOrEqual(4);
  });

  it('200: 1-row unknown canonical → low-data with 14d static fallback', async () => {
    fetchSpy.mockImplementation(mockRpc([
      {
        canonical: 'hay',
        sample_size: 1,
        median_interval_days: null,
        last_purchase_ts: isoDaysAgo(2),
      },
    ]));

    const res = await handleReplenishment(makeReq(), makeEnv(), FAKE_USER);
    const body = (await res.json()) as { estimates: ReplenishmentEstimate[] };
    const e = body.estimates[0];
    expect(e.confidence).toBe('low-data');
    expect(e.medianIntervalDays).toBe(14);
    expect(e.daysLeft).toBeGreaterThan(11.5);
    expect(e.daysLeft).toBeLessThanOrEqual(12);
  });

  // ── observed: 2+ rows ──────────────────────────────────────────────────────

  it('200: 3-row median → confidence=observed', async () => {
    fetchSpy.mockImplementation(mockRpc([
      {
        canonical: 'coffee',
        sample_size: 3,
        median_interval_days: 5,
        last_purchase_ts: isoDaysAgo(2),
      },
    ]));

    const res = await handleReplenishment(makeReq(), makeEnv(), FAKE_USER);
    const body = (await res.json()) as { estimates: ReplenishmentEstimate[] };
    const e = body.estimates[0];
    expect(e.confidence).toBe('observed');
    expect(e.sampleSize).toBe(3);
    expect(e.medianIntervalDays).toBe(5);
    // 5 - 2 = 3 days left
    expect(e.daysLeft).toBeGreaterThan(2.5);
    expect(e.daysLeft).toBeLessThanOrEqual(3);
  });

  it('200: 5-row median → confidence=observed (larger sample)', async () => {
    fetchSpy.mockImplementation(mockRpc([
      {
        canonical: 'bread',
        sample_size: 5,
        median_interval_days: 4,
        last_purchase_ts: isoDaysAgo(6),
      },
    ]));

    const res = await handleReplenishment(makeReq(), makeEnv(), FAKE_USER);
    const body = (await res.json()) as { estimates: ReplenishmentEstimate[] };
    const e = body.estimates[0];
    expect(e.confidence).toBe('observed');
    expect(e.sampleSize).toBe(5);
    // 4 - 6 < 0 → clamped to 0
    expect(e.daysLeft).toBe(0);
  });

  it('200: multiple canonicals in one response', async () => {
    fetchSpy.mockImplementation(mockRpc([
      {
        canonical: 'milk',
        sample_size: 4,
        median_interval_days: 7,
        last_purchase_ts: isoDaysAgo(1),
      },
      {
        canonical: 'eggs',
        sample_size: 1,
        median_interval_days: null,
        last_purchase_ts: isoDaysAgo(10),
      },
    ]));

    const res = await handleReplenishment(makeReq(), makeEnv(), FAKE_USER);
    const body = (await res.json()) as { estimates: ReplenishmentEstimate[] };
    expect(body.estimates).toHaveLength(2);
    expect(body.estimates[0].confidence).toBe('observed');
    expect(body.estimates[1].confidence).toBe('low-data');
  });

  // ── auth ───────────────────────────────────────────────────────────────────

  it('400: malformed user_id (not a UUID)', async () => {
    const res = await handleReplenishment(
      new Request('https://worker.dev/replenishment/not-a-uuid'),
      makeEnv(),
      'not-a-uuid',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_user_id');
  });

  it('401: open mode without x-user-id', async () => {
    const req = new Request(`https://worker.dev/replenishment/${FAKE_USER}`);
    const res = await handleReplenishment(req, makeEnv(), FAKE_USER);
    expect(res.status).toBe(401);
  });

  it('401: T0_JWT_ENFORCED=1 with no Authorization', async () => {
    const req = new Request(`https://worker.dev/replenishment/${FAKE_USER}`);
    const res = await handleReplenishment(
      req,
      makeEnv({ T0_JWT_ENFORCED: '1' }),
      FAKE_USER,
    );
    expect(res.status).toBe(401);
  });

  it('403: x-user-id ≠ path user_id (cross-user block, open mode)', async () => {
    const res = await handleReplenishment(
      makeReq(FAKE_USER, { 'x-user-id': OTHER_USER }),
      makeEnv(),
      FAKE_USER,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('forbidden');
  });

  // ── cache header ───────────────────────────────────────────────────────────

  it('cache-control: private, max-age=60 on success', async () => {
    fetchSpy.mockImplementation(mockRpc([]));
    const res = await handleReplenishment(makeReq(), makeEnv(), FAKE_USER);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });

  // ── graceful degrade / upstream failure ────────────────────────────────────

  it('200: RPC 404 (function not yet deployed) → empty estimates', async () => {
    fetchSpy.mockImplementation(mockRpcRaw('not found', 404));
    const res = await handleReplenishment(makeReq(), makeEnv(), FAKE_USER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { estimates: ReplenishmentEstimate[] };
    expect(body.estimates).toEqual([]);
  });

  it('502: RPC 500 surfaces as redacted upstream error', async () => {
    fetchSpy.mockImplementation(
      mockRpcRaw('schema "public" relation x missing', 500),
    );
    const res = await handleReplenishment(makeReq(), makeEnv(), FAKE_USER);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; request_id: string };
    expect(body.error).toBe('replenishment_rpc_failed');
    // S8: schema detail must NOT leak
    expect(JSON.stringify(body)).not.toContain('schema');
    expect(typeof body.request_id).toBe('string');
  });

  // ── RPC body shape sent to Supabase ────────────────────────────────────────

  it('sends p_user = path UUID to the RPC', async () => {
    fetchSpy.mockImplementation(mockRpc([]));
    await handleReplenishment(makeReq(), makeEnv(), FAKE_USER);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const sent = JSON.parse(init.body as string) as { p_user: string };
    expect(sent.p_user).toBe(FAKE_USER);
  });
});
