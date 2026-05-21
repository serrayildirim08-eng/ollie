/**
 * Tests for POST /grocery/purchase.
 *
 * Covered:
 *   - 200 happy path: valid event INSERTs to grocery_purchase_history
 *   - 400 on missing canonical / invalid source / out-of-range ts / bad JSON
 *   - 401 when T0_JWT_ENFORCED=1 and no Authorization header
 *   - canonical normalization (lowercase + unknown items kept as-is)
 *   - PostgREST 5xx surfaces as 502 with redacted detail
 *   - body fields wire-shape (qty/unit/source/ts → ISO) on the Supabase POST
 *
 * Auth is exercised via the open-mode `x-user-id` header so tests stay
 * deterministic — Clerk-gated paths are covered in clerk-verify.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handlePurchase, type PurchaseEnv } from '../src/router/purchase';

// ─── env stub ────────────────────────────────────────────────────────────────

const FAKE_USER = '11111111-2222-3333-4444-555555555555';

function makeEnv(overrides: Partial<PurchaseEnv> = {}): PurchaseEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-key',
    ...overrides,
  };
}

interface PurchaseBody {
  canonical?: string;
  qty?: number;
  unit?: string;
  source?: string;
  ts?: number;
}

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://worker.dev/grocery/purchase', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': FAKE_USER,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Partial<PurchaseBody> = {}): PurchaseBody {
  return {
    canonical: 'milk',
    qty: 1,
    unit: 'L',
    source: 'pantry_add',
    ts: Date.now() - 60_000,
    ...overrides,
  };
}

// ─── fetch mocks ─────────────────────────────────────────────────────────────

function makeSupabaseOk(insertedId = 'row-uuid-1'): typeof fetch {
  return (async (url) => {
    if (typeof url === 'string' && url.includes('grocery_purchase_history')) {
      return new Response(JSON.stringify([{ id: insertedId }]), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('POST /grocery/purchase', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── happy path ─────────────────────────────────────────────────────────────

  it('200: valid event inserts and returns { inserted: true, id }', async () => {
    fetchSpy.mockImplementation(makeSupabaseOk('row-1'));

    const res = await handlePurchase(makeReq(validBody()), makeEnv());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { inserted: true; id: string };
    expect(body.inserted).toBe(true);
    expect(body.id).toBe('row-1');

    // Verify the Supabase POST shape
    const call = fetchSpy.mock.calls[0];
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('service-role-key');
    expect(headers.authorization).toBe('Bearer service-role-key');
    const sentRow = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sentRow.user_id).toBe(FAKE_USER);
    expect(sentRow.canonical).toBe('milk');
    expect(sentRow.qty).toBe(1);
    expect(sentRow.unit).toBe('L');
    expect(sentRow.source).toBe('pantry_add');
    expect(typeof sentRow.ts).toBe('string'); // ISO string
    expect(() => new Date(sentRow.ts as string).toISOString()).not.toThrow();
  });

  it('200: returns { inserted: true } when Supabase response has no id', async () => {
    fetchSpy.mockImplementation((async () => {
      return new Response('', { status: 201 });
    }) as typeof fetch);

    const res = await handlePurchase(makeReq(validBody()), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inserted: true; id?: string };
    expect(body.inserted).toBe(true);
    expect(body.id).toBeUndefined();
  });

  // ── canonical normalize ────────────────────────────────────────────────────

  it('200: normalizes canonical to lowercase', async () => {
    fetchSpy.mockImplementation(makeSupabaseOk());
    await handlePurchase(
      makeReq(validBody({ canonical: '  Milk  ' })),
      makeEnv(),
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const sentRow = JSON.parse(init.body as string) as { canonical: string };
    expect(sentRow.canonical).toBe('milk');
  });

  it('200: keeps unknown canonical (e.g. "hay") as lowercase free-text', async () => {
    fetchSpy.mockImplementation(makeSupabaseOk());
    await handlePurchase(
      makeReq(validBody({ canonical: 'Hay' })),
      makeEnv(),
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const sentRow = JSON.parse(init.body as string) as { canonical: string };
    expect(sentRow.canonical).toBe('hay');
  });

  // ── validation ─────────────────────────────────────────────────────────────

  it('400: missing canonical', async () => {
    const res = await handlePurchase(
      makeReq(validBody({ canonical: '' })),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing_canonical');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('400: invalid source enum', async () => {
    const res = await handlePurchase(
      makeReq(validBody({ source: 'wishlist' })),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_source');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('400: ts more than 7 days in the past', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const res = await handlePurchase(
      makeReq(validBody({ ts: eightDaysAgo })),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ts_out_of_range');
  });

  it('400: ts more than 1 day in the future', async () => {
    const twoDaysAhead = Date.now() + 2 * 24 * 60 * 60 * 1000;
    const res = await handlePurchase(
      makeReq(validBody({ ts: twoDaysAhead })),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('400: bad JSON', async () => {
    const res = await handlePurchase(makeReq('not json'), makeEnv());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad_json');
  });

  it('400: negative qty', async () => {
    const res = await handlePurchase(
      makeReq(validBody({ qty: -1 })),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_qty');
  });

  // ── auth ───────────────────────────────────────────────────────────────────

  it('401: open mode without x-user-id', async () => {
    const req = new Request('https://worker.dev/grocery/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody()),
    });
    const res = await handlePurchase(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it('401: T0_JWT_ENFORCED=1 without Authorization', async () => {
    const req = new Request('https://worker.dev/grocery/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': FAKE_USER },
      body: JSON.stringify(validBody()),
    });
    const res = await handlePurchase(req, makeEnv({ T0_JWT_ENFORCED: '1' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('401: T0_JWT_ENFORCED=1 with malformed Bearer token', async () => {
    const req = new Request('https://worker.dev/grocery/purchase', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer garbage',
      },
      body: JSON.stringify(validBody()),
    });
    const res = await handlePurchase(
      req,
      makeEnv({ T0_JWT_ENFORCED: '1', CLERK_ISSUER: 'https://example.clerk.accounts.dev' }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_jwt');
  });

  // ── upstream failures ──────────────────────────────────────────────────────

  it('502 when Supabase returns 500', async () => {
    fetchSpy.mockImplementation((async () => {
      return new Response('internal server error', { status: 500 });
    }) as typeof fetch);

    const res = await handlePurchase(makeReq(validBody()), makeEnv());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; request_id: string };
    expect(body.error).toBe('purchase_insert_failed');
    // S8: detail must NOT leak in the response
    expect(JSON.stringify(body)).not.toContain('internal server error');
    expect(typeof body.request_id).toBe('string');
  });

  it('all three source values are accepted', async () => {
    fetchSpy.mockImplementation(makeSupabaseOk());
    for (const source of ['pantry_add', 'shop_checked', 'ai_inferred'] as const) {
      const res = await handlePurchase(
        makeReq(validBody({ source })),
        makeEnv(),
      );
      expect(res.status).toBe(200);
    }
  });
});
