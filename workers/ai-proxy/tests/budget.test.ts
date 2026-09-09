/**
 * Audit H2 — global daily AI-spend ceiling. Per-user limits don't bound the
 * total across many accounts (signup-abuse); this circuit-breaker does.
 */

import { describe, it, expect, vi } from 'vitest';
import { checkGlobalBudget, GLOBAL_DAILY_AI_MAX_DEFAULT } from '../src/budget';

function makeKv(seed?: Record<string, string>): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>(seed ? Object.entries(seed) : []);
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true } as unknown as KVNamespaceListResult<unknown>;
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

const NOW = Date.parse('2026-06-29T12:00:00Z');
const KEY = 'budget:global:ai:production:2026-06-29';

describe('audit H2 · checkGlobalBudget', () => {
  it('allows + increments when under the ceiling', async () => {
    const kv = makeKv();
    const ok = await checkGlobalBudget(kv, { ENVIRONMENT: 'production' }, NOW);
    expect(ok).toBe(true);
    expect(kv.store.get(KEY)).toBe('1');
  });

  it('refuses once the ceiling is reached', async () => {
    const kv = makeKv({ [KEY]: String(GLOBAL_DAILY_AI_MAX_DEFAULT) });
    const ok = await checkGlobalBudget(kv, { ENVIRONMENT: 'production' }, NOW);
    expect(ok).toBe(false);
  });

  it('honours a custom GLOBAL_DAILY_AI_MAX', async () => {
    const kv = makeKv({ [KEY]: '5' });
    const ok = await checkGlobalBudget(
      kv,
      { ENVIRONMENT: 'production', GLOBAL_DAILY_AI_MAX: '5' },
      NOW,
    );
    expect(ok).toBe(false);
  });

  it('env-scopes the key so staging cannot consume prod budget', async () => {
    const kv = makeKv();
    await checkGlobalBudget(kv, { ENVIRONMENT: 'staging' }, NOW);
    expect(kv.store.has('budget:global:ai:staging:2026-06-29')).toBe(true);
    expect(kv.store.has(KEY)).toBe(false);
  });

  it('fails open on a KV error (per-user caps still apply)', async () => {
    const kv = makeKv();
    vi.spyOn(kv, 'get').mockRejectedValueOnce(new Error('kv down'));
    const ok = await checkGlobalBudget(kv, { ENVIRONMENT: 'production' }, NOW);
    expect(ok).toBe(true);
  });
});
