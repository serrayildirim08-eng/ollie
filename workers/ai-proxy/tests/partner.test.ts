/**
 * Tests for /partner/* — focused on the security-hardening fixes:
 *   - audit #154: each snapshot phrase capped to 200 chars (not just count ≤5)
 *   - audit #38:  oversized snapshot body rejected (413) before req.json()
 *
 * Auth uses the x-user-id dev bypass (T0_JWT_ENFORCED='0', non-production).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { handlePartner, type PartnerEnv } from '../src/router/partner';

function makeEnv(overrides: Partial<PartnerEnv> = {}): PartnerEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role-key',
    T0_JWT_ENFORCED: '0',
    ENVIRONMENT: 'development',
    ...overrides,
  };
}

function snapshotReq(body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request('https://worker.dev/partner/snapshot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'user_me', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

describe('/partner/snapshot — hardening', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('401s without an identity', async () => {
    const req = new Request('https://worker.dev/partner/snapshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await handlePartner(req, makeEnv({ T0_JWT_ENFORCED: '1' }), 'snapshot');
    expect(res.status).toBe(401);
  });

  it('413s when Content-Length exceeds the snapshot body cap (audit #38)', async () => {
    const req = snapshotReq({ phrases: [] }, { 'content-length': String(32 * 1024) });
    const res = await handlePartner(req, makeEnv(), 'snapshot');
    expect(res.status).toBe(413);
  });

  it('caps EACH phrase to 200 chars before storing (audit #154)', async () => {
    let capturedRow: { phrases?: string[] } = {};
    const fetchSpy = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedRow = JSON.parse(String(init?.body ?? '{}'));
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const longPhrase = 'a'.repeat(5000);
    const req = snapshotReq({ phrases: [longPhrase, 'short', longPhrase] });
    const res = await handlePartner(req, makeEnv(), 'snapshot');

    expect(res.status).toBe(200);
    expect(capturedRow.phrases).toBeDefined();
    for (const p of capturedRow.phrases!) {
      expect(p.length).toBeLessThanOrEqual(200);
    }
    // The short phrase is preserved verbatim.
    expect(capturedRow.phrases).toContain('short');
  });

  it('caps the phrase COUNT to 5 (regression for the original slice)', async () => {
    let capturedRow: { phrases?: string[] } = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedRow = JSON.parse(String(init?.body ?? '{}'));
      return new Response(null, { status: 204 });
    }));

    const req = snapshotReq({ phrases: ['1', '2', '3', '4', '5', '6', '7'] });
    await handlePartner(req, makeEnv(), 'snapshot');
    expect(capturedRow.phrases).toHaveLength(5);
  });
});
