import { describe, expect, it, vi } from 'vitest';
import {
  cacheHitBump,
  cacheLookup,
  invalidateCacheForUser,
  type CacheRow,
  type VectorizeIndex,
} from '../src/router/vectorize';

const FAKE_EMBEDDING = new Array<number>(1024).fill(0.1);
const USER_ID = 'user_ttl_test';

function makeMatch(createdAt: number) {
  return {
    matches: [
      {
        id: 'entry-1',
        score: 0.95,
        metadata: {
          userId: USER_ID,
          module: 'grocery',
          payload: { action: 'pantry_add', item: 'milk' },
          confidence: 0.9,
          language: 'tr',
          hitCount: 3,
          lastHitAt: createdAt,
          createdAt,
        },
      },
    ],
    count: 1,
  };
}

describe('cacheLookup — TTL expiry', () => {
  it('returns null when createdAt is older than 30 days', async () => {
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const index: VectorizeIndex = {
      query: vi.fn(async () => makeMatch(thirtyOneDaysAgo)),
      upsert: vi.fn(async () => ({ mutationId: 'mut-1' })),
      deleteByIds: vi.fn(async () => ({ mutationId: 'mut-2' })),
    };

    const result = await cacheLookup(index, USER_ID, FAKE_EMBEDDING);
    expect(result).toBeNull();
  });

  it('returns the row when createdAt is within 30 days', async () => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const index: VectorizeIndex = {
      query: vi.fn(async () => makeMatch(oneDayAgo)),
      upsert: vi.fn(async () => ({ mutationId: 'mut-1' })),
      deleteByIds: vi.fn(async () => ({ mutationId: 'mut-2' })),
    };

    const result = await cacheLookup(index, USER_ID, FAKE_EMBEDDING);
    expect(result).not.toBeNull();
    expect(result?.module).toBe('grocery');
  });
});

describe('cacheLookup → cacheHitBump (S2 · fix 1: createdAt survives a bump)', () => {
  it('preserves the original createdAt so the entry is not self-expired', async () => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    // 1. Lookup returns a live entry created a day ago.
    const upserts: Array<{ metadata?: Record<string, unknown> }> = [];
    const index: VectorizeIndex = {
      query: vi.fn(async () => makeMatch(oneDayAgo)),
      upsert: vi.fn(async (vectors: Array<{ metadata?: Record<string, unknown> }>) => {
        upserts.push(vectors[0]);
        return { mutationId: 'mut-bump' };
      }),
      deleteByIds: vi.fn(async () => ({ mutationId: 'mut-2' })),
    };

    const row = (await cacheLookup(index, USER_ID, FAKE_EMBEDDING)) as CacheRow;
    expect(row).not.toBeNull();
    expect(row.createdAt).toBe(oneDayAgo);
    expect(row.hitCount).toBe(3);

    // 2. Bump the entry (the cache-hit path).
    await cacheHitBump(index, row, USER_ID, FAKE_EMBEDDING);

    const written = upserts[0]?.metadata ?? {};
    // createdAt unchanged — the bug zeroed/dropped it, expiring the entry.
    expect(written.createdAt).toBe(oneDayAgo);
    // hitCount advanced, lastHitAt refreshed.
    expect(written.hitCount).toBe(4);
    expect(typeof written.lastHitAt).toBe('number');
    expect(written.lastHitAt as number).toBeGreaterThan(oneDayAgo);

    // 3. A subsequent lookup over the bumped metadata still HITS (within TTL),
    //    proving the entry survives the bump instead of dying after one hit.
    const afterBump: VectorizeIndex = {
      query: vi.fn(async () => ({
        matches: [{ id: row.id, score: 0.95, metadata: written }],
        count: 1,
      })),
      upsert: vi.fn(async () => ({ mutationId: 'm' })),
      deleteByIds: vi.fn(async () => ({ mutationId: 'm' })),
    };
    const reHit = await cacheLookup(afterBump, USER_ID, FAKE_EMBEDDING);
    expect(reHit).not.toBeNull();
    expect(reHit?.createdAt).toBe(oneDayAgo);
  });
});

describe('invalidateCacheForUser', () => {
  it('queries by userId and deletes all returned ids', async () => {
    const deleteByIds = vi.fn(async () => ({ mutationId: 'del-1' }));
    const index: VectorizeIndex = {
      query: vi.fn(async () => ({
        matches: [
          { id: 'id-a', score: 0.5 },
          { id: 'id-b', score: 0.4 },
          { id: 'id-c', score: 0.3 },
        ],
        count: 3,
      })),
      upsert: vi.fn(async () => ({ mutationId: 'mut-1' })),
      deleteByIds,
    };

    const result = await invalidateCacheForUser(USER_ID, index);

    expect(result.deleted).toBe(3);
    expect(deleteByIds).toHaveBeenCalledOnce();
    expect(deleteByIds).toHaveBeenCalledWith(['id-a', 'id-b', 'id-c']);
  });

  it('returns { deleted: 0 } when no entries exist for user', async () => {
    const deleteByIds = vi.fn(async () => ({ mutationId: 'del-2' }));
    const index: VectorizeIndex = {
      query: vi.fn(async () => ({ matches: [], count: 0 })),
      upsert: vi.fn(async () => ({ mutationId: 'mut-1' })),
      deleteByIds,
    };

    const result = await invalidateCacheForUser(USER_ID, index);

    expect(result.deleted).toBe(0);
    expect(deleteByIds).not.toHaveBeenCalled();
  });
});
