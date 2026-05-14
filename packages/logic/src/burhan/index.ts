/**
 * @ollie/logic · burhan life-event tree
 *
 * Constitutional rule (brand book): "Burhan never decays based on user
 * behavior." The pure helpers in this file are append-only. There is no
 * decay function. There is no remove function. There is no expire
 * function. If you are tempted to write one, stop and re-read pod-b-pitch.
 *
 * Events are stamped with a deterministic position (px, py in [0, 1])
 * derived from a hash of the event id, so positions stay stable across
 * reloads without storing layout data in the event itself.
 */

export type BurhanElementType =
  | 'leaf'
  | 'gold_leaf'
  | 'fruit'
  | 'flower'
  | 'canopy_fruit';

export interface BurhanEvent {
  /** Event id — primary key. Hash drives placement. */
  id: string;
  /** Visual element type. */
  type: BurhanElementType;
  /** Wall-clock ts of the originating life-event. */
  ts: number;
  /** Module that emitted the originating event. */
  source_module: string;
  /** Originating event id, if any (`'manual'` when seeded by user). */
  source_event_id: string;
}

export interface BurhanState {
  events: BurhanEvent[];
}

export interface PositionedElement extends BurhanEvent {
  /** Normalized [0,1] x within the SVG layout band for this type. */
  x: number;
  /** Normalized [0,1] y within the SVG layout band for this type. */
  y: number;
  /** Stable rotation in degrees, [-25, 25]. */
  rot: number;
  /** Stable scale multiplier in [0.85, 1.15]. */
  scale: number;
}

// ─── deterministic hash ──────────────────────────────────────────────────

/** xfnv1a-style 32-bit hash. Stable across reloads. */
export function hashId(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pseudo-random [0,1) from a 32-bit seed (mulberry32). Stable per seed. */
function rand01(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── layout band per element type ────────────────────────────────────────
// Bands are normalized to the BurhanTree SVG canvas. y=0 is the canopy top,
// y=1 is the soil. Each element type lives in a different band so adding
// 80 leaves doesn't crowd out flowers/fruit.

interface Band { x: [number, number]; y: [number, number]; }

const BANDS: Record<BurhanElementType, Band> = {
  leaf:         { x: [0.10, 0.90], y: [0.10, 0.55] },
  gold_leaf:    { x: [0.15, 0.85], y: [0.10, 0.45] },
  fruit:        { x: [0.20, 0.80], y: [0.30, 0.60] },
  flower:       { x: [0.10, 0.90], y: [0.20, 0.65] },
  canopy_fruit: { x: [0.30, 0.70], y: [0.05, 0.25] },
};

/**
 * Pure: derive stable position + rotation + scale for a BurhanEvent.
 * Same input → same output, always. No wall-clock reads.
 */
export function positionFor(ev: BurhanEvent): PositionedElement {
  const seed = hashId(ev.id + ':' + ev.type);
  const r = rand01(seed);
  const band = BANDS[ev.type] ?? BANDS.leaf;
  const x = band.x[0] + r() * (band.x[1] - band.x[0]);
  const y = band.y[0] + r() * (band.y[1] - band.y[0]);
  const rot = (r() - 0.5) * 50;       // [-25, 25]
  const scale = 0.85 + r() * 0.3;     // [0.85, 1.15]
  return { ...ev, x, y, rot, scale };
}

/**
 * Append-only state mutation. Returns a NEW state object — never mutates
 * the input. Dedupes by event id so an idempotent listener can call this
 * repeatedly without growing the tree.
 *
 * NEVER write a remove or decay variant of this function.
 */
export function addEvent(state: BurhanState, ev: BurhanEvent): BurhanState {
  const events = state?.events ?? [];
  if (!ev || !ev.id) return { events };
  if (events.some((e) => e.id === ev.id)) return { events };
  return { events: [...events, ev] };
}

/** Last N events by ts (descending). Used by the mini-burhan tile. */
export function lastN(state: BurhanState, n: number): BurhanEvent[] {
  const events = state?.events ?? [];
  return [...events].sort((a, b) => b.ts - a.ts).slice(0, Math.max(0, n));
}

/** All events positioned. Used by /garden full view. */
export function positionedAll(state: BurhanState): PositionedElement[] {
  return (state?.events ?? []).map(positionFor);
}

/** Map an event-bus event name → element type. Returns null when unmapped. */
export function elementTypeFor(eventName: string): BurhanElementType | null {
  switch (eventName) {
    case 'cycle:period_logged':           return 'flower';
    case 'finance:subscription_cancelled': return 'fruit';
    case 'admin:appointment_completed':   return 'leaf';
    case 'finance:bill_paid_on_time':     return 'gold_leaf';
    case 'body:doctor_visit_completed':   return 'canopy_fruit';
    case 'habits:completed':              return 'leaf';
    case 'burhan:add_leaf':               return 'leaf';
    case 'burhan:add_gold_leaf':          return 'gold_leaf';
    case 'burhan:add_fruit':              return 'fruit';
    case 'burhan:add_flower':             return 'flower';
    case 'burhan:add_canopy_fruit':       return 'canopy_fruit';
    default:                              return null;
  }
}
