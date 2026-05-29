import { describe, expect, it, vi } from 'vitest';
import { cacheLookup, invalidateCacheForUser, type VectorizeIndex } from '../src/router/vectorize';

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
