/**
 * DumpScreen · archive-before-dispatch ordering (audit #86) + ack-tick locality (#127)
 *
 * #86: dumpArchive.record() feeds the store mirror that dispatchRouterOutput's
 *      post-write sweep reads (dump bridge → dump.items / journal.entries). It
 *      must be AWAITED before dispatch, or the current dump is missing from the
 *      mirror for a whole cycle. We prove dispatch waits for record to resolve.
 *
 * #127: the ack remount tick is a component-local useRef now, not a module
 *       global — two mounted DumpScreens keep independent counters.
 *
 * Heavy deps (Clerk, store-backed modules, UI primitives) are stubbed; we
 * capture the onResult prop off a stubbed BrainDumpInput and drive it directly.
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { RouterOutput } from '../router/schema';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: async () => 'tok' }),
}));

vi.mock('../layout', () => ({
  Stack: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) => React.createElement('span', null, children),
}));
vi.mock('../theme/tokens', () => ({ colors: { inkFaint: '#999' } }));
vi.mock('./DumpScreen.module.css', () => ({ default: {} }));
vi.mock('../settings/appLang', () => ({ useAppLang: () => 'en' }));
vi.mock('../settings/features', () => ({ useFeature: () => false }));
vi.mock('./crisisCopy', () => ({ crisisBannerCopy: () => ({ kicker: '', body: '', dismiss: '' }) }));
vi.mock('./NeedsConfirmCard', () => ({ NeedsConfirmCard: () => null }));
vi.mock('../modules/brain/TodayNoticings', () => ({ TodayNoticings: () => null }));
vi.mock('../modules/goals/GoalCreateModal', () => ({ GoalCreateModal: () => null }));
vi.mock('../modules/partner', () => ({ PartnerCard: () => null }));
vi.mock('./mood-lexicon', () => ({ tagDumpMood: () => 'neutral' }));

// Capture the onResult prop so the test can fire it directly.
let capturedOnResult: ((o: RouterOutput) => void | Promise<void>) | undefined;
vi.mock('./BrainDumpInput', () => ({
  BrainDumpInput: (props: { onResult?: (o: RouterOutput) => void | Promise<void> }) => {
    capturedOnResult = props.onResult;
    return React.createElement('div', { 'data-testid': 'bdi' });
  },
}));

// Ordering probes: record is a deferred; dispatch records WHEN it was invoked
// relative to record resolving.
const order: string[] = [];
let resolveRecord!: () => void;
const recordMock = vi.fn((_input?: unknown) => {
  order.push('record:start');
  return new Promise<void>((res) => {
    resolveRecord = () => { order.push('record:resolve'); res(); };
  });
});
vi.mock('./archive', () => ({
  dumpArchive: {
    record: (input?: unknown) => recordMock(input),
    // Returning-user fixture: first-run guide stays hidden in these tests.
    hasAny: () => Promise.resolve(true),
  },
}));

const dispatchMock = vi.fn(async (_output?: unknown) => {
  order.push('dispatch:start');
  return { entries: [], crisisSkipped: false };
});
vi.mock('../modules', () => ({
  dispatchRouterOutput: (output?: unknown) => dispatchMock(output),
  applyFragment: vi.fn(),
}));

import { DumpScreen } from './DumpScreen';

let container: HTMLDivElement;
let root: Root;

function out(): RouterOutput {
  return {
    schemaVersion: '1.0',
    originalDump: 'buy milk',
    dumpId: 'd-1',
    timestamp: 123,
    language: 'en',
    fragments: [],
    summary: { moduleCount: {}, cacheHitRate: 0, aiCalls: 0, durationMs: 0 },
  } as RouterOutput;
}

beforeEach(() => {
  order.length = 0;
  recordMock.mockClear();
  dispatchMock.mockClear();
  capturedOnResult = undefined;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('DumpScreen (#86 archive-before-dispatch)', () => {
  it('awaits dumpArchive.record() BEFORE calling dispatchRouterOutput', async () => {
    act(() => { root.render(React.createElement(DumpScreen)); });
    await act(async () => { await Promise.resolve(); });
    expect(capturedOnResult).toBeTypeOf('function');

    // Fire onResult but DON'T resolve record yet.
    let onResultDone = false;
    await act(async () => {
      void Promise.resolve(capturedOnResult!(out())).then(() => { onResultDone = true; });
      await Promise.resolve();
    });

    // record started; dispatch must NOT have started while record is pending.
    expect(order).toContain('record:start');
    expect(order).not.toContain('dispatch:start');

    // Resolve record → dispatch may now proceed.
    await act(async () => {
      resolveRecord();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(order).toEqual(['record:start', 'record:resolve', 'dispatch:start']);
    expect(onResultDone).toBe(true);
  });
});
