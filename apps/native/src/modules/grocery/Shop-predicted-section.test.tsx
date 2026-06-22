/**
 * Shop · "≈ likely needed" section behaviour.
 *
 * What this asserts:
 *   1. Predicted-out items render under a section with the smcp
 *      "≈ likely needed" header + per-row "predicted from your pattern"
 *      italic caption.
 *   2. Tapping a row opens the inline `add to list` / `still have` choice.
 *   3. `add to list` calls shopping.add(name) + pantry.setPredictedOut(id, null)
 *      and the row vanishes from the ≈ section.
 *   4. `still have` calls pantry.dismissPrediction(id) and the row vanishes.
 *   5. Section header doesn't render when there are no predicted items.
 *
 * The Shop tab is selected via sessionStorage seeding (the component reads
 * it on first render) so we land directly on Shop without a mode click.
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── stubs (same shape as the other grocery harness files) ─────────────────
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

vi.mock('./FeedMeView', () => ({
  FeedMeView: () => React.createElement('div', { 'data-testid': 'feed-me-stub' }),
}));

// PatternCards reaches into the app store (which imports every module);
// stub it so this grocery-only harness doesn't drag that graph in. It
// renders nothing when there are no live patterns anyway.
vi.mock('../../patterns/PatternCards', () => ({
  PatternCards: () => null,
}));

vi.mock('./shelfLifeCache', () => ({
  loadShelfLifeTable: () => new Promise(() => {}),
  lookupDays: () => null,
}));

vi.mock('./migrate', () => ({
  migrateGrocery: async () => undefined,
}));

import type { PantryItem, ShoppingItem } from './types';

const listMock = vi.fn();
const listArchivedMock = vi.fn();
const listPredictedOutMock = vi.fn();
const shoppingListMock = vi.fn();
const shoppingAddMock = vi.fn();
const setPredictedOutMock = vi.fn();
const dismissPredictionMock = vi.fn();
const setRemindMeMock = vi.fn();

vi.mock('./repo', () => ({
  pantry: {
    list: () => listMock(),
    listArchived: () => listArchivedMock(),
    listPredictedOut: () => listPredictedOutMock(),
    setRemindMe: (id: string, v: boolean) => setRemindMeMock(id, v),
    setPredictedOut: (id: string, v: number | null) => setPredictedOutMock(id, v),
    dismissPrediction: (id: string) => dismissPredictionMock(id),
    remove: vi.fn(),
    touch: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    add: vi.fn(),
  },
  shopping: {
    list: () => shoppingListMock(),
    add: (input: unknown) => shoppingAddMock(input),
    remove: vi.fn(),
  },
  cadence: {
    getCadenceFor: vi.fn().mockResolvedValue({ confidence: 'low-data', lastTs: null }),
  },
}));

import { GroceryBox } from './GroceryBox';

// ── harness ────────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

function predicted(id: string, name: string): PantryItem {
  return {
    id,
    name,
    quantity: null,
    unit: null,
    addedAt: Date.now() - 14 * 86_400_000,
    lowFlag: false,
    archivedAtMs: null,
    predictedOutAtMs: Date.now() - 60_000, // already past now
    remindMe: false,
    pushedAtMs: null,
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  listMock.mockReset().mockResolvedValue([]);
  listArchivedMock.mockReset().mockResolvedValue([]);
  listPredictedOutMock.mockReset().mockResolvedValue([]);
  shoppingListMock.mockReset().mockResolvedValue([] as ShoppingItem[]);
  shoppingAddMock.mockReset().mockResolvedValue(undefined);
  setPredictedOutMock.mockReset().mockResolvedValue(undefined);
  dismissPredictionMock.mockReset().mockResolvedValue(undefined);
  setRemindMeMock.mockReset().mockResolvedValue(undefined);

  // Land directly on the Shop tab.
  try {
    sessionStorage.setItem('grocery:mode', 'shop');
  } catch {
    /* ok */
  }
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  try {
    sessionStorage.removeItem('grocery:mode');
  } catch {
    /* ok */
  }
});

async function mount(): Promise<void> {
  act(() => {
    root.render(React.createElement(GroceryBox));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findButton(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim().toLowerCase() === text.toLowerCase(),
  );
  if (!btn) throw new Error(`button with text "${text}" not found`);
  return btn as HTMLButtonElement;
}

function findRowExpander(name: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => {
    const text = (b.textContent ?? '').toLowerCase();
    const label = (b.getAttribute('aria-label') ?? '').toLowerCase();
    return text.includes(name.toLowerCase()) && label.includes('likely needed');
  });
  if (!btn) throw new Error(`no likely-needed row found for "${name}"`);
  return btn as HTMLButtonElement;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('Shop "≈ likely needed" section', () => {
  it('renders the section header + a row per predicted-out item', async () => {
    listPredictedOutMock.mockResolvedValue([
      predicted('p-1', 'eggs'),
      predicted('p-2', 'butter'),
    ]);
    await mount();

    expect(container.textContent).toContain('likely needed');
    expect(container.textContent).toContain('eggs');
    expect(container.textContent).toContain('butter');
    expect(container.textContent).toContain('predicted from your pattern');
  });

  it('does not render the section when there are no predicted items', async () => {
    listPredictedOutMock.mockResolvedValue([]);
    await mount();
    expect(container.textContent ?? '').not.toContain('likely needed');
  });

  it('tapping a row reveals the inline `add to list` / `still have` choice', async () => {
    listPredictedOutMock.mockResolvedValue([predicted('p-1', 'eggs')]);
    await mount();

    // Before tap: neither action button is in the DOM.
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) => (b.textContent ?? '').trim() === 'add to list',
      ),
    ).toBe(false);

    const row = findRowExpander('eggs');
    await act(async () => {
      row.click();
      await Promise.resolve();
    });

    // After tap: both choices are visible.
    expect(findButton('add to list')).toBeTruthy();
    expect(findButton('still have')).toBeTruthy();
  });

  it('`add to list` inserts a shopping row + clears the prediction', async () => {
    // First refresh: one predicted row, no shopping items.
    listPredictedOutMock.mockResolvedValueOnce([predicted('p-1', 'eggs')]);
    // Second refresh (after add): predicted gone, shopping has the row.
    listPredictedOutMock.mockResolvedValueOnce([]);
    shoppingListMock.mockResolvedValueOnce([]);
    shoppingListMock.mockResolvedValueOnce([
      {
        id: 's-1',
        name: 'eggs',
        quantity: null,
        unit: null,
        addedAt: Date.now(),
      },
    ]);

    await mount();
    await act(async () => {
      findRowExpander('eggs').click();
      await Promise.resolve();
    });

    await act(async () => {
      findButton('add to list').click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(shoppingAddMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'eggs' }),
    );
    expect(setPredictedOutMock).toHaveBeenCalledWith('p-1', null);
    // The ≈ section should be gone after the refresh (no predicted rows).
    expect(container.textContent ?? '').not.toContain('likely needed');
  });

  it('`still have` calls dismissPrediction and removes the row', async () => {
    listPredictedOutMock.mockResolvedValueOnce([predicted('p-2', 'butter')]);
    listPredictedOutMock.mockResolvedValueOnce([]);

    await mount();
    await act(async () => {
      findRowExpander('butter').click();
      await Promise.resolve();
    });

    await act(async () => {
      findButton('still have').click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dismissPredictionMock).toHaveBeenCalledWith('p-2');
    expect(shoppingAddMock).not.toHaveBeenCalled();
    expect(container.textContent ?? '').not.toContain('likely needed');
  });
});
