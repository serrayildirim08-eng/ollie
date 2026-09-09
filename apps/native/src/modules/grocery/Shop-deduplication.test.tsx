/**
 * Shop · "≈ likely needed" dedupe vs the active shopping list.
 *
 * If the same canonical is already on the active shopping list, the row must
 * NOT appear a second time in the ≈ section — that would read as a bug. The
 * dedupe happens in the component layer (the repo's listPredictedOut() is
 * source-pure and doesn't JOIN against shopping).
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── stubs ──────────────────────────────────────────────────────────────────
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
// stub it so this grocery-only harness doesn't drag that graph in.
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

vi.mock('./repo', () => ({
  pantry: {
    list: () => listMock(),
    listArchived: () => listArchivedMock(),
    listPredictedOut: () => listPredictedOutMock(),
    setRemindMe: vi.fn(),
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
    getCadenceFor: vi.fn().mockResolvedValue({ confidence: 'low-data', lastTs: null }),
  },
}));

import { GroceryBox } from './GroceryBox';

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
    predictedOutAtMs: Date.now() - 60_000,
    remindMe: false,
    pushedAtMs: null,
  };
}

function shopRow(id: string, name: string): ShoppingItem {
  return {
    id,
    name,
    quantity: null,
    unit: null,
    addedAt: Date.now() - 60_000,
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  listMock.mockReset().mockResolvedValue([]);
  listArchivedMock.mockReset().mockResolvedValue([]);
  listPredictedOutMock.mockReset();
  shoppingListMock.mockReset();

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

// ── tests ──────────────────────────────────────────────────────────────────

describe('Shop dedupe: predicted vs active shopping list', () => {
  it('hides a predicted row whose canonical is already on the shopping list', async () => {
    listPredictedOutMock.mockResolvedValue([predicted('p-1', 'eggs')]);
    shoppingListMock.mockResolvedValue([shopRow('s-1', 'eggs')]);

    await mount();

    // The ≈ section must not render — its only row was deduped out.
    expect(container.textContent ?? '').not.toContain('likely needed');
    // But the active shopping list still shows the row exactly once.
    const eggsOccurrences = (container.textContent ?? '').match(/eggs/gi)?.length ?? 0;
    expect(eggsOccurrences).toBe(1);
  });

  it('still shows other predicted rows when one is deduped', async () => {
    listPredictedOutMock.mockResolvedValue([
      predicted('p-1', 'eggs'),
      predicted('p-2', 'butter'),
    ]);
    shoppingListMock.mockResolvedValue([shopRow('s-1', 'eggs')]);

    await mount();

    // Section renders for butter.
    expect(container.textContent).toContain('likely needed');
    expect(container.textContent).toContain('butter');
    // Eggs appears only in the active list, not in the ≈ section.
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) =>
          (b.getAttribute('aria-label') ?? '').toLowerCase() === 'eggs — likely needed',
      ),
    ).toBe(false);
  });

  it('dedupe is case-insensitive', async () => {
    listPredictedOutMock.mockResolvedValue([predicted('p-1', 'Eggs')]);
    shoppingListMock.mockResolvedValue([shopRow('s-1', 'EGGS')]);

    await mount();
    expect(container.textContent ?? '').not.toContain('likely needed');
  });
});
