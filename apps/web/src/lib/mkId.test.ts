/**
 * mkId — shared ID generator tests.
 *
 * The reason mkId exists: the old `Date.now() + Math.random().slice()`
 * scheme could collide when two entities were created in the same
 * millisecond (the random suffix is short and the timestamp is shared).
 * mkId uses crypto.randomUUID — these tests assert it does not collide
 * under rapid creation and that the prefix contract holds.
 */
import { describe, it, expect } from 'vitest';
import { mkId } from './mkId';

describe('mkId', () => {
  it('produces unique IDs across many rapid calls', () => {
    const N = 10_000;
    const seen = new Set<string>();
    for (let i = 0; i < N; i++) seen.add(mkId());
    expect(seen.size).toBe(N);
  });

  it('produces unique IDs even with the same prefix in a tight loop', () => {
    // This is the exact scenario the old Date.now()-based scheme failed:
    // many creates within one millisecond.
    const N = 5_000;
    const seen = new Set<string>();
    for (let i = 0; i < N; i++) seen.add(mkId('task'));
    expect(seen.size).toBe(N);
  });

  it('prefixes the ID when a prefix is given', () => {
    const id = mkId('task');
    expect(id.startsWith('task-')).toBe(true);
  });

  it('returns a bare UUID with no leading dash when no prefix is given', () => {
    const id = mkId();
    expect(id.startsWith('-')).toBe(false);
    // RFC 4122 shape: 8-4-4-4-12 hex groups.
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('keeps the prefix and a UUID body separable', () => {
    const id = mkId('bill');
    const body = id.slice('bill-'.length);
    expect(body).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
