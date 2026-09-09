/**
 * Per-module migration retry (audit #4).
 *
 * The memoised migration promise must RESET on failure so a transient SQLite
 * error does not brick the module for the whole session. Before the fix the
 * rejected promise was cached forever and every later call re-threw the same
 * error, leaving the module permanently broken until app restart.
 *
 * body/migrate.ts is the representative; all 13 module migrate.ts files share
 * the identical memo+catch shape.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();

vi.mock('../../storage/sqlite', () => ({
  sql: {
    execute: (...args: unknown[]) => execute(...args),
  },
}));

import { migrateBody } from './migrate';

describe('migrateBody — failure resets the memo (#4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a transient failure is retried on the next call (not cached forever)', async () => {
    // First migration run: the very first statement throws.
    execute.mockRejectedValueOnce(new Error('SQLITE_BUSY'));

    await expect(migrateBody()).rejects.toThrow('SQLITE_BUSY');

    // Subsequent statements (and the retry) succeed.
    execute.mockResolvedValue({ rowsAffected: 0 });

    // The next call must RE-RUN the migration, not re-throw the cached error.
    await expect(migrateBody()).resolves.toBeUndefined();

    // Proof the retry actually executed statements (1 failed attempt + a full
    // successful pass over all MIGRATIONS).
    expect(execute.mock.calls.length).toBeGreaterThan(1);

    // And once it succeeds it is memoised — a further call is a cache hit.
    const afterSuccess = execute.mock.calls.length;
    await migrateBody();
    expect(execute.mock.calls.length).toBe(afterSuccess);
  });
});
