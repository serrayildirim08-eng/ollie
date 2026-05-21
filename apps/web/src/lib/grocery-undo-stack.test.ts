/**
 * grocery-undo-stack unit tests
 *
 * 8 tests covering:
 *   - push + pop LIFO order
 *   - MAX=10 enforcement (push 11 → first dropped)
 *   - empty pop returns null
 *   - peekDescription returns latest, null when empty
 *   - clearStack empties everything
 *   - undo() function preserved through push/pop
 *   - ts ordering preserved
 *   - multiple consecutive pushes from same source
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  pushUndo,
  popUndo,
  peekDescription,
  clearStack,
  _stackSize,
  type GroceryUndoEntry,
} from './grocery-undo-stack';

function makeEntry(overrides: Partial<GroceryUndoEntry> = {}): GroceryUndoEntry {
  return {
    ts: Date.now(),
    mode: 'add',
    description: 'added eggs to shop',
    undo: () => {},
    ...overrides,
  };
}

describe('grocery-undo-stack', () => {
  beforeEach(() => {
    clearStack();
  });

  it('push + pop returns entries in LIFO order', () => {
    const first = makeEntry({ description: 'first', ts: 1000 });
    const second = makeEntry({ description: 'second', ts: 2000 });
    pushUndo(first);
    pushUndo(second);
    expect(popUndo()?.description).toBe('second');
    expect(popUndo()?.description).toBe('first');
  });

  it('MAX=10 enforcement: push 11, first entry dropped', () => {
    for (let i = 0; i < 11; i++) {
      pushUndo(makeEntry({ description: `entry-${i}`, ts: i }));
    }
    expect(_stackSize()).toBe(10);
    // Pop all — the oldest (entry-0) must be gone
    const popped: string[] = [];
    for (let i = 0; i < 10; i++) {
      const e = popUndo();
      if (e) popped.push(e.description);
    }
    expect(popped).not.toContain('entry-0');
    expect(popped).toContain('entry-10');
  });

  it('popUndo returns null when stack is empty', () => {
    expect(popUndo()).toBeNull();
  });

  it('peekDescription returns latest description without popping', () => {
    pushUndo(makeEntry({ description: 'alpha' }));
    pushUndo(makeEntry({ description: 'beta' }));
    expect(peekDescription()).toBe('beta');
    // Stack must still have 2 entries
    expect(_stackSize()).toBe(2);
  });

  it('peekDescription returns null when stack is empty', () => {
    expect(peekDescription()).toBeNull();
  });

  it('clearStack empties the stack entirely', () => {
    pushUndo(makeEntry());
    pushUndo(makeEntry());
    clearStack();
    expect(_stackSize()).toBe(0);
    expect(popUndo()).toBeNull();
  });

  it('undo() closure is preserved through push/pop and executes', () => {
    let called = false;
    pushUndo(makeEntry({ undo: () => { called = true; } }));
    const entry = popUndo();
    entry?.undo();
    expect(called).toBe(true);
  });

  it('ts ordering preserved — latest push has highest ts', () => {
    const ts1 = 100;
    const ts2 = 200;
    pushUndo(makeEntry({ ts: ts1 }));
    pushUndo(makeEntry({ ts: ts2 }));
    const top = popUndo();
    expect(top?.ts).toBe(ts2);
  });

  it('multiple consecutive pushes from same source all land on stack', () => {
    pushUndo(makeEntry({ description: 'a', mode: 'remove' }));
    pushUndo(makeEntry({ description: 'b', mode: 'remove' }));
    pushUndo(makeEntry({ description: 'c', mode: 'remove' }));
    expect(_stackSize()).toBe(3);
    expect(peekDescription()).toBe('c');
  });
});
