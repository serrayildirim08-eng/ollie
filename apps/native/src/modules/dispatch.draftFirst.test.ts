/**
 * Draft-first in the grey confidence zone (audit #9).
 *
 *   confidence >= 0.80  → write immediately (low-friction, write-then-undo)
 *   0.60–0.79           → DRAFT: not written by dispatch; applied only on keep
 *   < 0.60              → already dump_only at the worker (not needsConfirm)
 *
 * We assert dispatch's apply/skip decision via a spy handler, and that
 * applyFragment runs the handler for a confirmed draft.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// store + bridges are touched by the fire-and-forget post-dispatch sweep; stub
// them so the unit test stays focused on the apply/skip decision.
vi.mock('../store', () => ({ store: {} }));
vi.mock('../bridge', () => ({ runAllSyncs: async () => {} }));
vi.mock('./brain', () => ({ recomputeBrain: async () => {} }));
vi.mock('../bridge/mood', () => ({ recordMoodFromDump: async () => {} }));

import { dispatchRouterOutput, applyFragment } from './index';
import type { Fragment, RouterOutput } from '../router/schema';

function frag(over: Partial<Fragment>): Fragment {
  return {
    text: 'something',
    language: 'en',
    module: 'admin',
    payload: { module: 'admin', action: 'create_task', text: 'something' },
    confidence: 0.9,
    source: 'ai',
    ...over,
  } as Fragment;
}

function out(fragments: Fragment[]): RouterOutput {
  return {
    schemaVersion: '1.0',
    originalDump: 'd',
    dumpId: 'dump-1',
    timestamp: 0,
    language: 'en',
    fragments,
    summary: { moduleCount: {}, cacheHitRate: 0, aiCalls: 0, durationMs: 0 },
  };
}

let applied: string[];
const spyHandlers = {
  admin: {
    apply: vi.fn(async (f: Fragment) => {
      applied.push(f.text);
      return { ok: true, note: `wrote ${f.text}`, undo: async () => {} };
    }),
  },
};

beforeEach(() => {
  applied = [];
  spyHandlers.admin.apply.mockClear();
});

describe('dispatch · draft-first decision', () => {
  it('high confidence (needsConfirm false) is written immediately', async () => {
    const res = await dispatchRouterOutput(out([frag({ confidence: 0.9, needsConfirm: false })]), {
      handlers: spyHandlers,
    });
    expect(spyHandlers.admin.apply).toHaveBeenCalledTimes(1);
    expect(applied).toEqual(['something']);
    expect(res.entries[0].result.draft).toBeUndefined();
  });

  it('grey zone (needsConfirm true) is held as a draft, NOT written', async () => {
    const res = await dispatchRouterOutput(out([frag({ confidence: 0.7, needsConfirm: true })]), {
      handlers: spyHandlers,
    });
    expect(spyHandlers.admin.apply).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
    expect(res.entries[0].result.draft).toBe(true);
    expect(res.entries[0].result.ok).toBe(true);
  });

  it('a mixed dump writes the confident fragment and drafts the grey one', async () => {
    const res = await dispatchRouterOutput(
      out([
        frag({ text: 'sure thing', confidence: 0.95, needsConfirm: false }),
        frag({ text: 'maybe this', confidence: 0.7, needsConfirm: true }),
      ]),
      { handlers: spyHandlers },
    );
    expect(applied).toEqual(['sure thing']);
    expect(res.entries.find((e) => e.fragment.text === 'maybe this')!.result.draft).toBe(true);
  });

  it('applyFragment runs the handler when a draft is confirmed (keep)', async () => {
    const f = frag({ text: 'confirm me', confidence: 0.7, needsConfirm: true });
    const result = await applyFragment(f, { handlers: spyHandlers });
    expect(spyHandlers.admin.apply).toHaveBeenCalledTimes(1);
    expect(applied).toEqual(['confirm me']);
    expect(result.ok).toBe(true);
  });
});
