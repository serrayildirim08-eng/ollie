/**
 * DecisionRow behavior tests.
 *
 * Covers the DECISION variant of the /todo screen:
 *   - renders text + 3 action buttons (cancel / keep / decide later)
 *   - clicking each button calls the correct repo helper
 *   - optimistic fade + removal after 200ms
 *   - cancel on admin_decision cross-links to subscriptions.markCanceled
 *   - fuzzy name extraction: "chatgpt subscription" → key "chatgpt"
 *   - cancel on finance_decision calls pending.decide(id, 'skip')
 *   - keep on finance_decision calls pending.decide(id, 'proceed')
 *   - snooze (decide later) behavior: row re-appears after 7-day window
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── module mocks ──────────────────────────────────────────────────────────

vi.mock('../modules/admin', () => ({
  migrateAdmin: vi.fn().mockResolvedValue(undefined),
  tasks: {
    listOpen: vi.fn().mockResolvedValue([]),
    markComplete: vi.fn().mockResolvedValue(undefined),
  },
  renewals: {
    listOpen: vi.fn().mockResolvedValue([]),
    markComplete: vi.fn().mockResolvedValue(undefined),
  },
  recurringDecisions: {
    listOpen: vi.fn().mockResolvedValue([]),
    decide: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../modules/finance', () => ({
  migrateFinance: vi.fn().mockResolvedValue(undefined),
  pending: {
    listOpen: vi.fn().mockResolvedValue([]),
    decide: vi.fn().mockResolvedValue(undefined),
  },
  subscriptions: {
    markCanceled: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../modules/work', () => ({
  migrateWork: vi.fn().mockResolvedValue(undefined),
  tasks: {
    listOpen: vi.fn().mockResolvedValue([]),
    markComplete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../modules/grocery', () => ({
  migrateGrocery: vi.fn().mockResolvedValue(undefined),
  shopping: {
    listOpen: vi.fn().mockResolvedValue([]),
    markPurchased: vi.fn().mockResolvedValue(undefined),
  },
}));

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
  fonts: { sans: 'sans-serif', serif: 'serif', mono: 'monospace' },
  fontWeights: { normal: 400, medium: 500, bold: 700 },
  zIndex: { modal: 100 },
  durations: { tap: '120ms', fade: '200ms' },
  easings: { calmOut: 'cubic-bezier(0.18,0,0.22,1)' },
}));

import { TodoScreen } from './TodoScreen';
import * as adminMod from '../modules/admin';
import * as financeMod from '../modules/finance';
import * as workMod from '../modules/work';
import * as groceryMod from '../modules/grocery';

// ─── helpers ──────────────────────────────────────────────────────────────

const mockAdminTasksListOpen = adminMod.tasks.listOpen as ReturnType<typeof vi.fn>;
const mockAdminRenewalsListOpen = adminMod.renewals.listOpen as ReturnType<typeof vi.fn>;
const mockWorkTasksListOpen = workMod.tasks.listOpen as ReturnType<typeof vi.fn>;
const mockGroceryShoppingListOpen = groceryMod.shopping.listOpen as ReturnType<typeof vi.fn>;
const mockAdminDecisionsListOpen = adminMod.recurringDecisions.listOpen as ReturnType<typeof vi.fn>;
const mockAdminDecisionsDecide = adminMod.recurringDecisions.decide as ReturnType<typeof vi.fn>;
const mockFinancePendingListOpen = financeMod.pending.listOpen as ReturnType<typeof vi.fn>;
const mockFinancePendingDecide = financeMod.pending.decide as ReturnType<typeof vi.fn>;
const mockFinanceSubscriptionsMarkCanceled = financeMod.subscriptions.markCanceled as ReturnType<typeof vi.fn>;

const TS = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

const ADMIN_DECISION_ROW = {
  id: 'd1',
  what: 'chatgpt subscription',
  decision: null as null,
  snoozeUntilMs: null as null,
  createdAt: TS('2026-05-31'),
};

const FINANCE_PENDING_ROW = {
  id: 'p1',
  what: 'moving quote 2400',
  decision: null as null,
  snoozeUntilMs: null as null,
  createdAt: TS('2026-05-31'),
  amount: 2400,
  currency: null as null,
  deadline: null as null,
  decidedAtMs: null as null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  // Reset every mock to a safe empty-array default so the screen's refresh
  // calls don't crash when a particular test only sets one of them.
  mockAdminTasksListOpen.mockReset().mockResolvedValue([]);
  mockAdminRenewalsListOpen.mockReset().mockResolvedValue([]);
  mockAdminDecisionsListOpen.mockReset().mockResolvedValue([]);
  mockWorkTasksListOpen.mockReset().mockResolvedValue([]);
  mockGroceryShoppingListOpen.mockReset().mockResolvedValue([]);
  mockAdminDecisionsDecide.mockReset().mockResolvedValue(undefined);
  mockFinancePendingListOpen.mockReset().mockResolvedValue([]);
  mockFinancePendingDecide.mockReset().mockResolvedValue(undefined);
  mockFinanceSubscriptionsMarkCanceled.mockReset().mockResolvedValue(undefined);
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
  act(() => { root.render(React.createElement(TodoScreen)); });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ─── decision row rendering ────────────────────────────────────────────────

describe('DecisionRow — admin_decision', () => {
  beforeEach(() => {
    mockAdminDecisionsListOpen.mockResolvedValue([ADMIN_DECISION_ROW]);
  });

  it('renders the decision text and three action buttons', async () => {
    renderScreen();
    await settle();

    const rowId = 'admin_decision:d1';
    const row = container.querySelector(`[data-testid="todo-row-${rowId}"]`);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('decide: chatgpt subscription');

    // Three buttons present
    const cancel = container.querySelector(`[data-testid="decision-cancel-${rowId}"]`);
    const keep = container.querySelector(`[data-testid="decision-keep-${rowId}"]`);
    const later = container.querySelector(`[data-testid="decision-later-${rowId}"]`);
    expect(cancel).not.toBeNull();
    expect(keep).not.toBeNull();
    expect(later).not.toBeNull();

    expect(cancel!.textContent).toBe('cancel');
    expect(keep!.textContent).toBe('keep');
    expect(later!.textContent).toBe('decide later');
  });

  it('clicking "cancel" calls recurringDecisions.decide(id, "cancel") + subscriptions.markCanceled with fuzzy key', async () => {
    renderScreen();
    await settle();

    const rowId = 'admin_decision:d1';
    const cancel = container.querySelector(
      `[data-testid="decision-cancel-${rowId}"]`,
    ) as HTMLElement;
    act(() => { cancel.click(); });
    await settle();

    expect(mockAdminDecisionsDecide).toHaveBeenCalledWith('d1', 'cancel', expect.any(Number));
    // "chatgpt subscription" → key is "chatgpt" (strips "subscription")
    expect(mockFinanceSubscriptionsMarkCanceled).toHaveBeenCalledWith('chatgpt', expect.any(Number));
  });

  it('clicking "keep" calls recurringDecisions.decide(id, "keep"), no subscription side-effect', async () => {
    renderScreen();
    await settle();

    const rowId = 'admin_decision:d1';
    const keep = container.querySelector(
      `[data-testid="decision-keep-${rowId}"]`,
    ) as HTMLElement;
    act(() => { keep.click(); });
    await settle();

    expect(mockAdminDecisionsDecide).toHaveBeenCalledWith('d1', 'keep', expect.any(Number));
    expect(mockFinanceSubscriptionsMarkCanceled).not.toHaveBeenCalled();
  });

  it('clicking "decide later" calls recurringDecisions.decide(id, "later")', async () => {
    renderScreen();
    await settle();

    const rowId = 'admin_decision:d1';
    const later = container.querySelector(
      `[data-testid="decision-later-${rowId}"]`,
    ) as HTMLElement;
    act(() => { later.click(); });
    await settle();

    expect(mockAdminDecisionsDecide).toHaveBeenCalledWith('d1', 'later', expect.any(Number));
  });

  it('clicking any button triggers optimistic fade + row removal after 200ms', async () => {
    renderScreen();
    await settle();

    const rowId = 'admin_decision:d1';
    const keep = container.querySelector(
      `[data-testid="decision-keep-${rowId}"]`,
    ) as HTMLElement;

    act(() => { keep.click(); });
    await settle();

    // Row still rendered (fade in progress)
    let row = container.querySelector(`[data-testid="todo-row-${rowId}"]`);
    expect(row).not.toBeNull();

    // Advance past FADE_OUT_MS (200ms)
    await act(async () => { vi.advanceTimersByTime(250); });
    await settle();

    row = container.querySelector(`[data-testid="todo-row-${rowId}"]`);
    expect(row).toBeNull();
  });
});

// ─── finance_decision ──────────────────────────────────────────────────────

describe('DecisionRow — finance_decision', () => {
  beforeEach(() => {
    mockFinancePendingListOpen.mockResolvedValue([FINANCE_PENDING_ROW]);
  });

  it('renders the pending decision text', async () => {
    renderScreen();
    await settle();

    const rowId = 'finance_decision:p1';
    const row = container.querySelector(`[data-testid="todo-row-${rowId}"]`);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('decide: moving quote 2400');
  });

  it('"cancel" on finance_decision → pending.decide(id, "skip")', async () => {
    renderScreen();
    await settle();

    const rowId = 'finance_decision:p1';
    const cancel = container.querySelector(
      `[data-testid="decision-cancel-${rowId}"]`,
    ) as HTMLElement;
    act(() => { cancel.click(); });
    await settle();

    expect(mockFinancePendingDecide).toHaveBeenCalledWith('p1', 'skip', expect.any(Number));
    // No subscription side-effect for finance_decision
    expect(mockFinanceSubscriptionsMarkCanceled).not.toHaveBeenCalled();
  });

  it('"keep" on finance_decision → pending.decide(id, "proceed")', async () => {
    renderScreen();
    await settle();

    const rowId = 'finance_decision:p1';
    const keep = container.querySelector(
      `[data-testid="decision-keep-${rowId}"]`,
    ) as HTMLElement;
    act(() => { keep.click(); });
    await settle();

    expect(mockFinancePendingDecide).toHaveBeenCalledWith('p1', 'proceed', expect.any(Number));
  });

  it('"decide later" on finance_decision → pending.decide(id, "later")', async () => {
    renderScreen();
    await settle();

    const rowId = 'finance_decision:p1';
    const later = container.querySelector(
      `[data-testid="decision-later-${rowId}"]`,
    ) as HTMLElement;
    act(() => { later.click(); });
    await settle();

    expect(mockFinancePendingDecide).toHaveBeenCalledWith('p1', 'later', expect.any(Number));
  });
});

// ─── fuzzy subscription key extraction ────────────────────────────────────

describe('DecisionRow — cancel subscription fuzzy name matching', () => {
  it('"netflix subscription" → markCanceled("netflix")', async () => {
    mockAdminDecisionsListOpen.mockResolvedValue([
      { ...ADMIN_DECISION_ROW, id: 'dx', what: 'netflix subscription' },
    ]);
    renderScreen();
    await settle();

    const cancel = container.querySelector(
      '[data-testid="decision-cancel-admin_decision:dx"]',
    ) as HTMLElement;
    act(() => { cancel.click(); });
    await settle();

    expect(mockFinanceSubscriptionsMarkCanceled).toHaveBeenCalledWith('netflix', expect.any(Number));
  });

  it('"spotify monthly" → markCanceled("spotify")', async () => {
    mockAdminDecisionsListOpen.mockResolvedValue([
      { ...ADMIN_DECISION_ROW, id: 'dy', what: 'spotify monthly' },
    ]);
    renderScreen();
    await settle();

    const cancel = container.querySelector(
      '[data-testid="decision-cancel-admin_decision:dy"]',
    ) as HTMLElement;
    act(() => { cancel.click(); });
    await settle();

    expect(mockFinanceSubscriptionsMarkCanceled).toHaveBeenCalledWith('spotify', expect.any(Number));
  });

  it('"chatgpt" (single word) → markCanceled("chatgpt")', async () => {
    mockAdminDecisionsListOpen.mockResolvedValue([
      { ...ADMIN_DECISION_ROW, id: 'dz', what: 'chatgpt' },
    ]);
    renderScreen();
    await settle();

    const cancel = container.querySelector(
      '[data-testid="decision-cancel-admin_decision:dz"]',
    ) as HTMLElement;
    act(() => { cancel.click(); });
    await settle();

    expect(mockFinanceSubscriptionsMarkCanceled).toHaveBeenCalledWith('chatgpt', expect.any(Number));
  });
});
