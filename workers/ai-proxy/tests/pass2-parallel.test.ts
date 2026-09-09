/**
 * Pass-2 segmentation parallelism (S2 · fix 1).
 *
 * Multiple pass-1 fragments flagged for LLM splitting must run CONCURRENTLY
 * (bounded), not serially — a multi-topic dump used to pay N × the Groq
 * round-trip. These tests drive `pass2SplitFragments` with an injected splitter
 * so we can observe call timing + ordering deterministically (no real network).
 *
 * Invariants asserted:
 *   - concurrency: 3 flagged fragments are all IN FLIGHT at once (all start
 *     before any resolves).
 *   - ordering: output fragment order matches input order regardless of which
 *     splitter call resolves first.
 *   - fallback: a splitter that throws (or returns []) falls back to the
 *     unsplit pass-1 fragment — never drops it.
 *   - unflagged fragments pass through untouched.
 *   - bounded: concurrency cap is respected (never more than N in flight).
 */

import { describe, it, expect, vi } from 'vitest';
import { pass2SplitFragments, type Pass2Candidate } from '../src/router/segmentation-llm';

const providers = { groq: 'k' } as never;

/** A splitter whose promises only resolve when we explicitly release them, so a
 *  test can prove all three calls were started before any finished. */
function makeGatedSplitter() {
  const releases: Array<() => void> = [];
  const started: string[] = [];
  const splitter = vi.fn((text: string) => {
    started.push(text);
    return new Promise<string[]>((resolve) => {
      releases.push(() => resolve([`${text}::a`, `${text}::b`]));
    });
  });
  return { splitter, started, releaseAll: () => releases.forEach((r) => r()) };
}

describe('pass2SplitFragments — concurrency', () => {
  it('runs all flagged fragments concurrently (all start before any resolves)', async () => {
    const { splitter, started, releaseAll } = makeGatedSplitter();
    const frags: Pass2Candidate[] = [
      { text: 'A', needsPass2: true },
      { text: 'B', needsPass2: true },
      { text: 'C', needsPass2: true },
    ];

    const promise = pass2SplitFragments(frags, providers, 4, splitter);
    // Let the microtask queue flush so all started splitter calls register.
    await Promise.resolve();
    await Promise.resolve();

    // All three were started before any was released → concurrent, not serial.
    expect(started).toEqual(['A', 'B', 'C']);

    releaseAll();
    const { fragmentsText, pass2Triggered } = await promise;
    expect(pass2Triggered).toBe(3);
    // Order preserved: A's split, then B's, then C's.
    expect(fragmentsText).toEqual(['A::a', 'A::b', 'B::a', 'B::b', 'C::a', 'C::b']);
  });

  it('preserves input order even when later calls resolve first', async () => {
    // Resolve in reverse order; output must still be input order.
    const splitter = vi.fn(async (text: string) => {
      const delay = text === 'first' ? 30 : text === 'second' ? 20 : 10;
      await new Promise((r) => setTimeout(r, delay));
      return [`${text}-x`, `${text}-y`];
    });
    const frags: Pass2Candidate[] = [
      { text: 'first', needsPass2: true },
      { text: 'second', needsPass2: true },
      { text: 'third', needsPass2: true },
    ];
    const { fragmentsText } = await pass2SplitFragments(frags, providers, 4, splitter);
    expect(fragmentsText).toEqual([
      'first-x', 'first-y', 'second-x', 'second-y', 'third-x', 'third-y',
    ]);
  });

  it('respects the concurrency cap (never more than N in flight)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const splitter = vi.fn(async (text: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return [text];
    });
    const frags: Pass2Candidate[] = Array.from({ length: 10 }, (_, i) => ({
      text: `f${i}`,
      needsPass2: true,
    }));
    await pass2SplitFragments(frags, providers, 4, splitter);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(splitter).toHaveBeenCalledTimes(10);
  });
});

describe('pass2SplitFragments — fallback + passthrough', () => {
  it('falls back to the unsplit fragment when the splitter throws', async () => {
    const splitter = vi.fn(async (text: string) => {
      if (text === 'B') throw new Error('provider exhausted');
      return [`${text}1`, `${text}2`];
    });
    const frags: Pass2Candidate[] = [
      { text: 'A', needsPass2: true },
      { text: 'B', needsPass2: true },
      { text: 'C', needsPass2: true },
    ];
    const { fragmentsText, pass2Triggered } = await pass2SplitFragments(frags, providers, 4, splitter);
    expect(pass2Triggered).toBe(3); // counts attempts, including the failed one
    expect(fragmentsText).toEqual(['A1', 'A2', 'B', 'C1', 'C2']);
  });

  it('falls back to the unsplit fragment when the splitter returns []', async () => {
    const splitter = vi.fn(async () => [] as string[]);
    const frags: Pass2Candidate[] = [{ text: 'solo', needsPass2: true }];
    const { fragmentsText } = await pass2SplitFragments(frags, providers, 4, splitter);
    expect(fragmentsText).toEqual(['solo']);
  });

  it('passes unflagged fragments through without calling the splitter', async () => {
    const splitter = vi.fn(async (text: string) => [`${text}!`]);
    const frags: Pass2Candidate[] = [
      { text: 'keep', needsPass2: false },
      { text: 'split', needsPass2: true },
      { text: 'keep2', needsPass2: false },
    ];
    const { fragmentsText, pass2Triggered } = await pass2SplitFragments(frags, providers, 4, splitter);
    expect(pass2Triggered).toBe(1);
    expect(splitter).toHaveBeenCalledTimes(1);
    expect(splitter).toHaveBeenCalledWith('split', providers);
    expect(fragmentsText).toEqual(['keep', 'split!', 'keep2']);
  });

  it('returns empty for an empty fragment list', async () => {
    const splitter = vi.fn();
    const { fragmentsText, pass2Triggered } = await pass2SplitFragments([], providers, 4, splitter);
    expect(fragmentsText).toEqual([]);
    expect(pass2Triggered).toBe(0);
    expect(splitter).not.toHaveBeenCalled();
  });
});
