/**
 * Body module · domain types.
 *
 * The body module is event-log shaped, not catalog shaped: every brain-dump
 * fragment that lands here becomes one immutable `BodyEvent` row. The
 * router emits a small action vocabulary (water / movement / symptom / …);
 * we collapse those into a single `kind` enum plus a free-form `data`
 * payload so we don't have to migrate the schema every time the router
 * grows a new action.
 *
 * Data is intentionally loose-typed (Record<string, unknown>) — the
 * handler is the only thing that writes, and the screen reads through
 * narrow helpers (e.g. `getAmountMl`) that fall back gracefully when a
 * field is missing.
 */

/**
 * One canonical event kind per BodyAction in router/schema.ts.
 * Kept as a closed union so the handler + UI grouping stay in sync.
 */
export type BodyEventKind =
  | 'water'
  | 'movement'
  | 'symptom'
  | 'supplement'
  | 'episode'
  | 'posture'
  | 'hunger';

/** Soft UI grouping — wider buckets than `BodyEventKind`. */
export type BodySection = 'water' | 'movement' | 'symptoms' | 'supplements' | 'other';

/**
 * One logged body moment. `data` carries action-specific fields like
 * `amountMl`, `symptom`, `movementType`, etc. — see `handler.ts` for the
 * exact shape per kind.
 */
export interface BodyEvent {
  id: string;
  kind: BodyEventKind;
  data: Record<string, unknown>;
  loggedAt: number; // ms since epoch
}

/** UI bucket for grouping rows on the screen. */
export function sectionForKind(kind: BodyEventKind): BodySection {
  switch (kind) {
    case 'water':
      return 'water';
    case 'movement':
      return 'movement';
    case 'symptom':
      return 'symptoms';
    case 'supplement':
      return 'supplements';
    case 'episode':
    case 'posture':
    case 'hunger':
      return 'other';
  }
}

/** Normalise free-text labels (movement type, symptom, supplement name). */
export function normaliseLabel(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Default water serving size — used when the router emits `log_water`
 * without an explicit `amountMl` ("had a glass of water"). 250 mL is the
 * editorial-glass convention; not load-bearing.
 */
export const DEFAULT_GLASS_ML = 250;

/** Type-safe data accessors — `data` is unknown, these stay tolerant. */
export function getAmountMl(e: BodyEvent): number | null {
  const v = e.data['amountMl'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function getDurationMin(e: BodyEvent): number | null {
  const v = e.data['durationMin'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function getLabel(e: BodyEvent): string {
  const v = e.data['label'];
  return typeof v === 'string' ? v : '';
}

export function getSeverity(e: BodyEvent): number | null {
  const v = e.data['severity'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function getBodyPart(e: BodyEvent): string | null {
  const v = e.data['bodyPart'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function getDose(e: BodyEvent): string | null {
  const v = e.data['dose'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Adult baseline daily water target, in 250 mL glasses. The familiar
 * "~8 cups a day" rule of thumb (U.S. National Academies' ~2 L adequate
 * intake from beverages ≈ 8 cups). Used as the fallback when age is unknown.
 */
export const DEFAULT_WATER_TARGET = 8;

/**
 * Age-based daily water target, in 250 mL glasses.
 *
 * Keeps it simple + non-judgmental — a gentle nudge, not a clinical
 * prescription, and never shame-shaped. Bands (loosely after the NAM adequate
 * -intake-by-age tables, scaled to 250 mL glasses):
 *   - children (4–8):     ~5 glasses
 *   - older children (9–13): ~7 glasses
 *   - teens + adults (14–55): ~8 glasses (the familiar baseline)
 *   - 56+:                ~7 glasses (thirst sensation dulls with age; a
 *                          slightly lower headline target reads as kinder
 *                          than an unreachable one)
 *
 * Returns the adult baseline (8) for any missing / out-of-range age so a
 * fresh install always has a sensible denominator.
 */
export function waterTargetForAge(age: number | null | undefined): number {
  if (typeof age !== 'number' || !Number.isFinite(age) || age <= 0) {
    return DEFAULT_WATER_TARGET;
  }
  if (age < 9) return 5;
  if (age < 14) return 7;
  if (age <= 55) return 8;
  return 7;
}

/** Midnight-of-today in local time, ms since epoch. */
export function startOfTodayMs(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
