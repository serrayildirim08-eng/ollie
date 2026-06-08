/**
 * Brain copy + actions · integration test (Sprint 3 "speak in your words")
 *
 * Backs the `sql` shim with a real in-memory SQLite engine and mocks the
 * ai-proxy worker + the app-language setting. Proves Serra's 3 decisions:
 *
 *   D1 (voice): the copy comes from the AI when available, in the user's app
 *       language, one calm sentence; falls back to the clean trilingual
 *       hardcoded sentence when the AI is off (mocked-unavailable).
 *   D2 (offers act): accepting the milk noticing ACTUALLY adds milk to the
 *       grocery shopping list (executeAction → grocery shopping.add).
 *   D3 (trilingual): the app-language setting selects EN/ES/TR for copy +
 *       fallback.
 *   + cache: copy is generated at most once per (noticing, day, lang) — a
 *       second resolve does NOT re-call the AI.
 */

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// ── ai-proxy worker mock ──
const routeBrainCopyMock = vi.fn();
vi.mock('../../api/workers', () => ({
  routeBrainCopy: (...args: unknown[]) => routeBrainCopyMock(...args),
}));

// ── app-language setting mock (store-backed in prod) ──
let appLang: 'en' | 'es' | 'tr' = 'en';
vi.mock('../../settings/appLang', () => ({
  getAppLang: () => appLang,
}));

import type { ScoredNoticing } from '@ollie/logic/brain';
import { migrateBrain } from './migrate';
import { migrateGrocery } from '../grocery/migrate';
import { shopping } from '../grocery/repo';
import { resolveNoticingCopy, actionForNoticing, factsForNoticing } from './copy';
import { executeAction } from './actions';

const NOW = new Date('2026-06-08T12:00:00Z').getTime();
const DAY = 86_400_000;

/** The milk/replenish noticing, as the selector would hand it over. */
function milkNoticing(overrides: Partial<ScoredNoticing> = {}): ScoredNoticing {
  return {
    id: 'grocery:grocery-replenish-needed',
    module: 'grocery',
    copy: "your milk's probably run low — want it back on the list?",
    category: 'grocery-replenish-needed',
    urgencyAt: NOW - DAY,
    createdAt: NOW - DAY,
    facts: { items: ['milk'], days: 1 },
    score: 1.5,
    parts: { urgency: 0.5, deferability: 1 },
    ...overrides,
  };
}

beforeEach(async () => {
  await migrateBrain();
  await migrateGrocery();
  mockDb.exec('DELETE FROM brain_copy_cache');
  mockDb.exec('DELETE FROM grocery_shopping');
  mockDb.exec('DELETE FROM grocery_pantry');
  routeBrainCopyMock.mockReset();
  appLang = 'en';
});

describe('D1 — AI copy when available, in app language', () => {
  it('uses the AI sentence when the worker succeeds', async () => {
    routeBrainCopyMock.mockResolvedValueOnce({
      ok: true,
      data: { text: 'you’re probably out of milk. want it back on the list?', source: 'ai' },
      status: 200,
    });
    const copy = await resolveNoticingCopy(milkNoticing(), { bearer: 'jwt', now: NOW });
    expect(copy).toBe('you’re probably out of milk. want it back on the list?');
    expect(routeBrainCopyMock).toHaveBeenCalledTimes(1);
    // The prompt handed to the worker is the calm/neutral one + EN.
    const [req] = routeBrainCopyMock.mock.calls[0]!;
    expect(req.lang).toBe('en');
    expect(req.system.toLowerCase()).toContain('calm');
  });

  it('FALLS BACK to the clean hardcoded sentence when the AI errors', async () => {
    routeBrainCopyMock.mockResolvedValueOnce({ ok: false, error: { code: 'network', message: 'offline' } });
    const copy = await resolveNoticingCopy(milkNoticing(), { bearer: 'jwt', now: NOW });
    expect(copy).toBe("you're probably out of milk. want it back on the list?");
  });

  it('FALLS BACK with no bearer (offline / signed-out) without calling AI', async () => {
    const copy = await resolveNoticingCopy(milkNoticing(), { bearer: null, now: NOW });
    expect(copy).toBe("you're probably out of milk. want it back on the list?");
    expect(routeBrainCopyMock).not.toHaveBeenCalled();
  });

  it('FALLS BACK when the AI returns empty text', async () => {
    routeBrainCopyMock.mockResolvedValueOnce({ ok: true, data: { text: '   ', source: 'static_fallback' }, status: 200 });
    const copy = await resolveNoticingCopy(milkNoticing(), { bearer: 'jwt', now: NOW });
    expect(copy).toContain('milk');
  });
});

describe('D3 — app language selects EN / ES / TR for copy + fallback', () => {
  it('resolves all three fallback languages', async () => {
    const en = await resolveNoticingCopy(milkNoticing(), { lang: 'en', bearer: null, now: NOW });
    const es = await resolveNoticingCopy(milkNoticing(), { lang: 'es', bearer: null, now: NOW });
    const tr = await resolveNoticingCopy(milkNoticing(), { lang: 'tr', bearer: null, now: NOW });
    expect(en).toBe("you're probably out of milk. want it back on the list?");
    expect(es).toContain('¿lo pongo en la lista?');
    expect(tr).toContain('listene ekleyeyim mi?'); // Serra's locked TR shape
  });

  it('defaults to the stored app-language setting when none passed', async () => {
    appLang = 'tr';
    const copy = await resolveNoticingCopy(milkNoticing(), { bearer: null, now: NOW });
    expect(copy).toContain('listene ekleyeyim mi?');
  });
});

describe('cache — at most once per (noticing, day, lang)', () => {
  it('does NOT re-call the AI on a second resolve the same day', async () => {
    routeBrainCopyMock.mockResolvedValueOnce({ ok: true, data: { text: 'AI milk line', source: 'ai' }, status: 200 });
    const first = await resolveNoticingCopy(milkNoticing(), { bearer: 'jwt', now: NOW });
    const second = await resolveNoticingCopy(milkNoticing(), { bearer: 'jwt', now: NOW + 60_000 });
    expect(first).toBe('AI milk line');
    expect(second).toBe('AI milk line');
    expect(routeBrainCopyMock).toHaveBeenCalledTimes(1); // cached — no re-call
  });

  it('re-generates the next calendar day', async () => {
    routeBrainCopyMock
      .mockResolvedValueOnce({ ok: true, data: { text: 'day one', source: 'ai' }, status: 200 })
      .mockResolvedValueOnce({ ok: true, data: { text: 'day two', source: 'ai' }, status: 200 });
    const d1 = await resolveNoticingCopy(milkNoticing(), { bearer: 'jwt', now: NOW });
    const d2 = await resolveNoticingCopy(milkNoticing(), { bearer: 'jwt', now: NOW + DAY });
    expect(d1).toBe('day one');
    expect(d2).toBe('day two');
    expect(routeBrainCopyMock).toHaveBeenCalledTimes(2);
  });

  it('caches per language independently', async () => {
    // EN cached as fallback (no bearer) shouldn't satisfy a TR resolve.
    await resolveNoticingCopy(milkNoticing(), { lang: 'en', bearer: null, now: NOW });
    const tr = await resolveNoticingCopy(milkNoticing(), { lang: 'tr', bearer: null, now: NOW });
    expect(tr).toContain('listene ekleyeyim mi?');
  });
});

describe('D2 — accepting the offer really acts', () => {
  it('exposes a localised add-to-list action for the milk noticing', () => {
    const action = actionForNoticing(milkNoticing(), 'tr');
    expect(action).not.toBeNull();
    expect(action!.kind).toBe('add_to_grocery_list');
    expect(action!.label).toBe('listeye ekle');
    expect(action!.payload).toEqual({ kind: 'add_to_grocery_list', names: ['milk'] });
  });

  it('executeAction ACTUALLY inserts milk into the grocery shopping list', async () => {
    const action = actionForNoticing(milkNoticing(), 'en')!;
    const before = await shopping.list();
    expect(before.find((i) => i.name === 'milk')).toBeUndefined();

    const ok = await executeAction(action);
    expect(ok).toBe(true);

    const after = await shopping.list();
    expect(after.find((i) => i.name === 'milk')).toBeDefined();
  });

  it('adds every item for a multi-item replenish', async () => {
    const n = milkNoticing({ facts: { items: ['milk', 'eggs'], days: 2 } });
    const action = actionForNoticing(n, 'en')!;
    const ok = await executeAction(action);
    expect(ok).toBe(true);
    const after = await shopping.list();
    const names = after.map((i) => i.name);
    expect(names).toContain('milk');
    expect(names).toContain('eggs');
  });

  it('no action for a non-actionable noticing', () => {
    const deadline = milkNoticing({
      id: 'admin:deadline',
      module: 'admin',
      category: 'deadline_passed',
      facts: null,
    });
    expect(actionForNoticing(deadline, 'en')).toBeNull();
  });
});

describe('factsForNoticing', () => {
  it('derives kind/item/days/action from the candidate', () => {
    const facts = factsForNoticing(milkNoticing());
    expect(facts).toEqual({ kind: 'replenish', item: 'milk', days: 1, otherCount: null, action: 'add_to_grocery_list' });
  });
});
