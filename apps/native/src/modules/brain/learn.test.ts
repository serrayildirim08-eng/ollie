/**
 * Brain learn wiring · integration test
 *
 * Backs the `sql` shim with a real in-memory SQLite engine, synthesises raw
 * deferral + harm histories (we do NOT need real usage — the spec says
 * synthesise), then proves the Sprint-4 learning loop:
 *   - recomputeLearnedMap groups defers into buckets, links harm by domain,
 *     and persists a TRUSTED 'ok-to-defer' verdict at 5+ clean defers.
 *   - defers in a domain that saw harm flip the verdict to 'protect'.
 *   - < MIN_SAMPLE → 'unknown' → the resolver returns null (cold-start kept).
 *   - a finer bucket overrides the coarser once it has enough data.
 *   - a user pin (setPin) overrides both learned + cold-start.
 *   - the loaded resolver returns the right numeric deferability per candidate.
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const mockDb = new DatabaseSync(':memory:');

vi.mock('../../storage', () => ({
  sql: {
    async execute(query: string, params: unknown[] = []) {
      const res = mockDb.prepare(query).run(...(params as never[]));
      return { rowsAffected: Number(res.changes ?? 0) };
    },
    async select<T>(query: string, params: unknown[] = []): Promise<T[]> {
      return mockDb.prepare(query).all(...(params as never[])) as T[];
    },
  },
}));

import {
  recomputeLearnedMap,
  loadLearnedMap,
  makeDeferabilityResolver,
  setPin,
  bucketKeysFor,
  coarseBucketOf,
} from './learn';
import { migrateBrain } from './migrate';
import type { NoticingCandidate } from '@ollie/logic/brain';

const NOW = new Date('2026-06-08T12:00:00Z').getTime();

/** Insert a synthetic deferral event. */
function defer(noticingId: string, module: string | null, category: string | null): void {
  mockDb
    .prepare(
      `INSERT INTO brain_deferral_events (noticing_id, module, category, deferred_at, until_ms)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(noticingId, module, category, NOW, NOW + 86_400_000);
}

/** Insert a synthetic harm event. */
function harm(refKind: string, refId: string, harmKind: string): void {
  mockDb
    .prepare(
      `INSERT INTO brain_harm_events (id, ref_kind, ref_id, harm_kind, detected_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(`${harmKind}:${refKind}:${refId}`, refKind, refId, harmKind, NOW);
}

beforeEach(async () => {
  await migrateBrain();
  mockDb.exec('DELETE FROM brain_deferral_events');
  mockDb.exec('DELETE FROM brain_harm_events');
  mockDb.exec('DELETE FROM brain_learned_map');
  mockDb.exec('DELETE FROM brain_pins');
});

// ─── coarse bucketing ──────────────────────────────────────────────────────

describe('coarseBucketOf', () => {
  it('maps grocery / finance / admin / med signals onto stable domains', () => {
    expect(coarseBucketOf('grocery-replenish-needed', 'grocery')).toBe('groceries');
    expect(coarseBucketOf('spoiled', 'grocery')).toBe('groceries');
    expect(coarseBucketOf('bill_due', 'finance')).toBe('bills');
    expect(coarseBucketOf('late', 'finance')).toBe('bills');
    expect(coarseBucketOf('renewal', 'admin')).toBe('deadlines');
    expect(coarseBucketOf('missed', 'admin')).toBe('deadlines');
    expect(coarseBucketOf('dose', 'medication')).toBe('meds');
  });
});

// ─── DECISION 2 · cautious learning over real rows ─────────────────────────

describe('recomputeLearnedMap · cautious threshold + harm', () => {
  it('5+ clean defers of a category → trusted ok-to-defer', async () => {
    for (let i = 0; i < 6; i += 1) {
      defer(`grocery:grocery-replenish-needed`, 'grocery', 'grocery-replenish-needed');
    }
    const trusted = await recomputeLearnedMap(NOW);
    expect(trusted).toBeGreaterThanOrEqual(1);

    const map = await loadLearnedMap();
    expect(map.verdicts.groceries?.deferability).toBe('ok-to-defer');
  });

  it('< 5 defers → unknown → resolver returns null (cold-start kept)', async () => {
    for (let i = 0; i < 3; i += 1) {
      defer(`grocery:grocery-replenish-needed`, 'grocery', 'grocery-replenish-needed');
    }
    await recomputeLearnedMap(NOW);
    const map = await loadLearnedMap();
    expect(map.verdicts.groceries?.deferability ?? 'unknown').toBe('unknown');

    const resolve = makeDeferabilityResolver(map);
    const c: NoticingCandidate = { id: 'x', module: 'grocery', copy: 'milk', category: 'grocery-replenish-needed' };
    expect(resolve(c, 1)).toBeNull();
  });

  it('defers in a domain that saw harm flip to protect', async () => {
    // 6 bill defers, and 3 bills went late → harmRate 0.5 ≥ threshold.
    for (let i = 0; i < 6; i += 1) defer(`finance:bill_due`, 'finance', 'bill_due');
    harm('bill', 'b1', 'late');
    harm('bill', 'b2', 'late');
    harm('bill', 'b3', 'late');

    await recomputeLearnedMap(NOW);
    const map = await loadLearnedMap();
    expect(map.verdicts.bills?.deferability).toBe('protect');

    const resolve = makeDeferabilityResolver(map);
    const c: NoticingCandidate = { id: 'b', module: 'finance', copy: 'bill', category: 'bill_due' };
    expect(resolve(c, 1)).toBe(0); // protect → 0 on the scoring scale
  });
});

// ─── DECISION 1 · coarse→fine over real rows ───────────────────────────────

describe('recomputeLearnedMap · coarse→fine', () => {
  it('a finer item bucket (groceries:milk) overrides the coarser once it has enough data', async () => {
    // 6 defers each carry the item in the id tail → both groceries AND
    // groceries:milk reach threshold. Domain saw spoilage harm → both protect.
    for (let i = 0; i < 6; i += 1) {
      defer(`grocery:grocery-replenish-needed:milk`, 'grocery', 'grocery-replenish-needed');
    }
    harm('pantry', 'milk', 'spoiled');
    harm('pantry', 'milk2', 'spoiled');

    await recomputeLearnedMap(NOW);
    const map = await loadLearnedMap();
    expect(map.verdicts['groceries:milk']?.deferability).toBe('protect');

    const resolve = makeDeferabilityResolver(map);
    const milk: NoticingCandidate = {
      id: 'm', module: 'grocery', copy: 'milk',
      category: 'grocery-replenish-needed',
      facts: { items: ['milk'] },
    };
    expect(resolve(milk, 1)).toBe(0); // fine bucket protects this exact item
  });

  it('bucketKeysFor mints the fine bucket only when an item is named', () => {
    expect(bucketKeysFor({ id: 'a', module: 'grocery', copy: 'x', category: 'grocery-replenish-needed', facts: { items: ['milk'] } }))
      .toEqual({ coarse: 'groceries', fine: 'groceries:milk' });
    expect(bucketKeysFor({ id: 'b', module: 'grocery', copy: 'x', category: 'grocery-replenish-needed' }))
      .toEqual({ coarse: 'groceries', fine: null });
  });
});

// ─── DECISION 4 · user pin overrides everything ────────────────────────────

describe('setPin · the override', () => {
  it('a pin beats both learned + cold-start', async () => {
    // groceries learned ok-to-defer…
    for (let i = 0; i < 8; i += 1) defer(`grocery:grocery-replenish-needed`, 'grocery', 'grocery-replenish-needed');
    await recomputeLearnedMap(NOW);

    // …but the user pins "always protect groceries".
    await setPin('groceries', 'protect');

    const map = await loadLearnedMap();
    expect(map.verdicts.groceries?.deferability).toBe('ok-to-defer');
    expect(map.pins?.groceries).toBe('protect');

    const resolve = makeDeferabilityResolver(map);
    const c: NoticingCandidate = { id: 'g', module: 'grocery', copy: 'milk', category: 'grocery-replenish-needed' };
    expect(resolve(c, 1)).toBe(0); // pin wins → protect
  });

  it('setPin(null) clears the pin', async () => {
    await setPin('groceries', 'protect');
    await setPin('groceries', null);
    const map = await loadLearnedMap();
    expect(map.pins?.groceries).toBeUndefined();
  });
});
