/**
 * groceryRoutingMock — devtool fixture emitter for the grocery routing pipeline.
 *
 * Why this exists:
 *   Backend's T0/T1/T2 router ships in a parallel branch; we need to be
 *   able to drive `SortedToast` + `PendingHair` + `useGroceryRouting`
 *   from the frontend in isolation, both for Storybook and for the live
 *   app via a `?mock=…` query param.
 *
 * Usage:
 *   • Live app: navigate to any screen with `?mock=grocery_hit` (or any
 *     fixture key below). `installGroceryRoutingMock()` is called once
 *     from main.tsx; it parses the param and emits the right pair
 *     (pending → routed) with the cache-hit vs cache-miss delay baked in.
 *   • Storybook: import the fixture record + call `playFixture(name)`
 *     from any decorator.
 *
 * All 9 fixtures map to the open spec:
 *   1. single             — one item, shopping target
 *   2. duo                — two items, shopping target
 *   3. bulk               — 4+ items, shopping target
 *   4. recipe_split       — recipe expansion, mixed pantry+shopping (DEFAULT)
 *   5. recipe_summary     — recipe expansion, single target (no split)
 *   6. cache_hit          — instant routed (no pending visible)
 *   7. cache_miss         — pending shimmer ~900ms, then routed
 *   8. fallback           — offline / cost-capped deterministic path
 *   9. mixed_pantry_shop  — mixed targets, NOT a recipe (manual split)
 *   10. error             — bonus: ai-down error caption
 *
 * The fixture set is intentionally over 9 — Serra asked for 9 but we want
 * an `error` story too. We keep the named keys public so the toast pod
 * and the backend pod can both reference the same canonical inputs.
 */

import { emit } from '@ollie/events';
import type {
  GroceryRoutedItem,
  GroceryRoutingResult,
  GroceryRoutingSource,
} from '../hooks/useGroceryRouting';

// ─── Fixture shape ────────────────────────────────────────────────────────────

export interface GroceryRoutingFixture {
  /** Stable key for ?mock=… and Storybook story id. */
  key: string;
  /** One-line story summary, used as the chrome banner caption. */
  label: string;
  /** Original dump text (the "raw" the user typed). */
  raw: string;
  /** Items the router decides on. */
  items: GroceryRoutedItem[];
  /** Cache hit / Gemini call / deterministic fallback. */
  source: GroceryRoutingSource;
  /** Pending → routed gap in ms. cache_hit = 0; cache_miss ≈ 900; others ≈ 250. */
  delayMs: number;
  /** Latency to stamp on the routed payload. */
  latencyMs: number;
  /** Optional error string for the error story. */
  error?: string;
}

// ─── 10 canonical fixtures ────────────────────────────────────────────────────

export const GROCERY_ROUTING_FIXTURES: Record<string, GroceryRoutingFixture> = {
  single: {
    key: 'single',
    label: '1 item · cache hit',
    raw: 'milk',
    items: [{ name: 'milk', target: 'shopping' }],
    source: 'cache',
    delayMs: 0,
    latencyMs: 8,
  },
  duo: {
    key: 'duo',
    label: '2 items · single target',
    raw: 'milk and eggs',
    items: [
      { name: 'milk', target: 'shopping' },
      { name: 'eggs', target: 'shopping' },
    ],
    source: 'cache',
    delayMs: 0,
    latencyMs: 12,
  },
  bulk: {
    key: 'bulk',
    label: '3+ items · single target',
    raw: 'milk eggs bread bananas oats',
    items: [
      { name: 'milk', target: 'shopping' },
      { name: 'eggs', target: 'shopping' },
      { name: 'bread', target: 'shopping' },
      { name: 'bananas', target: 'shopping' },
      { name: 'oats', target: 'shopping' },
    ],
    source: 'gemini',
    delayMs: 250,
    latencyMs: 410,
  },
  recipe_split: {
    key: 'recipe_split',
    label: 'recipe expansion · mixed split (DEFAULT)',
    raw: 'making spaghetti bolognese tonight',
    items: [
      { name: 'spaghetti', target: 'shopping', recipe_parent: 'spaghetti bolognese' },
      { name: 'ground beef', target: 'shopping', recipe_parent: 'spaghetti bolognese' },
      { name: 'tomato passata', target: 'shopping', recipe_parent: 'spaghetti bolognese' },
      { name: 'onion', target: 'pantry', recipe_parent: 'spaghetti bolognese' },
      { name: 'garlic', target: 'pantry', recipe_parent: 'spaghetti bolognese' },
      { name: 'olive oil', target: 'pantry', recipe_parent: 'spaghetti bolognese' },
    ],
    source: 'gemini',
    delayMs: 700,
    latencyMs: 920,
  },
  recipe_summary: {
    key: 'recipe_summary',
    label: 'recipe expansion · single target (no split)',
    raw: 'pancake breakfast for sunday',
    items: [
      { name: 'flour', target: 'shopping', recipe_parent: 'pancake breakfast' },
      { name: 'milk', target: 'shopping', recipe_parent: 'pancake breakfast' },
      { name: 'eggs', target: 'shopping', recipe_parent: 'pancake breakfast' },
      { name: 'maple syrup', target: 'shopping', recipe_parent: 'pancake breakfast' },
    ],
    source: 'gemini',
    delayMs: 700,
    latencyMs: 880,
  },
  cache_hit: {
    key: 'cache_hit',
    label: 'cache hit · instant',
    raw: 'eggs',
    items: [{ name: 'eggs', target: 'shopping' }],
    source: 'cache',
    delayMs: 0,
    latencyMs: 4,
  },
  cache_miss: {
    key: 'cache_miss',
    label: 'cache miss · pending shimmer then resolves',
    raw: 'almond butter',
    items: [{ name: 'almond butter', target: 'shopping' }],
    source: 'gemini',
    delayMs: 900,
    latencyMs: 1120,
  },
  fallback: {
    key: 'fallback',
    label: 'offline / cost-capped fallback',
    raw: 'butter',
    items: [{ name: 'butter', target: 'shopping' }],
    source: 'fallback',
    delayMs: 50,
    latencyMs: 60,
  },
  mixed_pantry_shop: {
    key: 'mixed_pantry_shop',
    label: 'manual mixed split (not a recipe)',
    raw: 'bought olive oil, need bananas',
    items: [
      { name: 'olive oil', target: 'pantry' },
      { name: 'bananas', target: 'shopping' },
    ],
    source: 'gemini',
    delayMs: 300,
    latencyMs: 480,
  },
  error: {
    key: 'error',
    label: 'AI down · deterministic fallback + error caption',
    raw: 'sourdough starter',
    items: [{ name: 'sourdough starter', target: 'shopping' }],
    source: 'fallback',
    delayMs: 100,
    latencyMs: 110,
    error: 'gemini_unavailable',
  },
};

export const FIXTURE_KEYS = Object.keys(GROCERY_ROUTING_FIXTURES);

// ─── Emit driver ──────────────────────────────────────────────────────────────

function newIdempotencyKey(): string {
  return 'mock_' + Math.random().toString(36).slice(2);
}

/** Play a fixture: emits `pending`, then after `delayMs`, emits `routed`. */
export function playGroceryRoutingFixture(
  keyOrFixture: string | GroceryRoutingFixture,
  overrides: Partial<GroceryRoutingResult> = {},
): { idempotency_key: string; cancel: () => void } {
  const fix =
    typeof keyOrFixture === 'string'
      ? GROCERY_ROUTING_FIXTURES[keyOrFixture]
      : keyOrFixture;
  if (!fix) {
    throw new Error(`[groceryRoutingMock] unknown fixture "${keyOrFixture}"`);
  }
  const idempotency_key = newIdempotencyKey();
  const ts = Date.now();

  emit('grocery:routing:pending', { idempotency_key, raw: fix.raw, ts });

  const routedPayload: GroceryRoutingResult = {
    idempotency_key,
    raw: fix.raw,
    items: fix.items,
    source: fix.source,
    latency_ms: fix.latencyMs,
    ts: ts + fix.delayMs,
    ...(fix.error !== undefined ? { error: fix.error } : {}),
    ...overrides,
  };

  let timerId: ReturnType<typeof setTimeout> | null = null;
  if (fix.delayMs <= 0) {
    emit('grocery:routed', routedPayload);
  } else {
    timerId = setTimeout(() => {
      timerId = null;
      emit('grocery:routed', routedPayload);
    }, fix.delayMs);
  }

  return {
    idempotency_key,
    cancel: () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
  };
}

// ─── ?mock=… install ──────────────────────────────────────────────────────────

const ALLOWED_PARAMS = new Set(
  FIXTURE_KEYS.map((k) => `grocery_${k}`).concat(FIXTURE_KEYS),
);

/**
 * Call once from main.tsx (after the event bus is loaded). Parses
 * `?mock=grocery_<fixture>` or `?mock=<fixture>` from the current URL
 * and plays the matching fixture on the next tick. No-op when the param
 * is missing or doesn't match an allowed key.
 */
export function installGroceryRoutingMockFromURL(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('mock');
  if (!raw || !ALLOWED_PARAMS.has(raw)) return;
  const key = raw.startsWith('grocery_') ? raw.slice('grocery_'.length) : raw;
  if (!GROCERY_ROUTING_FIXTURES[key]) return;
  // Defer one tick so the React tree (and any subscribed hook) is mounted.
  setTimeout(() => {
    playGroceryRoutingFixture(key);
  }, 50);
}
