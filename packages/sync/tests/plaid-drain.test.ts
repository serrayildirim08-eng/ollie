/**
 * @ollie/sync · Plaid inbox drain tests
 *
 * Covers:
 *   1. Happy path · valid transaction rows → upserted + acked
 *   2. Tampered row · skipped, NOT acked, error surfaced
 *   3. Upsert failure · error captured, that id NOT acked
 *   4. Missing auth · returns error result, no fetch calls
 *   5. Empty inbox · drain returns 0, no ack call
 *   6. Network failure · returns error result, no ack call
 *   7. Tombstones · removed_ids fanned out to upsertRecord(_deleted)
 *   8. Sync marker · acked but no upsert
 *
 * The drain test deliberately mocks `financeSync` instead of running
 * the real FinanceSyncClient — we have separate tests for that path
 * in finance.test.ts. Goal: isolate the drain's contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drainPlaidInbox, validateDrainedRow } from '../src/plaid-drain';
import type { FinanceSyncClient } from '../src/finance';
import type { PlaidDrainDeps } from '../src/plaid-drain';

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function makeFinanceSync(): {
  client: FinanceSyncClient;
  upserts: Array<{ row: Record<string, unknown>; recordType?: string }>;
  throwOn?: Set<string>;
  setThrowOn(ids: string[]): void;
} {
  const upserts: Array<{ row: Record<string, unknown>; recordType?: string }> = [];
  const state: { throwOn?: Set<string> } = {};
  const client: FinanceSyncClient = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    syncOut: vi.fn(async () => undefined),
    syncIn: vi.fn(async () => undefined),
    upsertRecord: vi.fn(async (row, recordType) => {
      const id = (row as { id?: string })?.id;
      if (id && state.throwOn?.has(id)) {
        throw new Error('simulated upsert failure');
      }
      upserts.push({ row: row as Record<string, unknown>, recordType });
    }),
    setAuthJwt: vi.fn(),
    setEncryptionKey: vi.fn(),
    _inspect: vi.fn(() => ({ queueDepth: 0, cursor: null, running: false })),
  };
  return {
    client,
    upserts,
    setThrowOn(ids) {
      state.throwOn = new Set(ids);
    },
  };
}

type MockFetchStep =
  | { status?: number; body?: unknown }
  | { throw: unknown };

function mockFetchSeq(responses: MockFetchStep[]) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  let i = 0;
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const headerObj: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headerObj[k.toLowerCase()] = v;
      }
    }
    calls.push({
      url: u,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      headers: headerObj,
    });
    const next = responses[i++];
    if (!next) {
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    }
    if ('throw' in next) {
      throw next.throw;
    }
    const status = next.status ?? 200;
    const body = next.body;
    return new Response(JSON.stringify(body ?? {}), { status });
  });
  return { fetchFn, calls };
}

function validTransaction(id: string): Record<string, unknown> {
  return {
    id,
    event_date: '2026-05-14',
    amount: 12.34,
    currency: 'USD',
    merchant: 'Spotify',
    merchant_normalized: 'spotify',
    category: 'ENTERTAINMENT.MUSIC_AND_AUDIO',
    notes: null,
    direction: 'out',
    source: 'plaid',
    source_account_id: 'acct_x',
    source_item_id: 'item_y',
    created_at: 1747200000000,
  };
}

function row(id: string, kind: 'transaction' | 'tombstones' | 'sync_marker', tx: Record<string, unknown>) {
  return {
    id,
    item_id: 'item_y',
    record_kind: kind,
    transaction: tx,
    created_at: '2026-05-14T00:00:00Z',
  };
}

function makeDeps(overrides: Partial<PlaidDrainDeps> & { financeSync: FinanceSyncClient; fetch: typeof fetch }): PlaidDrainDeps {
  return {
    workerUrl: 'https://plaid-sync.test',
    authToken: () => 'JWT-VALID',
    userId: 'user-a',
    now: () => 5_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

// ──────────────────────────────────────────────────────────────────────────
// validateDrainedRow — pure shape check
// ──────────────────────────────────────────────────────────────────────────

describe('validateDrainedRow', () => {
  it('accepts a well-formed transaction row', () => {
    const r = row('row-1', 'transaction', validTransaction('tx-1'));
    const v = validateDrainedRow(r, 'user-a');
    expect(v.ok).toBe(true);
  });

  it('rejects when transaction.amount is NaN', () => {
    const tx = { ...validTransaction('tx-1'), amount: NaN };
    const v = validateDrainedRow(row('row-1', 'transaction', tx), 'user-a');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/amount/);
  });

  it('rejects when transaction.amount is a string ("NaN")', () => {
    const tx = { ...validTransaction('tx-1'), amount: 'NaN' as unknown as number };
    const v = validateDrainedRow(row('row-1', 'transaction', tx), 'user-a');
    expect(v.ok).toBe(false);
  });

  it('rejects when transaction.direction is invalid', () => {
    const tx = { ...validTransaction('tx-1'), direction: 'sideways' };
    const v = validateDrainedRow(row('row-1', 'transaction', tx), 'user-a');
    expect(v.ok).toBe(false);
  });

  it('rejects when record_kind is unknown', () => {
    const v = validateDrainedRow(
      { id: 'r', item_id: 'i', record_kind: 'attack', transaction: {}, created_at: 'x' },
      'user-a',
    );
    expect(v.ok).toBe(false);
  });

  it('accepts tombstone row with removed_ids array', () => {
    const v = validateDrainedRow(
      row('row-1', 'tombstones', { kind: 'tombstones', removed_ids: ['t1', 't2'], ts: 1 }),
      'user-a',
    );
    expect(v.ok).toBe(true);
  });

  it('rejects tombstone row with non-array removed_ids', () => {
    const v = validateDrainedRow(
      row('row-1', 'tombstones', { removed_ids: 'all of them' }),
      'user-a',
    );
    expect(v.ok).toBe(false);
  });

  it('rejects row missing id', () => {
    const v = validateDrainedRow(
      { item_id: 'i', record_kind: 'transaction', transaction: validTransaction('tx'), created_at: 'x' },
      'user-a',
    );
    expect(v.ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// drainPlaidInbox — end-to-end
// ──────────────────────────────────────────────────────────────────────────

describe('drainPlaidInbox · happy path', () => {
  it('drains 3 valid transactions → 3 upserts → ack with 3 ids', async () => {
    const finance = makeFinanceSync();
    const rows = [
      row('row-1', 'transaction', validTransaction('tx-1')),
      row('row-2', 'transaction', validTransaction('tx-2')),
      row('row-3', 'transaction', validTransaction('tx-3')),
    ];
    const { fetchFn, calls } = mockFetchSeq([
      { status: 200, body: { rows } },
      { status: 200, body: { ok: true, deleted: 3 } },
    ]);

    const result = await drainPlaidInbox(makeDeps({ financeSync: finance.client, fetch: fetchFn }));

    expect(result.drained).toBe(3);
    expect(result.errors).toEqual([]);
    expect(finance.upserts.length).toBe(3);
    expect(finance.upserts[0].row.id).toBe('tx-1');
    expect(finance.upserts[0].recordType).toBe('transaction');

    // Drain + ack — two calls.
    expect(calls.length).toBe(2);
    expect(calls[0].url).toBe('https://plaid-sync.test/inbox/drain');
    expect(calls[0].headers.authorization).toBe('Bearer JWT-VALID');
    expect(calls[0].body).toEqual({ userId: 'user-a', limit: 50 });

    expect(calls[1].url).toBe('https://plaid-sync.test/inbox/ack');
    expect((calls[1].body as { ids: string[] }).ids).toEqual(['row-1', 'row-2', 'row-3']);
    expect((calls[1].body as { userId: string }).userId).toBe('user-a');
  });
});

describe('drainPlaidInbox · tampered row', () => {
  it('skips row with NaN amount → not in ack list → error recorded', async () => {
    const finance = makeFinanceSync();
    const tampered = { ...validTransaction('tx-bad'), amount: NaN };
    const rows = [
      row('row-1', 'transaction', validTransaction('tx-1')),
      row('row-2', 'transaction', tampered),
      row('row-3', 'transaction', validTransaction('tx-3')),
    ];
    const { fetchFn, calls } = mockFetchSeq([
      { status: 200, body: { rows } },
      { status: 200, body: { ok: true } },
    ]);

    const result = await drainPlaidInbox(makeDeps({ financeSync: finance.client, fetch: fetchFn }));

    expect(result.drained).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].id).toBe('row-2');
    expect(result.errors[0].reason).toBe('invalid_shape');
    expect(finance.upserts.length).toBe(2);

    const ack = calls[1].body as { ids: string[] };
    expect(ack.ids).toEqual(['row-1', 'row-3']);
    expect(ack.ids).not.toContain('row-2');
  });

  it('skips row with missing required field', async () => {
    const finance = makeFinanceSync();
    const missingId = { ...validTransaction('whatever'), id: undefined };
    const rows = [row('row-1', 'transaction', missingId as Record<string, unknown>)];
    const { fetchFn } = mockFetchSeq([
      { status: 200, body: { rows } },
      { status: 200, body: { ok: true } },
    ]);
    const result = await drainPlaidInbox(makeDeps({ financeSync: finance.client, fetch: fetchFn }));
    expect(result.drained).toBe(0);
    expect(result.errors[0].reason).toBe('invalid_shape');
    expect(finance.upserts.length).toBe(0);
  });
});

describe('drainPlaidInbox · upsert failure', () => {
  it('row whose upsert throws → not in ack list → error captured', async () => {
    const finance = makeFinanceSync();
    finance.setThrowOn(['tx-2']);

    const rows = [
      row('row-1', 'transaction', validTransaction('tx-1')),
      row('row-2', 'transaction', validTransaction('tx-2')),
      row('row-3', 'transaction', validTransaction('tx-3')),
    ];
    const { fetchFn, calls } = mockFetchSeq([
      { status: 200, body: { rows } },
      { status: 200, body: { ok: true } },
    ]);

    const result = await drainPlaidInbox(makeDeps({ financeSync: finance.client, fetch: fetchFn }));

    expect(result.drained).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].id).toBe('row-2');
    expect(result.errors[0].reason).toBe('upsert_failed');

    const ack = calls[1].body as { ids: string[] };
    expect(ack.ids).toEqual(['row-1', 'row-3']);
  });
});

describe('drainPlaidInbox · missing auth', () => {
  it('authToken() returns null → no fetch calls, error result', async () => {
    const finance = makeFinanceSync();
    const { fetchFn, calls } = mockFetchSeq([]);

    const result = await drainPlaidInbox(makeDeps({
      financeSync: finance.client,
      fetch: fetchFn,
      authToken: () => null,
    }));

    expect(result.drained).toBe(0);
    expect(result.errors[0].reason).toBe('no_auth');
    expect(calls.length).toBe(0);
    expect(finance.upserts.length).toBe(0);
  });

  it('userId empty → no fetch calls, error result', async () => {
    const finance = makeFinanceSync();
    const { fetchFn, calls } = mockFetchSeq([]);
    const result = await drainPlaidInbox(makeDeps({
      financeSync: finance.client,
      fetch: fetchFn,
      userId: '',
    }));
    expect(result.drained).toBe(0);
    expect(result.errors[0].reason).toBe('no_auth');
    expect(calls.length).toBe(0);
  });
});

describe('drainPlaidInbox · empty inbox', () => {
  it('drain returns rows:[] → no upsert, no ack call, drained=0', async () => {
    const finance = makeFinanceSync();
    const { fetchFn, calls } = mockFetchSeq([
      { status: 200, body: { rows: [] } },
    ]);

    const result = await drainPlaidInbox(makeDeps({ financeSync: finance.client, fetch: fetchFn }));

    expect(result.drained).toBe(0);
    expect(result.errors).toEqual([]);
    expect(finance.upserts.length).toBe(0);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain('/inbox/drain');
  });
});

describe('drainPlaidInbox · network failure', () => {
  it('drain fetch rejects → error result, no ack call', async () => {
    const finance = makeFinanceSync();
    const { fetchFn, calls } = mockFetchSeq([
      { throw: new Error('connection refused') },
    ]);

    const result = await drainPlaidInbox(makeDeps({ financeSync: finance.client, fetch: fetchFn }));

    expect(result.drained).toBe(0);
    expect(result.errors[0].reason).toBe('network');
    expect(finance.upserts.length).toBe(0);
    // Only the drain attempt should have been made — no ack.
    expect(calls.length).toBe(1);
  });

  it('drain returns 500 → http_error, no upsert, no ack', async () => {
    const finance = makeFinanceSync();
    const { fetchFn, calls } = mockFetchSeq([
      { status: 500, body: { error: 'boom' } },
    ]);
    const result = await drainPlaidInbox(makeDeps({ financeSync: finance.client, fetch: fetchFn }));
    expect(result.drained).toBe(0);
    expect(result.errors[0].reason).toBe('http_error');
    expect(calls.length).toBe(1);
    expect(finance.upserts.length).toBe(0);
  });

  it('ack returns 500 → drain succeeded but ack error surfaced', async () => {
    const finance = makeFinanceSync();
    const rows = [row('row-1', 'transaction', validTransaction('tx-1'))];
    const { fetchFn, calls } = mockFetchSeq([
      { status: 200, body: { rows } },
      { status: 500, body: { error: 'boom' } },
    ]);
    const result = await drainPlaidInbox(makeDeps({ financeSync: finance.client, fetch: fetchFn }));
    expect(result.drained).toBe(1);
    expect(result.errors.some((e) => e.reason === 'http_error' && e.detail?.startsWith('ack'))).toBe(true);
    expect(calls.length).toBe(2);
    expect(finance.upserts.length).toBe(1);
  });
});

describe('drainPlaidInbox · tombstones', () => {
  it('tombstone row fans removed_ids out to upsertRecord(_deleted)', async () => {
    const finance = makeFinanceSync();
    const rows = [
      row('row-1', 'tombstones', { kind: 'tombstones', removed_ids: ['tx-9', 'tx-10'], ts: 1 }),
    ];
    const { fetchFn } = mockFetchSeq([
      { status: 200, body: { rows } },
      { status: 200, body: { ok: true } },
    ]);
    const result = await drainPlaidInbox(makeDeps({ financeSync: finance.client, fetch: fetchFn }));
    expect(result.drained).toBe(1);
    expect(finance.upserts.length).toBe(2);
    expect(finance.upserts[0].row).toMatchObject({ id: 'tx-9', _deleted: true });
    expect(finance.upserts[1].row).toMatchObject({ id: 'tx-10', _deleted: true });
  });
});

describe('drainPlaidInbox · sync_marker', () => {
  it('sync_marker row → acked but no upsert', async () => {
    const finance = makeFinanceSync();
    const rows = [
      row('row-1', 'sync_marker', { kind: 'sync_required', reason: 'DEFAULT_UPDATE', ts: 1 }),
    ];
    const { fetchFn, calls } = mockFetchSeq([
      { status: 200, body: { rows } },
      { status: 200, body: { ok: true } },
    ]);
    const result = await drainPlaidInbox(makeDeps({ financeSync: finance.client, fetch: fetchFn }));
    expect(result.drained).toBe(1);
    expect(finance.upserts.length).toBe(0);
    const ack = calls[1].body as { ids: string[] };
    expect(ack.ids).toEqual(['row-1']);
  });
});

describe('drainPlaidInbox · misconfiguration', () => {
  it('workerUrl empty → error result, no fetch', async () => {
    const finance = makeFinanceSync();
    const { fetchFn, calls } = mockFetchSeq([]);
    const result = await drainPlaidInbox(makeDeps({
      financeSync: finance.client, fetch: fetchFn, workerUrl: '',
    }));
    expect(result.drained).toBe(0);
    expect(result.errors[0].reason).toBe('network');
    expect(calls.length).toBe(0);
  });
});

