/**
 * worker↔native module drift surfacing (audit #130).
 *
 * When the worker routes a fragment to a module the native app has no handler
 * for, the fragment is dropped (the raw dump is still archived). That drop used
 * to be a lone console.error nobody greps for. It must now SURFACE as
 * structured telemetry (+ a Sentry breadcrumb when an SDK is present) so the
 * drift is observable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// store + bridges are touched by the fire-and-forget post-dispatch sweep; stub
// them so the test stays focused on the no-handler branch.
vi.mock('../store', () => ({ store: {} }));
vi.mock('../bridge', () => ({ runAllSyncs: async () => {} }));
vi.mock('./brain', () => ({ recomputeBrain: async () => {} }));
vi.mock('../bridge/mood', () => ({ recordMoodFromDump: async () => {} }));

import { dispatchRouterOutput, reportNoHandlerDrift } from './index';
import type { Fragment, RouterOutput } from '../router/schema';

function driftFrag(): Fragment {
  // A module the native Module type / stubHandlers does NOT know about — i.e.
  // the worker drifted ahead. Cast through unknown to bypass the Module union.
  return {
    text: 'something the worker routed somewhere new',
    language: 'en',
    module: 'brandnewmodule' as unknown as Fragment['module'],
    payload: {} as Fragment['payload'],
    confidence: 0.95,
    source: 'ai',
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
  } as RouterOutput;
}

let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).Sentry;
});

describe('dispatch · no-handler drift (#130)', () => {
  it('drops the fragment to ok:false AND emits a structured telemetry metric', async () => {
    const res = await dispatchRouterOutput(out([driftFrag()]));
    // The fragment is surfaced as ok:false, not silently swallowed.
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].result.ok).toBe(false);
    expect(res.entries[0].result.note).toContain('no handler for brandnewmodule');

    // Telemetry: a structured `metric` line was logged (greppable + ingestible),
    // not just a free-text console.error.
    const metricCall = errSpy.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(String(c[0]));
        return parsed.metric === 'dispatch_no_handler';
      } catch {
        return false;
      }
    });
    expect(metricCall).toBeDefined();
    const parsed = JSON.parse(String(metricCall![0]));
    expect(parsed.module).toBe('brandnewmodule');
    expect(typeof parsed.ts).toBe('number');
    // No fragment TEXT leaks into telemetry.
    expect(String(metricCall![0])).not.toContain('something the worker routed');
  });

  it('drops a Sentry breadcrumb when a Sentry SDK is present on the global', () => {
    const addBreadcrumb = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Sentry = { addBreadcrumb };
    reportNoHandlerDrift('brandnewmodule');
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    const arg = addBreadcrumb.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.category).toBe('dispatch');
    expect((arg.data as Record<string, unknown>).module).toBe('brandnewmodule');
  });

  it('never throws when no Sentry SDK is present', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).Sentry;
    expect(() => reportNoHandlerDrift('brandnewmodule')).not.toThrow();
  });
});
