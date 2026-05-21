/**
 * grocery-undo-stack
 *
 * Session-only LIFO undo stack for grocery mutations. Module-scope array;
 * no persistence, cleared on logout / user switch. MAX=10 — oldest entry
 * dropped when exceeded.
 *
 * The orchestrator stays pure: it emits a GroceryMutationEntry snapshot
 * via onGroceryMutation. The frontend (applyRoute.ts) builds the actual
 * undo() closure from that snapshot (since only the frontend holds the
 * store reference) and pushes it here.
 */

export type GroceryUndoMode = 'add' | 'remove' | 'check' | 'move_to_pantry';

export interface GroceryUndoEntry {
  ts: number;
  mode: GroceryUndoMode;
  description: string;
  /** Reverses the mutation by directly poking the store. */
  undo: () => void;
}

const STACK: GroceryUndoEntry[] = [];
const MAX = 10;

/** Push the latest mutation onto the stack. Drops oldest when MAX exceeded. */
export function pushUndo(entry: GroceryUndoEntry): void {
  STACK.push(entry);
  if (STACK.length > MAX) {
    STACK.shift();
  }
}

/** Pop and return the latest entry. Returns null when empty. */
export function popUndo(): GroceryUndoEntry | null {
  return STACK.pop() ?? null;
}

/** Peek the latest description without popping (for SortedToast undo prompt). */
export function peekDescription(): string | null {
  if (STACK.length === 0) return null;
  return STACK[STACK.length - 1].description;
}

/** Clear the stack — call on logout / user switch / sign-out. */
export function clearStack(): void {
  STACK.length = 0;
}

/** Visible for tests + devtools. */
export function _stackSize(): number {
  return STACK.length;
}
