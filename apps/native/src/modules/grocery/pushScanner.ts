/**
 * Grocery · pantry push scanner.
 *
 * Lightweight in-process checker that walks the active pantry rows, runs
 * the `shouldPushReminder` gate against each, and for matching rows:
 *   1. dispatches `window.ollie:notify` CustomEvent — picked up by the
 *      systemNotify listener installed at boot, which fires the actual
 *      OS notification (or console-log fallback in web preview).
 *   2. calls `pantry.markPushed(id, now)` so the same prediction window
 *      doesn't re-fire on the next scan.
 *
 * This module piggybacks on the cadence-scanner concept — but stays
 * deliberately ISOLATED from `@ollie/orchestrator/cadence-scanner` because
 * that scanner walks `@ollie/cadence` estimates, not pantry rows + Plan B
 * predicted_out_at_ms timestamps. Coupling them would mean tunneling a new
 * domain shape through a generic dedupe surface — cheap to keep separate.
 *
 * Public surface:
 *   - `scanPantryPushes(opts?)` — async, returns the list of canonicals
 *     that fired so callers (tests, boot init log) can introspect.
 *
 * Scheduling lives in the boot code (apps/native/src/main.tsx-style entry
 * — wire after this lands): call once on app focus AND on a 30-min
 * setInterval while the document is visible. The scanner is fast (one
 * SQLite SELECT plus per-row UPDATE for matches only).
 */

import { pantry } from './repo';
import { shouldPushReminder, type ShouldPushOptions } from './pushTrigger';
import type { PantryItem } from './types';

export interface ScanPantryPushesResult {
  /** Canonicals (pantry names) that triggered a push this scan. */
  fired: string[];
  /** Rows visited but blocked by the gate. Diagnostic — not surfaced. */
  scanned: number;
}

export interface ScanPantryPushesOptions extends ShouldPushOptions {
  /** Defaults to Date.now(). Tests inject a fixed clock. */
  nowMs?: number;
  /**
   * Override the event dispatcher. Production uses
   * `window.dispatchEvent(new CustomEvent('ollie:notify', { detail }))`
   * via the default; tests pass a vi.fn() and assert against it.
   */
  dispatch?: (detail: { title: string; body?: string }) => void;
  /**
   * Override the rows source. Defaults to `pantry.list()`. Tests inject
   * to keep the scanner isolated from the repo.
   */
  source?: () => Promise<PantryItem[]>;
  /**
   * Override the post-push bookkeeping. Defaults to `pantry.markPushed`.
   */
  mark?: (id: string, nowMs: number) => Promise<void>;
}

/** Default CustomEvent dispatcher — matches the systemNotify listener contract. */
function defaultDispatch(detail: { title: string; body?: string }): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') {
    // Headless test env or non-DOM context: caller wanted the side effect
    // but there's no window. We swallow silently rather than throw — the
    // gate already passed, so silently dropping is consistent with the
    // systemNotify fallback's "log only" behaviour.
    return;
  }
  window.dispatchEvent(new CustomEvent('ollie:notify', { detail }));
}

/**
 * Walk the active pantry and fire pushes for every row that passes the
 * gate. Returns the canonical names of fired rows for introspection.
 *
 * Never throws — a failed `markPushed` is logged and the scan continues.
 */
export async function scanPantryPushes(
  opts: ScanPantryPushesOptions = {},
): Promise<ScanPantryPushesResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const dispatch = opts.dispatch ?? defaultDispatch;
  const source = opts.source ?? (() => pantry.list());
  const mark = opts.mark ?? ((id, ts) => pantry.markPushed(id, ts));

  const fired: string[] = [];
  let rows: PantryItem[];
  try {
    rows = await source();
  } catch (err) {
    console.error('[pushScanner] failed to read pantry rows', err);
    return { fired, scanned: 0 };
  }

  for (const row of rows) {
    if (!shouldPushReminder(row, nowMs, opts)) continue;

    // House voice: lowercase, no shame, no exclamation marks. Matches the
    // cadence-scanner copy template for grocery.
    const title = `might be out of ${row.name}`;
    const body = 'tomorrow';

    try {
      dispatch({ title, body });
    } catch (err) {
      console.error('[pushScanner] dispatch failed', row.id, err);
      continue;
    }

    try {
      await mark(row.id, nowMs);
      fired.push(row.name);
    } catch (err) {
      // Bookkeeping failed — the push already went out. Log + continue.
      // Next scan will pass the gate again and fire a duplicate; we accept
      // that risk because the `ollie:notify` listener already deduplicates
      // identical content within the OS notification centre.
      console.error('[pushScanner] markPushed failed', row.id, err);
    }
  }

  return { fired, scanned: rows.length };
}
