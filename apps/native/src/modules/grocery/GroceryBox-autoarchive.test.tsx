/**
 * GroceryBox · auto-archive idempotency (audit #134)
 *
 * The pantry auto-archive effect closes over the pantryItems snapshot and
 * fires pantryRepo.archive(id) for every row aged past shelfLife × 2.0. A
 * transient poll snapshot (or shelfTableTick / re-render) that still contains
 * an already-kicked-off row used to re-fire archive() for the same id. The fix
 * tracks in-flight archive ids in a ref so each id is archived at most once.
 *
 * Here we make refresh() KEEP returning the aged row (simulating a stale poll
 * snapshot that hasn't picked up archived_at_ms yet) and assert archive() is
 * still called exactly once for that id.
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../layout', () => ({
  Box: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties; [k: string]: unknown }) =>
    React.createElement("div", { style }, children),
  Stack: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  Row: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('../../ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) => React.createElement('span', null, children),
  Button: ({ children }: { children: React.ReactNode }) => React.createElement('button', null, children),
}));

vi.mock('../../theme/tokens', () => ({
  fonts: { serif: "serif", sans: "sans-serif", mono: "monospace" },
  radii: { none: "0", xs: "2px", sm: "4px", md: "8px", lg: "12px", small: "10px", card: "22px", surface: "28px", pill: "999px" },
  shadows: { none: "none", sm: "", md: "", lg: "", raised: "", raisedSm: "", inset: "", card: "" },
  colors: {
    paper: '#F4F1E8', hairline: 'rgba(20,20,15,0.10)', ink: '#14140F',
    inkFaint: '#9C9890', inkSoft: '#5A574E', sage: '#2E5D43', amber: '#B5762A',
  },
}));

vi.mock('./FeedMeView', () => ({
  FeedMeView: () => React.createElement('div', { 'data-testid': 'feed-me-stub' }),
}));

vi.mock('../../patterns/PatternCards', () => ({ PatternCards: () => null }));

// A known item with a 1-day shelf life so a >2-day-old row auto-archives.
vi.mock('./shelfLifeCache', () => ({
  loadShelfLifeTable: () => Promise.resolve(),
  lookupDays: () => 1,
  lookupCategory: () => null,
}));

vi.mock('./migrate', () => ({ migrateGrocery: async () => undefined }));

import type { PantryItem } from './types';

const listMock = vi.fn();
const listArchivedMock = vi.fn();
const listPredictedOutMock = vi.fn();
const shoppingListMock = vi.fn();
const archiveMock = vi.fn();

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
    archive: (id: string) => archiveMock(id),
    unarchive: vi.fn(),
    add: vi.fn(),
  },
  shopping: { list: () => shoppingListMock(), add: vi.fn(), remove: vi.fn() },
  cadence: { getCadenceFor: vi.fn().mockResolvedValue({ confidence: 'low-data', lastTs: null }) },
}));

import { GroceryBox } from './GroceryBox';

let container: HTMLDivElement;
let root: Root;

function agedRow(id: string, name: string): PantryItem {
  return {
    id,
    name,
    quantity: null,
    unit: null,
    // 3 days old → past 1-day shelf life × 2.0 → should_archive.
    addedAt: Date.now() - 3 * 86_400_000,
    lowFlag: false,
    archivedAtMs: null,
    predictedOutAtMs: null,
    remindMe: false,
    pushedAtMs: null,
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // refresh() ALWAYS returns the aged row — i.e. archived_at_ms never lands in
  // the snapshot (the worst-case transient poll the guard must tolerate).
  listMock.mockReset().mockResolvedValue([agedRow('milk-1', 'milk')]);
  listArchivedMock.mockReset().mockResolvedValue([]);
  listPredictedOutMock.mockReset().mockResolvedValue([]);
  shoppingListMock.mockReset().mockResolvedValue([]);
  archiveMock.mockReset().mockResolvedValue(undefined);
  try { sessionStorage.setItem('grocery:mode', 'pantry'); } catch { /* ok */ }
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  try { sessionStorage.removeItem('grocery:mode'); } catch { /* ok */ }
});

describe('GroceryBox auto-archive (#134)', () => {
  it('archives an aged row exactly ONCE even when the snapshot keeps returning it', async () => {
    act(() => { root.render(React.createElement(GroceryBox)); });
    // Let mount load + the auto-archive effect + its refresh + the re-render
    // it triggers all settle. Multiple flushes cover the chained promises.
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });

    // Despite refresh() repeatedly returning the same should_archive row, the
    // in-flight id guard means archive('milk-1') fired only once.
    const milkCalls = archiveMock.mock.calls.filter((c) => c[0] === 'milk-1');
    expect(milkCalls.length).toBe(1);
  });
});
