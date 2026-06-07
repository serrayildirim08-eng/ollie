/**
 * Mood module · domain types.
 *
 * The mood module is event-log shaped, not catalog shaped: every brain-dump
 * fragment that lands here becomes one immutable `MoodEvent` row. The
 * router emits a small action vocabulary (mood / energy / self-talk); we
 * collapse those into a single `kind` enum plus a free-form `data` payload
 * so we don't have to migrate the schema every time the router grows a new
 * action.
 *
 * Data is intentionally loose-typed (Record<string, unknown>) — the
 * handler is the only thing that writes, and the screen reads through
 * narrow helpers (e.g. `getLabel`) that fall back gracefully when a field
 * is missing.
 */

/**
 * One canonical event kind per MoodAction the router emits. Kept as a
 * closed union so the handler + UI grouping stay in sync.
 */
export type MoodEventKind = 'mood' | 'energy' | 'self_talk';

/** Soft UI grouping — for the mood box one bucket maps to one kind. */
export type MoodSection = 'mood' | 'energy' | 'self_talk';

/**
 * The action vocabulary the router emits for this module.
 *
 * NOTE: this lives here, not in router/schema.ts, because the schema's
 * `Module` union + `ActionPayload` are owned by Serra (she wires the mood
 * entry herself). The handler narrows `fragment.payload` to this union; the
 * shapes mirror what the router will produce per action.
 */
export type MoodAction =
  | { module: 'mood'; action: 'log_mood'; label: string; valence?: number; intensity?: number }
  | { module: 'mood'; action: 'log_energy'; level: number; label?: string }
  | { module: 'mood'; action: 'self_talk'; statement: string; valence?: number };

/**
 * One logged mood moment. `data` carries action-specific fields like
 * `label`, `valence`, `level`, `statement` — see `handler.ts` for the
 * exact shape per kind.
 */
export interface MoodEvent {
  id: string;
  kind: MoodEventKind;
  data: Record<string, unknown>;
  loggedAt: number; // ms since epoch
}

/** UI bucket for grouping rows on the screen. */
export function sectionForKind(kind: MoodEventKind): MoodSection {
  switch (kind) {
    case 'mood':
      return 'mood';
    case 'energy':
      return 'energy';
    case 'self_talk':
      return 'self_talk';
  }
}

/** Type-safe data accessors — `data` is unknown, these stay tolerant. */
export function getLabel(e: MoodEvent): string {
  const v = e.data['label'];
  return typeof v === 'string' ? v : '';
}

/** Signed mood valence (negative = low, positive = high), or null. */
export function getValence(e: MoodEvent): number | null {
  const v = e.data['valence'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Energy level (e.g. 1–5), or null when absent. */
export function getEnergyLevel(e: MoodEvent): number | null {
  const v = e.data['level'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Free-text self-talk statement, or empty string. */
export function getStatement(e: MoodEvent): string {
  const v = e.data['statement'];
  return typeof v === 'string' ? v : '';
}

/** Optional mood intensity, or null when absent. */
export function getIntensity(e: MoodEvent): number | null {
  const v = e.data['intensity'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Midnight-of-today in local time, ms since epoch. */
export function startOfTodayMs(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
