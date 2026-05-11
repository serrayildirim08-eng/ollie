/**
 * @ollie/orchestrator · grocery
 *
 * Ported from window.VOID.orchestrator.grocery in void-app.html (~lines 25325–25483).
 * The only caller of @ollie/logic/grocery pattern functions.
 * UI reads derived keys from the store — it never calls logic directly.
 *
 * Derived keys written (namespace: "grocery"):
 *   patterns                GroceryPattern[]  from detectPatterns
 *   patternsLastComputedAt  number            wall-clock ts of last run
 *
 * Events emitted:
 *   grocery:pattern_detected   — new pattern key observed (not seen in prev run)
 *   grocery:duplicate_detected — bought item already in pantry within shelf life
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import {
  detectPatterns,
  detectDuplicate,
} from '@ollie/logic/grocery';
import type {
  GroceryPattern,
  PantryItem,
  ShoppingItem,
} from '@ollie/logic/grocery';
import type { Orchestrator } from './types';

export interface GroceryOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
}

export function createGroceryOrchestrator(
  store: Store,
  opts: GroceryOrchestratorOptions = {},
): Orchestrator {
  const nowFn = opts.now ?? (() => Date.now());
  let initialized = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubs: Unsubscribe[] = [];

  // ── helpers ──────────────────────────────────────────────────────────────

  function getItems(): ShoppingItem[] {
    return store.get<ShoppingItem[]>('grocery', 'items', []) ?? [];
  }

  function getPantry(): PantryItem[] {
    return store.get<PantryItem[]>('grocery', 'pantry', []) ?? [];
  }

  // ── pattern recompute ─────────────────────────────────────────────────────

  function recomputePatterns(): void {
    const items = getItems();
    const pantry = getPantry();
    const now = nowFn();

    const prev = store.get<GroceryPattern[]>('grocery', 'patterns', []) ?? [];
    const prevKeys = new Set(prev.map((p) => p.pattern).filter(Boolean));

    const patterns = detectPatterns({ items, pantry, now }, { now });

    store.set('grocery', 'patterns', patterns);
    store.set('grocery', 'patternsLastComputedAt', now);

    for (const p of patterns) {
      if (p.pattern && !prevKeys.has(p.pattern)) {
        events.emit('grocery:pattern_detected', {
          pattern: p.pattern,
          confidence: p.confidence,
          sample_n: p.sample_n,
          ts: now,
        });
      }
    }
  }

  // ── duplicate check ───────────────────────────────────────────────────────

  function checkDuplicate(newCanonical: string): void {
    if (!newCanonical) return;
    const pantry = getPantry();
    const now = nowFn();

    const dup = detectDuplicate({ pantry, now }, { newCanonical, now });
    if (dup) {
      events.emit('grocery:duplicate_detected', {
        name: dup.name,
        days_since_purchase: dup.days_since_purchase,
        ts: now,
      });
    }
  }

  // ── debounce ──────────────────────────────────────────────────────────────

  function schedule(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      recomputePatterns();
    }, 500);
  }

  // ── items-changed handler ─────────────────────────────────────────────────

  function onItemsChanged(): void {
    const items = getItems();
    // Check duplicate for the most recently bought item.
    const lastBought = items
      .filter((i) => i.checked === true && typeof i.boughtTs === 'number')
      .sort((a, b) => (b.boughtTs ?? 0) - (a.boughtTs ?? 0))[0];
    if (lastBought?.normalizedName) {
      checkDuplicate(lastBought.normalizedName);
    }
    schedule();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('grocery', 'items', onItemsChanged));
    unsubs.push(store.subscribeKey('grocery', 'pantry', () => schedule()));

    // Check duplicates for any pre-existing bought items before subscribing.
    const items = getItems();
    const lastBought = items
      .filter((i) => i.checked === true && typeof i.boughtTs === 'number')
      .sort((a, b) => (b.boughtTs ?? 0) - (a.boughtTs ?? 0))[0];
    if (lastBought?.normalizedName) {
      checkDuplicate(lastBought.normalizedName);
    }

    recomputePatterns();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    initialized = false;
  }

  return { init, teardown };
}
