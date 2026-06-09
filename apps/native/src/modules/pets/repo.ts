/**
 * Pets module · repository.
 *
 * Thin typed wrapper over the SQLite layer. Repository functions are the
 * ONLY place SQL strings live for pets — handlers and screens call these
 * and stay query-agnostic.
 *
 * Conventions:
 *   - Every action becomes a new row (no merging by name — care/feed/etc.
 *     are historical events, not stateful items like grocery pantry).
 *   - Kind-specific fields are serialised into the `data` JSON column.
 *   - `petName` is normalised to lowercase before storage.
 *   - All times are ms-since-epoch integers (SQLite INTEGER).
 */

import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
import { sql } from '../../storage';
import {
  normalisePetName,
  normaliseSupplement,
  type PetEvent,
  type PetEventData,
  type PetEventKind,
} from './types';

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface PetEventRow {
  id: string;
  pet_name: string | null;
  kind: string;
  data: string;
  logged_at: number;
  [col: string]: unknown;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── events ───────────────────────────────────────────────────────────────

export const events = {
  /**
   * All events, most recent first. The screen partitions by kind in
   * memory — cheaper than five separate queries for the small volume
   * we expect (a couple of pets, a few logs per day).
   */
  async list(): Promise<PetEvent[]> {
    const rows = await sql.select<PetEventRow>(
      `SELECT id, pet_name, kind, data, logged_at
       FROM pets_events
       ORDER BY logged_at DESC`,
    );
    return rows.map(rowToPetEvent);
  },

  /**
   * Append one care event ("brushed Tontin", "cleaned the cage", etc.).
   * The router emits a short free-form `what` string.
   */
  async logCare(input: { petName?: string | null; what: string }): Promise<PetEvent> {
    const petName = normalisePetName(input.petName);
    const data: PetEventData = { kind: 'care', what: input.what.trim() };
    return insert(petName, 'care', data);
  },

  /** Append one observation — a behavioural note ("Pinpon limping"). */
  async logObservation(input: {
    petName?: string | null;
    note: string;
  }): Promise<PetEvent> {
    const petName = normalisePetName(input.petName);
    const data: PetEventData = { kind: 'observation', note: input.note.trim() };
    return insert(petName, 'observation', data);
  },

  /** Append one vet event — optional reason ("annual checkup"). */
  async logVet(input: {
    petName?: string | null;
    reason?: string | null;
  }): Promise<PetEvent> {
    const petName = normalisePetName(input.petName);
    const data: PetEventData = {
      kind: 'vet',
      reason: input.reason?.trim() || null,
    };
    return insert(petName, 'vet', data);
  },

  /** Append one feed event — no payload beyond pet + timestamp. */
  async logFeed(input: { petName?: string | null }): Promise<PetEvent> {
    const petName = normalisePetName(input.petName);
    const data: PetEventData = { kind: 'feed' };
    return insert(petName, 'feed', data);
  },

  /**
   * Append one supplement event. The CRITICAL case is `vitamin_c` for
   * guinea pigs: missing it = scurvy, so we keep the supplement key
   * verbatim so the UI can query "was vitamin C logged today?".
   */
  async logSupplement(input: {
    petName?: string | null;
    supplement: string;
    dose?: string | null;
  }): Promise<PetEvent> {
    const petName = normalisePetName(input.petName);
    const data: PetEventData = {
      kind: 'supplement',
      supplement: normaliseSupplement(input.supplement),
      dose: input.dose?.trim() || null,
    };
    return insert(petName, 'supplement', data);
  },

  /**
   * "When was the last vitamin C log?" — returns the most recent ms
   * timestamp across ALL pets (or null if never). Cheap dedicated query
   * so the box header can render a single dot without iterating events
   * in JS.
   */
  async lastSupplementAt(supplement: string): Promise<number | null> {
    const key = normaliseSupplement(supplement);
    // We have to LIKE-match on the JSON blob — fine for the small volume
    // pets generates, and we already pull `kind='supplement'` first.
    const rows = await sql.select<PetEventRow>(
      `SELECT id, pet_name, kind, data, logged_at
       FROM pets_events
       WHERE kind = 'supplement'
       ORDER BY logged_at DESC`,
    );
    for (const r of rows) {
      const parsed = safeParse(r.data);
      if (parsed && parsed.kind === 'supplement' && parsed.supplement === key) {
        return r.logged_at;
      }
    }
    return null;
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM pets_events WHERE id = ?`, [id]);
  },
};

// ─── helpers ──────────────────────────────────────────────────────────────

async function insert(
  petName: string | null,
  kind: PetEventKind,
  data: PetEventData,
): Promise<PetEvent> {
  const id = newId();
  const now = Date.now();
  await sql.execute(
    `INSERT INTO pets_events (id, pet_name, kind, data, logged_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, petName, kind, JSON.stringify(data), now],
  );
  return { id, petName, kind, data, loggedAt: now };
}

function rowToPetEvent(r: PetEventRow): PetEvent {
  const parsed = safeParse(r.data);
  const kind = (r.kind as PetEventKind);
  // Defensive fallback: if the JSON is corrupted / older shape, surface
  // something usable rather than crashing the whole list.
  const data: PetEventData = parsed ?? fallbackData(kind);
  return {
    id: r.id,
    petName: r.pet_name,
    kind,
    data,
    loggedAt: r.logged_at,
  };
}

function safeParse(raw: string): PetEventData | null {
  try {
    const parsed = JSON.parse(raw) as PetEventData;
    if (parsed && typeof parsed === 'object' && 'kind' in parsed) return parsed;
    return null;
  } catch {
    return null;
  }
}

function fallbackData(kind: PetEventKind): PetEventData {
  switch (kind) {
    case 'care':
      return { kind: 'care', what: '' };
    case 'observation':
      return { kind: 'observation', note: '' };
    case 'vet':
      return { kind: 'vet', reason: null };
    case 'feed':
      return { kind: 'feed' };
    case 'supplement':
      return { kind: 'supplement', supplement: '', dose: null };
  }
}

// ─── cadence ──────────────────────────────────────────────────────────────
//
// Pets events are append-only — every feed / supplement / vet log is a
// fresh row keyed by `pet_name` + JSON `data`. The cadence signals we
// surface in the UI:
//
//   - per-pet FEED rhythm  → "fed every 8 hours · usually every day"
//   - per-pet SUPPLEMENT   → "vitamin c · last 1 day ago, usually daily"
//
// Care / observation / vet events vary too widely in shape to produce a
// useful per-row cadence (one row carries a vet visit, the next a brush)
// — we leave those silent.

export const cadence = {
  /**
   * Feed cadence for one pet. Filters `pets_events` rows where
   * `kind = 'feed'` and `pet_name` matches the normalised key.
   *
   * `petName` may be null (the user logged a feed without naming the pet);
   * in that case we return cadence over every untagged feed row.
   */
  async getFeedCadenceFor(petName: string | null): Promise<CadenceEstimate> {
    const key = normalisePetName(petName);
    const rows = key
      ? await sql.select<PetEventRow>(
          `SELECT id, pet_name, kind, data, logged_at
           FROM pets_events
           WHERE kind = 'feed' AND pet_name = ?
           ORDER BY logged_at ASC`,
          [key],
        )
      : await sql.select<PetEventRow>(
          `SELECT id, pet_name, kind, data, logged_at
           FROM pets_events
           WHERE kind = 'feed' AND pet_name IS NULL
           ORDER BY logged_at ASC`,
        );
    return computeCadence(
      rows.map((r) => ({ ts: r.logged_at, label: key ?? 'feed' })),
    );
  },

  /**
   * Supplement cadence for one (pet, supplement) pair. Filters by
   * `kind = 'supplement'` + matching `pet_name` + matching JSON
   * `data.supplement`. LIKE-scan over the JSON blob is fine here —
   * pets generates small row volumes (a few logs per day).
   */
  async getSupplementCadenceFor(
    petName: string | null,
    supplement: string,
  ): Promise<CadenceEstimate> {
    const petKey = normalisePetName(petName);
    const suppKey = normaliseSupplement(supplement);
    if (!suppKey) return computeCadence([]);
    const rows = petKey
      ? await sql.select<PetEventRow>(
          `SELECT id, pet_name, kind, data, logged_at
           FROM pets_events
           WHERE kind = 'supplement' AND pet_name = ?
           ORDER BY logged_at ASC`,
          [petKey],
        )
      : await sql.select<PetEventRow>(
          `SELECT id, pet_name, kind, data, logged_at
           FROM pets_events
           WHERE kind = 'supplement' AND pet_name IS NULL
           ORDER BY logged_at ASC`,
        );
    const series = rows
      .map((r) => {
        const parsed = safeParse(r.data);
        if (parsed && parsed.kind === 'supplement' && parsed.supplement === suppKey) {
          return { ts: r.logged_at, label: suppKey };
        }
        return null;
      })
      .filter((x): x is { ts: number; label: string } => x !== null);
    return computeCadence(series);
  },
};
