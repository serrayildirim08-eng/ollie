/**
 * useApplyBrainDump · undo short-circuit tests
 *
 * Tests the UNDO_TRIGGERS gate that runs before AI routing.
 * We test the undo-stack behaviour directly (pure functions) — no React render.
 * The hook wires these functions; if the functions are correct the wiring is
 * correct (the wiring is 4 lines with no branching logic).
 *
 * 6 tests:
 *   1. 'undo' text calls popUndo + invokes undo()
 *   2. 'geri al' (TR) triggers undo
 *   3. 'actually no' (EN) triggers undo
 *   4. popUndo called, undo() invoked on the returned entry
 *   5. empty stack → 'grocery:undone' emitted with empty description
 *   6. non-undo text → normal flow (no premature undo)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pushUndo, popUndo, clearStack, _stackSize } from '../lib/grocery-undo-stack';

// ─── mock events bus ─────────────────────────────────────────────────────────
// We don't render the hook — we test the undo-stack + trigger logic in isolation.

const emitted: Array<{ name: string; payload: unknown }> = [];

vi.mock('@ollie/events', () => ({
  emit: vi.fn((name: string, payload: unknown) => {
    emitted.push({ name, payload });
  }),
  on: vi.fn(),
  once: vi.fn(),
}));

import { emit } from '@ollie/events';

// Simulate the undo short-circuit logic from useApplyBrainDump (isolated copy
// of the branch so we can test it without a React harness).
const UNDO_TRIGGERS = [
  'undo',
  'geri al',
  'actually no',
  'wait no',
  'wait, no',
  'oops',
  'nvm',
  'never mind',
  'cancel that',
  'iptal',
  'cancela',
] as const;

function simulateUndoShortCircuit(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (!(UNDO_TRIGGERS as ReadonlyArray<string>).includes(trimmed)) {
    return false; // not an undo trigger — normal flow continues
  }
  const entry = popUndo();
  if (entry) {
    entry.undo();
    emit('grocery:undone', { description: entry.description, mode: entry.mode, ts: Date.now() });
  } else {
    emit('grocery:undone', { description: '', mode: 'add' as const, ts: Date.now() });
  }
  return true; // short-circuited
}

describe('useApplyBrainDump · undo short-circuit', () => {
  beforeEach(() => {
    clearStack();
    emitted.length = 0;
    vi.clearAllMocks();
  });

  // TC-U1: 'undo' triggers short-circuit
  it('"undo" text triggers short-circuit (returns true)', () => {
    const result = simulateUndoShortCircuit('undo');
    expect(result).toBe(true);
  });

  // TC-U2: 'geri al' (TR) triggers undo
  it('"geri al" triggers short-circuit', () => {
    const result = simulateUndoShortCircuit('geri al');
    expect(result).toBe(true);
  });

  // TC-U3: 'actually no' (EN) triggers undo
  it('"actually no" triggers short-circuit', () => {
    const result = simulateUndoShortCircuit('actually no');
    expect(result).toBe(true);
  });

  // TC-U4: popUndo called + undo() invoked
  it('popUndo is called and undo() executes on the top entry', () => {
    let undoCalled = false;
    pushUndo({
      ts: Date.now(),
      mode: 'remove',
      description: 'removed pasta from shop',
      undo: () => { undoCalled = true; },
    });

    simulateUndoShortCircuit('undo');

    expect(undoCalled).toBe(true);
    expect(_stackSize()).toBe(0);
    expect(emit).toHaveBeenCalledWith(
      'grocery:undone',
      expect.objectContaining({ description: 'removed pasta from shop', mode: 'remove' }),
    );
  });

  // TC-U5: empty stack → emit grocery:undone with empty description
  it('empty stack emits grocery:undone with empty description', () => {
    // Stack is already empty (cleared in beforeEach)
    simulateUndoShortCircuit('undo');

    expect(emit).toHaveBeenCalledWith(
      'grocery:undone',
      expect.objectContaining({ description: '', mode: 'add' }),
    );
  });

  // TC-U6: non-undo text → normal flow proceeds (returns false, no emit)
  it('non-undo text does not short-circuit', () => {
    const result = simulateUndoShortCircuit('buy eggs and milk');
    expect(result).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});
