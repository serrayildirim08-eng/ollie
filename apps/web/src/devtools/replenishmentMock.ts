/**
 * replenishmentMock — devtool fixture seeder for the adaptive-replenishment
 * surface (`useReplenishment` + `<ReplenishmentBadge>` + the grocery rows
 * that consume them).
 *
 * Why this exists:
 *   The backend's `/replenishment/:user` endpoint ships in a parallel
 *   branch; we need to be able to drive the badge across all three
 *   confidence states + the overdue/urgent buckets from the frontend in
 *   isolation, both for Storybook and for the live app via `?mock=…`.
 *
 * Usage:
 *   • Live app: navigate to `/preview/grocery` (or anywhere mounting
 *     `useReplenishment`) with `?mock=replenish_observed` (or any fixture
 *     key below). `installReplenishmentMockFromURL()` is called once from
 *     `main.tsx`; it seeds the module-scope cache so the hook resolves
 *     instantly to the fixture map.
 *   • Storybook / unit story: `seedReplenishmentFixture('replenish_static')`
 *     before the component mounts.
 *
 * Allowed `?mock=…` values (every one is also accepted bare):
 *   replenish_static    — all items return static estimates
 *   replenish_low_data  — 1-purchase logged, low-data confidence
 *   replenish_observed  — observed cadences (milk 3d, bread 7d, …)
 *   replenish_overdue   — some items past daysLeft (umber urgent state)
 *   replenish_mixed     — a realistic mix of all 3 confidences
 *
 * All fixtures use the canonical user id `mock-user` so the hook's userId
 * passthrough lights up correctly. Mirrors the `groceryRoutingMock` pattern.
 */

import {
  _seedReplenishmentCacheForMock,
  type ReplenishmentEstimate,
} from '../hooks/useReplenishment';

// ─── Fixture shape ────────────────────────────────────────────────────────────

export interface ReplenishmentFixture {
  /** Stable key for ?mock=… and Storybook story id. */
  key: string;
  /** One-line story summary, used as the chrome banner caption. */
  label: string;
  /** The user id the seeded cache resolves under. */
  userId: string;
  /** The estimates the seeded map exposes, keyed by canonical. */
  estimates: ReplenishmentEstimate[];
}

// helpers — keep the fixture table readable

const DAY = 86_400_000;
const now = (): number => Date.now();

function obs(
  canonical: string,
  medianDays: number,
  sampleSize: number,
  daysSinceLast: number,
): ReplenishmentEstimate {
  return {
    canonical,
    daysLeft: Math.max(0, medianDays - daysSinceLast),
    confidence: 'observed',
    sampleSize,
    medianIntervalDays: medianDays,
    lastPurchaseTs: now() - daysSinceLast * DAY,
  };
}

function low(
  canonical: string,
  staticDays: number,
  daysSinceLast: number,
): ReplenishmentEstimate {
  return {
    canonical,
    daysLeft: Math.max(0, staticDays - daysSinceLast),
    confidence: 'low-data',
    sampleSize: 1,
    medianIntervalDays: staticDays,
    lastPurchaseTs: now() - daysSinceLast * DAY,
  };
}

function stat(canonical: string, days: number): ReplenishmentEstimate {
  return {
    canonical,
    daysLeft: days,
    confidence: 'static',
    sampleSize: 0,
    medianIntervalDays: days,
    lastPurchaseTs: 0,
  };
}

function overdue(
  canonical: string,
  medianDays: number,
  daysSinceLast: number,
): ReplenishmentEstimate {
  return {
    canonical,
    daysLeft: medianDays - daysSinceLast, // negative → "due now"
    confidence: 'observed',
    sampleSize: 4,
    medianIntervalDays: medianDays,
    lastPurchaseTs: now() - daysSinceLast * DAY,
  };
}

// ─── 5 canonical fixtures ─────────────────────────────────────────────────────

export const REPLENISHMENT_FIXTURES: Record<string, ReplenishmentFixture> = {
  replenish_static: {
    key: 'replenish_static',
    label: 'all static — cold-start fallback everywhere',
    userId: 'mock-user',
    estimates: [
      stat('milk', 7),
      stat('bread', 7),
      stat('eggs', 28),
      stat('yogurt', 21),
      stat('coffee', 30),
    ],
  },
  replenish_low_data: {
    key: 'replenish_low_data',
    label: '1-purchase logged — still learning',
    userId: 'mock-user',
    estimates: [
      low('milk', 7, 2),
      low('bread', 7, 4),
      low('coffee', 30, 5),
    ],
  },
  replenish_observed: {
    key: 'replenish_observed',
    label: 'observed cadences — Serra-style pattern',
    userId: 'mock-user',
    estimates: [
      obs('milk', 3, 6, 1),
      obs('bread', 7, 4, 3),
      obs('yogurt', 14, 3, 5),
      obs('eggs', 10, 5, 4),
      obs('coffee', 21, 6, 10),
    ],
  },
  replenish_overdue: {
    key: 'replenish_overdue',
    label: 'past-due items — umber urgent state',
    userId: 'mock-user',
    estimates: [
      overdue('milk', 3, 5), // -2 days → "due now"
      overdue('bread', 7, 9), // -2 → "due now"
      obs('eggs', 10, 4, 8), // 2 days → urgent
      obs('coffee', 21, 6, 10), // 11 days → normal
    ],
  },
  replenish_mixed: {
    key: 'replenish_mixed',
    label: 'realistic mix — static + low-data + observed + urgent',
    userId: 'mock-user',
    estimates: [
      obs('milk', 4, 5, 1),
      low('bread', 7, 5),
      stat('flour', 365),
      overdue('yogurt', 14, 18), // -4 → "due now"
      obs('coffee', 21, 6, 19), // 2 days → urgent
      stat('rice', 1825),
    ],
  },
};

export const REPLENISHMENT_FIXTURE_KEYS = Object.keys(REPLENISHMENT_FIXTURES);

// ─── Seed driver ──────────────────────────────────────────────────────────────

/**
 * Seed the `useReplenishment` module-scope cache with a fixture. The hook
 * will resolve instantly to the seeded Map on its next mount/refresh.
 */
export function seedReplenishmentFixture(
  keyOrFixture: string | ReplenishmentFixture,
): { userId: string; map: Map<string, ReplenishmentEstimate> } {
  const fix =
    typeof keyOrFixture === 'string'
      ? REPLENISHMENT_FIXTURES[keyOrFixture]
      : keyOrFixture;
  if (!fix) {
    throw new Error(`[replenishmentMock] unknown fixture "${keyOrFixture}"`);
  }
  const map = new Map<string, ReplenishmentEstimate>();
  for (const e of fix.estimates) map.set(e.canonical, e);
  _seedReplenishmentCacheForMock(fix.userId, map);
  return { userId: fix.userId, map };
}

// ─── ?mock=… install ──────────────────────────────────────────────────────────

const ALLOWED_PARAMS = new Set(REPLENISHMENT_FIXTURE_KEYS);

/**
 * Call once from main.tsx (after the event bus is loaded). Parses
 * `?mock=replenish_<fixture>` or `?mock=<fixture>` from the URL and
 * seeds the matching fixture. No-op when the param is missing or
 * doesn't match an allowed key.
 */
export function installReplenishmentMockFromURL(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('mock');
  if (!raw) return;
  // accept "replenish_static" or "static" forms — we only own the
  // replenish_* namespace so the bare "static" form is rejected to keep
  // out of the grocery routing mock's keyspace.
  if (!ALLOWED_PARAMS.has(raw)) return;
  seedReplenishmentFixture(raw);
}
