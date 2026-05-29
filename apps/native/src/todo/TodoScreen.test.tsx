/**
 * TodoScreen · behavior tests.
 *
 * Mirrors the createRoot + act pattern from FocusTimer.test.tsx — no
 * @testing-library. Each module's repo is mocked at the barrel layer so
 * the screen can be exercised without SQLite + without the real module
 * implementations.
 *
 * Coverage:
 *   - aggregates rows across admin / work / grocery into a bullet list
 *   - empty state renders the editorial copy
 *   - clicking a row routes to the right module's markComplete
 *   - the optimistic fade removes the row from the rendered tree
 *   - admin paperwork rows don't appear (verified via the aggregator,
 *     not duplicated here)
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── module mocks ──────────────────────────────────────────────────────────
//
// We mock the module BARRELS rather than the underlying repo.ts files so
// the screen's `import { tasks as adminTasksRepo } from '../modules/admin'`
// resolves cleanly. Each barrel exports both the repo + the migrate fn
// the screen calls on mount.

vi.mock('../modules/admin', () => {
  const tasks = {
    listOpen: vi.fn().mockResolvedValue([]),
    markComplete: vi.fn().mockResolvedValue(undefined),
  };
  const renewals = {
    listOpen: vi.fn().mockResolvedValue([]),
    markComplete: vi.fn().mockResolvedValue(undefined),
  };
  return {
    migrateAdmin: vi.fn().mockResolvedValue(undefined),
    tasks,
    renewals,
  };
});

vi.mock('../modules/work', () => {
  const tasks = {
    listOpen: vi.fn().mockResolvedValue([]),
    markComplete: vi.fn().mockResolvedValue(undefined),
  };
  return {
    migrateWork: vi.fn().mockResolvedValue(undefined),
    tasks,
  };
});

vi.mock('../modules/grocery', () => {
  const shopping = {
    listOpen: vi.fn().mockResolvedValue([]),
    markPurchased: vi.fn().mockResolvedValue(undefined),
  };
  return {
    migrateGrocery: vi.fn().mockResolvedValue(undefined),
    shopping,
  };
});

vi.mock('../layout', () => ({
  Stack: ({ children, as: Tag = 'div', style }: { children: React.ReactNode; as?: React.ElementType; style?: React.CSSProperties }) =>
    React.createElement(Tag, { 'data-stack': true, style }, children),
  Row: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) =>
    React.createElement('div', { 'data-row': true, style }, children),
}));

vi.mock('../ui', () => ({
  Text: ({ children, style, ...rest }: { children: React.ReactNode; style?: React.CSSProperties; [k: string]: unknown }) =>
    React.createElement('span', { style, ...rest }, children),
}));

vi.mock('../theme/tokens', () => ({
  colors: {
    ink: '#14140F',
    inkSoft: '#5A574E',
    inkFaint: '#9C9890',
    inkGhost: '#C8C4BA',
    sage: '#2E5D43',
    sageSoft: '#5A574E',
    hairline: 'rgba(20,20,15,0.10)',
    hairlineSoft: 'rgba(20,20,15,0.05)',
    paper: '#F4F1E8',
    cream: '#FAFAF7',
  },
  durations: { tap: '120ms', fade: '200ms' },
  easings: { calmOut: 'cubic-bezier(0.18,0,0.22,1)' },
}));

import { TodoScreen } from './TodoScreen';
import * as adminMod from '../modules/admin';
import * as workMod from '../modules/work';
import * as groceryMod from '../modules/grocery';

// ─── helpers ──────────────────────────────────────────────────────────────

const mockAdminTasksListOpen = adminMod.tasks.listOpen as ReturnType<typeof vi.fn>;
const mockAdminTasksMarkComplete = adminMod.tasks.markComplete as ReturnType<typeof vi.fn>;
const mockAdminRenewalsListOpen = adminMod.renewals.listOpen as ReturnType<typeof vi.fn>;
const mockAdminRenewalsMarkComplete = adminMod.renewals.markComplete as ReturnType<typeof vi.fn>;
const mockWorkListOpen = workMod.tasks.listOpen as ReturnType<typeof vi.fn>;
const mockWorkMarkComplete = workMod.tasks.markComplete as ReturnType<typeof vi.fn>;
const mockGroceryListOpen = groceryMod.shopping.listOpen as ReturnType<typeof vi.fn>;
const mockGroceryMarkPurchased = groceryMod.shopping.markPurchased as ReturnType<typeof vi.fn>;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  mockAdminTasksListOpen.mockReset().mockResolvedValue([]);
  mockAdminTasksMarkComplete.mockReset().mockResolvedValue(undefined);
  mockAdminRenewalsListOpen.mockReset().mockResolvedValue([]);
  mockAdminRenewalsMarkComplete.mockReset().mockResolvedValue(undefined);
  mockWorkListOpen.mockReset().mockResolvedValue([]);
  mockWorkMarkComplete.mockReset().mockResolvedValue(undefined);
  mockGroceryListOpen.mockReset().mockResolvedValue([]);
  mockGroceryMarkPurchased.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderScreen(): void {
  act(() => {
    root.render(React.createElement(TodoScreen));
  });
}

/** flush microtasks so the screen's mount Promises resolve. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ─── tests ────────────────────────────────────────────────────────────────

describe('TodoScreen', () => {
  it('renders the empty-state copy when no module has open rows', async () => {
    renderScreen();
    await settle();

    const empty = container.querySelector('[data-testid="todo-empty"]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain('brain dump something to fill it');
  });

  it('aggregates rows from admin tasks, admin renewals, work, and grocery', async () => {
    mockAdminTasksListOpen.mockResolvedValue([
      {
        id: 'a1',
        kind: 'phone',
        text: 'mom',
        data: { kind: 'phone', reason: 'christmas' },
        done: false,
        createdAt: 1_700_000_000_000,
      },
    ]);
    mockAdminRenewalsListOpen.mockResolvedValue([
      {
        id: 'r1',
        renewalType: 'passport',
        dueDate: null,
        addedAt: 1_700_000_000_000,
      },
    ]);
    mockWorkListOpen.mockResolvedValue([
      {
        id: 'w1',
        text: 'send invoice',
        project: null,
        kind: 'task',
        dueDate: null,
        done: false,
        createdAt: 1_700_000_000_000,
      },
    ]);
    mockGroceryListOpen.mockResolvedValue([
      {
        id: 'g1',
        name: 'milk',
        quantity: null,
        unit: null,
        addedAt: 1_700_000_000_000,
      },
    ]);

    renderScreen();
    await settle();

    const rows = container.querySelectorAll('[data-testid^="todo-row-"]');
    const ids = Array.from(rows).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(
      expect.arrayContaining([
        'todo-row-admin:a1',
        'todo-row-admin:r1',
        'todo-row-work:w1',
        'todo-row-grocery:g1',
      ]),
    );
    expect(ids).toHaveLength(4);

    // Display copy for the phone row is normalized.
    const phoneRow = container.querySelector('[data-testid="todo-row-admin:a1"]');
    expect(phoneRow!.textContent).toContain('call mom about christmas');
  });

  it('clicking a grocery row routes to shopping.markPurchased and fades the row', async () => {
    mockGroceryListOpen.mockResolvedValue([
      {
        id: 'g1',
        name: 'milk',
        quantity: null,
        unit: null,
        addedAt: 1_700_000_000_000,
      },
    ]);
    renderScreen();
    await settle();

    const trigger = container.querySelector(
      '[data-testid="todo-row-grocery:g1"] [role="button"]',
    ) as HTMLElement;
    expect(trigger).not.toBeNull();

    act(() => {
      trigger.click();
    });
    await settle();

    expect(mockGroceryMarkPurchased).toHaveBeenCalledWith('g1');
    expect(mockAdminTasksMarkComplete).not.toHaveBeenCalled();
    expect(mockWorkMarkComplete).not.toHaveBeenCalled();

    // After the FADE_OUT_MS (200ms) timer fires the row drops from state.
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await settle();
    const stillThere = container.querySelector('[data-testid="todo-row-grocery:g1"]');
    expect(stillThere).toBeNull();
  });

  it('clicking an admin renewal routes to renewals.markComplete (not tasks)', async () => {
    mockAdminRenewalsListOpen.mockResolvedValue([
      {
        id: 'r1',
        renewalType: 'lease',
        dueDate: null,
        addedAt: 1_700_000_000_000,
      },
    ]);
    renderScreen();
    await settle();

    const trigger = container.querySelector(
      '[data-testid="todo-row-admin:r1"] [role="button"]',
    ) as HTMLElement;
    act(() => { trigger.click(); });
    await settle();

    expect(mockAdminRenewalsMarkComplete).toHaveBeenCalledWith('r1');
    expect(mockAdminTasksMarkComplete).not.toHaveBeenCalled();
  });

  it('clicking a work task routes to work.tasks.markComplete', async () => {
    mockWorkListOpen.mockResolvedValue([
      {
        id: 'w1',
        text: 'send invoice',
        project: null,
        kind: 'task',
        dueDate: null,
        done: false,
        createdAt: 1_700_000_000_000,
      },
    ]);
    renderScreen();
    await settle();

    const trigger = container.querySelector(
      '[data-testid="todo-row-work:w1"] [role="button"]',
    ) as HTMLElement;
    act(() => { trigger.click(); });
    await settle();

    expect(mockWorkMarkComplete).toHaveBeenCalledWith('w1');
  });

  it('clicking a generic admin task routes to tasks.markComplete', async () => {
    mockAdminTasksListOpen.mockResolvedValue([
      {
        id: 'a1',
        kind: 'task',
        text: 'pay rent',
        data: { kind: 'task' },
        done: false,
        createdAt: 1_700_000_000_000,
      },
    ]);
    renderScreen();
    await settle();

    const trigger = container.querySelector(
      '[data-testid="todo-row-admin:a1"] [role="button"]',
    ) as HTMLElement;
    act(() => { trigger.click(); });
    await settle();

    expect(mockAdminTasksMarkComplete).toHaveBeenCalledWith('a1');
    expect(mockAdminRenewalsMarkComplete).not.toHaveBeenCalled();
  });
});
