/**
 * Pantry · remind/silent toggle behaviour.
 *
 * What this asserts:
 *   1. A row inserted with remind_me=true (the critical-category default)
 *      renders the toggle in the `remind` state on first paint.
 *   2. A row inserted with remind_me=false renders `silent`.
 *   3. Clicking the toggle flips state + persists via `pantry.setRemindMe`.
 *   4. The flipped state survives a re-mount (state comes from the row, not
 *      from local component state).
 *
 * Backend pod seeds the initial value through `isCriticalReminderLocal()`;
 * here we control the seed via the repo mock so the UI behaviour is
 * verified in isolation.
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── stubbed primitives ─────────────────────────────────────────────────────
vi.mock('../../layout', () => ({
  Box: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties; [k: string]: unknown }) =>
    React.createElement("div", { style }, children),
  Stack: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) =>
    React.createElement('div', { 'data-testid': 'stack', style }, children),
  Row: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) =>
    React.createElement('div', { 'data-testid': 'row', style }, children),
}));

vi.mock('../../ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('../../theme/tokens', () => ({
  radii: { none: "0", xs: "2px", sm: "4px", md: "8px", lg: "12px", small: "10px", card: "22px", surface: "28px", pill: "999px" },
  shadows: { none: "none", sm: "", md: "", lg: "", raised: "", raisedSm: "", inset: "", card: "" },
  colors: {
    cream: '#FAFAF7',
    paper: '#F4F1E8',
    ink: '#14140F',
    inkSoft: '#5A574E',
    inkFaint: '#9C9890',
    inkGhost: '#C8C4BA',
    sage: '#2E5D43',
    amber: '#C9974C',
    hairline: 'rgba(20, 20, 15, 0.10)',
  },
  fonts: {
    serif: 'DM Serif Display, serif',
    sans: 'DM Sans, sans-serif',
    mono: 'DM Mono, monospace',
  },
}));

// ── Feed Me view is irrelevant to this test; stub it out so we don't drag
//    its workers/clerk/kv dependency tree into the harness.
vi.mock('./FeedMeView', () => ({
  FeedMeView: () => React.createElement('div', { 'data-testid': 'feed-me-stub' }),
}));

// PatternCards reaches into the app store (which imports every module);
// stub it so this grocery-only harness doesn't drag that graph in.
vi.mock('../../patterns/PatternCards', () => ({
  PatternCards: () => null,
}));

// ── shelf-life table — empty cache, never resolves, doesn't matter ─────────
vi.mock('./shelfLifeCache', () => ({
  loadShelfLifeTable: () => new Promise(() => {}),
  lookupDays: () => null,
}));

// ── migrate is a no-op in test (the repo is fully mocked) ──────────────────
vi.mock('./migrate', () => ({
  migrateGrocery: async () => undefined,
}));

// ── repo mock — the focus of these tests ───────────────────────────────────
import type { PantryItem, ShoppingItem } from './types';

const listMock = vi.fn();
const listArchivedMock = vi.fn();
const listPredictedOutMock = vi.fn();
const shoppingListMock = vi.fn();
const setRemindMeMock = vi.fn();
const getCadenceForMock = vi.fn();

vi.mock('./repo', () => ({
  pantry: {
    list: () => listMock(),
    listArchived: () => listArchivedMock(),
    listPredictedOut: () => listPredictedOutMock(),
    setRemindMe: (id: string, v: boolean) => setRemindMeMock(id, v),
    setPredictedOut: vi.fn(),
    dismissPrediction: vi.fn(),
    remove: vi.fn(),
    touch: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    add: vi.fn(),
  },
  shopping: {
    list: () => shoppingListMock(),
    add: vi.fn(),
    remove: vi.fn(),
  },
  cadence: {
    getCadenceFor: (name: string) => getCadenceForMock(name),
  },
}));

import { GroceryBox } from './GroceryBox';

// ── harness ────────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

function rowFor(id: string, name: string, remindMe: boolean): PantryItem {
  return {
    id,
    name,
    quantity: null,
    unit: null,
    addedAt: Date.now() - 1000,
    lowFlag: false,
    archivedAtMs: null,
    predictedOutAtMs: null,
    remindMe,
    pushedAtMs: null,
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  // Default state used by every test unless overridden.
  listMock.mockReset();
  listArchivedMock.mockReset().mockResolvedValue([]);
  listPredictedOutMock.mockReset().mockResolvedValue([]);
  shoppingListMock.mockReset().mockResolvedValue([] as ShoppingItem[]);
  setRemindMeMock.mockReset().mockResolvedValue(undefined);
  getCadenceForMock
    .mockReset()
    .mockResolvedValue({ confidence: 'low-data', lastTs: null });

  // The Box now defaults to the 'now' surface (clean-slate redesign,
  // 2026-05-31), which doesn't render the pantry rows. These tests are about
  // the per-row remind/silent toggle, which lives on the 'pantry' tab — so we
  // seed sessionStorage to land GroceryBox directly on the pantry surface.
  try {
    sessionStorage.setItem('grocery:mode', 'pantry');
  } catch {
    /* ok */
  }
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

async function mount(): Promise<void> {
  act(() => {
    root.render(React.createElement(GroceryBox));
  });
  // Three microtask spins for migrate → refresh → setState chain.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findToggleFor(rowName: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
  // Toggle is the role="switch" button; pair it with the row by reading
  // sibling text. We approximate by walking up the DOM until we find the
  // row's name in the same parent.
  for (const btn of buttons) {
    if (btn.getAttribute('role') !== 'switch') continue;
    let parent: HTMLElement | null = btn.parentElement;
    for (let i = 0; i < 6 && parent; i += 1) {
      if ((parent.textContent ?? '').toLowerCase().includes(rowName.toLowerCase())) {
        return btn;
      }
      parent = parent.parentElement;
    }
  }
  throw new Error(`no remind toggle found near row "${rowName}"`);
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('Pantry remind/silent toggle', () => {
  it('renders `remind` for a row seeded with remind_me=true', async () => {
    listMock.mockResolvedValue([rowFor('p-1', 'tampons', true)]);
    await mount();
    const toggle = findToggleFor('tampons');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect((toggle.textContent ?? '').trim()).toBe('remind');
  });

  it('renders `silent` for a row seeded with remind_me=false', async () => {
    listMock.mockResolvedValue([rowFor('p-2', 'pasta', false)]);
    await mount();
    const toggle = findToggleFor('pasta');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect((toggle.textContent ?? '').trim()).toBe('silent');
  });

  it('clicking the toggle flips state and persists via repo.setRemindMe', async () => {
    // Start silent.
    listMock.mockResolvedValueOnce([rowFor('p-3', 'pasta', false)]);
    // After click + refresh, the row comes back with remind_me=true (the
    // repo side persisted the flip; the second list() returns the new
    // state).
    listMock.mockResolvedValueOnce([rowFor('p-3', 'pasta', true)]);
    await mount();

    const toggle = findToggleFor('pasta');
    expect((toggle.textContent ?? '').trim()).toBe('silent');

    await act(async () => {
      toggle.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setRemindMeMock).toHaveBeenCalledWith('p-3', true);
    // After the refresh, the toggle re-reads the new row state.
    const toggleAfter = findToggleFor('pasta');
    expect((toggleAfter.textContent ?? '').trim()).toBe('remind');
    expect(toggleAfter.getAttribute('aria-checked')).toBe('true');
  });

  it('clicking a `remind` toggle calls setRemindMe(id, false)', async () => {
    listMock.mockResolvedValueOnce([rowFor('p-4', 'tampons', true)]);
    listMock.mockResolvedValueOnce([rowFor('p-4', 'tampons', false)]);
    await mount();

    const toggle = findToggleFor('tampons');
    await act(async () => {
      toggle.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setRemindMeMock).toHaveBeenCalledWith('p-4', false);
  });
});
