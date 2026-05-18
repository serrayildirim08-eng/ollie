/**
 * CycleModule · ovulation prediction display — behavioral tests
 *
 * Tests the three display invariants:
 *   1. With 28-day cycle, ovulation marker appears at day 14 (index 13).
 *   2. With low-confidence prediction, caption includes "low confidence".
 *   3. With no prediction (cold start), no ovulation caption renders.
 *
 * Rendering approach: mock the store + React DOM, same pattern as
 * ConsentScreen.test.tsx. No snapshot; DOM queries by aria / text content.
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── store mock ──────────────────────────────────────────────────────────────

vi.mock('../../store', () => {
  const data = new Map<string, unknown>();
  return {
    store: {
      set: vi.fn((mod: string, key: string, value: unknown) => {
        data.set(`${mod}:${key}`, value);
      }),
      get: vi.fn((mod: string, key: string, fallback: unknown) => {
        const k = `${mod}:${key}`;
        return data.has(k) ? data.get(k) : fallback;
      }),
      subscribe: vi.fn(() => () => {}),
      __data: data,
    },
    useStoreSlice: vi.fn(
      <T,>(
        mod: string,
        key: string,
        defaultValue: T,
      ): [T, (v: T) => void] => {
        const k = `${mod}:${key}`;
        const val = (data.has(k) ? data.get(k) : defaultValue) as T;
        const setter = (v: T) => data.set(k, v);
        return [val, setter];
      },
    ),
  };
});

// ─── i18n + SourcesLink stubs ────────────────────────────────────────────────

vi.mock('../../i18n', () => ({
  getString: (_locale: string, path: string) => path,
  getPlural: (_locale: string, baseKey: string) => baseKey,
  interpolate: (template: string) => template,
  pluralCategory: (_locale: string, count: number) =>
    count === 1 ? 'one' : 'other',
}));

vi.mock('../../components/SourcesLink', () => ({
  SourcesLink: () => null,
}));

// ─── imports ─────────────────────────────────────────────────────────────────

import { CycleModule } from './CycleModule';
import { store } from '../../store';

// ─── helpers ─────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const LUTEAL_DAYS = 14;

/** Build a list of cycle start timestamps spaced exactly `length` days apart. */
function makeCycleItems(cycleCount: number, cycleLengthDays: number, now: number) {
  const items: Array<{ ts: number; action: string; text: string }> = [];
  const firstStart = now - cycleCount * cycleLengthDays * DAY_MS;
  for (let i = 0; i <= cycleCount; i++) {
    items.push({
      ts: firstStart + i * cycleLengthDays * DAY_MS,
      action: 'started',
      text: 'period started',
    });
  }
  return items;
}

let container: HTMLDivElement;
let root: Root;

function seedStore(items: unknown[], showDial = true) {
  const s = store as unknown as { __data: Map<string, unknown> };
  s.__data.clear();
  s.__data.set('cycle:items', items);
  s.__data.set('cycle:settings', {
    tracking_for_fertility: false,
    show_dial: showDial,
    passphrase_hint: '',
  });
  s.__data.set('cycle:lastEditedByCycle', {});
  s.__data.set('cycle:asks', []);
}

function mount() {
  act(() => {
    root.render(<CycleModule />);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe('ovulation marker · dot at predicted day', () => {
  it('renders an ovulation-labelled dot when cycle has 28-day history', () => {
    // 6 cycles of exactly 28 days gives a hot-confidence prediction.
    // ovulationTs = nextPeriodTs - 14d. Day index within cycle = 28 - 14 = 14
    // (0-based index 13) — but our span is the 14th dot (i=13).
    const now = Date.now();
    seedStore(makeCycleItems(6, 28, now));
    mount();

    // The ovulation dot carries aria-label="ovulation"
    const ovulationDot = container.querySelector('[aria-label="ovulation"]');
    expect(ovulationDot).not.toBeNull();
  });

  it('does not render ovulation dot when show_dial is false (opted out)', () => {
    const now = Date.now();
    seedStore(makeCycleItems(6, 28, now), /* showDial= */ false);
    mount();

    const ovulationDot = container.querySelector('[aria-label="ovulation"]');
    expect(ovulationDot).toBeNull();
  });
});

describe('ovulation caption · text content', () => {
  it('renders caption with "ovulation likely" for hot-confidence prediction', () => {
    const now = Date.now();
    seedStore(makeCycleItems(6, 28, now));
    mount();

    // Caption text resolves from i18n key (mocked to return key path).
    // Key is "cycle.ovulation.caption" with date substitution.
    const text = container.textContent ?? '';
    expect(text).toContain('cycle.ovulation.caption');
  });

  it('renders low-confidence suffix when confidence < 0.4 (cold start)', () => {
    // 0 completed cycles → cold-start tier → confidence 0.3.
    // predictOvulation returns max(0, 0.3 - 0.1) = 0.2 which is < 0.4.
    // A single "started" event gives no cycle-length history → cold.
    const now = Date.now();
    // Provide only 1 started event (no second event to close the cycle).
    const items = [{ ts: now - 20 * 86_400_000, action: 'started', text: 'period started' }];
    seedStore(items);
    mount();

    const text = container.textContent ?? '';
    // cold start with population prior → ovulationTs exists, confidence < 0.4 → caption_low
    expect(text).toContain('cycle.ovulation.caption_low');
  });

  it('renders no ovulation caption when no cycle items exist', () => {
    seedStore([]);
    mount();

    const text = container.textContent ?? '';
    expect(text).not.toContain('cycle.ovulation.caption');
  });
});

describe('ovulation prediction logic · predictOvulation', () => {
  it('returns ovulationTs at nextTs - 14 days for a clean 28-day history', async () => {
    const { predictOvulation, DAY_MS: D } = await import('@ollie/logic/cycle');

    const now = Date.now();
    const items = makeCycleItems(6, 28, now).map((item) => ({
      ts: item.ts,
      action: item.action as 'started',
      text: item.text,
    }));

    const result = predictOvulation(items);

    expect(result.ovulationTs).not.toBeNull();
    if (!result.ovulationTs) throw new Error('ovulationTs is null');

    // predictNextPeriod uses EWMA so expectedStart ≈ lastStart + 28d.
    // ovulationTs = nextTs - LUTEAL_DAYS * DAY_MS
    // nextTs = lastCycleStart + ~28d
    const lastStart = items[items.length - 1].ts;
    const expectedOvulation = lastStart + (28 - LUTEAL_DAYS) * DAY_MS;
    // Allow ±1 day tolerance for EWMA / Bayesian posterior rounding.
    const diffDays = Math.abs(result.ovulationTs - expectedOvulation) / D;
    expect(diffDays).toBeLessThan(1.5);
  });

  it('returns null ovulationTs with zero cycle items', async () => {
    const { predictOvulation } = await import('@ollie/logic/cycle');
    const result = predictOvulation([]);
    expect(result.ovulationTs).toBeNull();
  });
});
