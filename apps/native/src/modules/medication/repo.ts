/**
 * Medication module · repository.
 *
 * Thin typed wrapper over the SQLite layer. Repository functions are the
 * ONLY place SQL strings live for medication — handlers and screens call
 * these and stay query-agnostic.
 *
 * Conventions:
 *   - Names are normalised (lowercase, collapsed whitespace) before keying.
 *   - The registry is upsert-by-name: every logging path calls
 *     `medications.ensure(name)` which returns the row, creating it on
 *     first sight.
 *   - Event payloads are stored as JSON in `data` so we can extend the
 *     event shape without a migration. Mappers unpack into typed fields.
 *   - All times are ms-since-epoch integers (SQLite INTEGER).
 */

import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
import { sql } from '../../storage';
import {
  coerceKind,
  normaliseName,
  parseSchedule,
  type EventKind,
  type Medication,
  type MedicationEvent,
  type MedicationEventWithName,
  type MedicationKind,
} from './types';

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface RegistryRow {
  id: string;
  name: string;
  created_at: number;
  kind: string;
  schedule: string;
  [col: string]: unknown;
}

interface EventRow {
  id: string;
  med_id: string;
  kind: string;
  data: string;
  logged_at: number;
  [col: string]: unknown;
}

interface EventJoinRow extends EventRow {
  med_name: string;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── registry ─────────────────────────────────────────────────────────────

export const medications = {
  async list(): Promise<Medication[]> {
    const rows = await sql.select<RegistryRow>(
      `SELECT id, name, created_at, kind, schedule
       FROM medications_registry
       ORDER BY created_at DESC`,
    );
    return rows.map(rowToMedication);
  },

  /**
   * Look up a medication by name. Returns null if not registered yet.
   */
  async findByName(name: string): Promise<Medication | null> {
    const n = normaliseName(name);
    const rows = await sql.select<RegistryRow>(
      `SELECT id, name, created_at, kind, schedule
       FROM medications_registry WHERE name = ? LIMIT 1`,
      [n],
    );
    return rows.length > 0 ? rowToMedication(rows[0]!) : null;
  },

  /**
   * Get or create a medication by name. Called from every logging path so
   * the registry self-populates as the router mentions new meds — there
   * is no separate "add medication" action.
   */
  async ensure(name: string): Promise<Medication> {
    const existing = await this.findByName(name);
    if (existing) return existing;

    const n = normaliseName(name);
    const now = Date.now();
    const id = newId();
    await sql.execute(
      `INSERT INTO medications_registry (id, name, created_at, kind, schedule)
       VALUES (?, ?, ?, 'prescription', '[]')`,
      [id, n, now],
    );
    return { id, name: n, createdAt: now, kind: 'prescription', schedule: [] };
  },

  /**
   * Persist a medication's structured profile — its kind and daily
   * schedule. Called from the Box's inline editor. `schedule` is
   * normalised + stored as a JSON array of "HH:MM" strings; once it's
   * non-empty the watcher's dueSlots/adherence path lights up.
   */
  async updateProfile(
    id: string,
    profile: { kind: MedicationKind; schedule: string[] },
  ): Promise<void> {
    await sql.execute(
      `UPDATE medications_registry SET kind = ?, schedule = ? WHERE id = ?`,
      [profile.kind, JSON.stringify(profile.schedule), id],
    );
  },

  async remove(id: string): Promise<void> {
    // Cascade events so the registry doesn't orphan logs the UI surfaces.
    await sql.execute(`DELETE FROM medications_events WHERE med_id = ?`, [id]);
    await sql.execute(`DELETE FROM medications_registry WHERE id = ?`, [id]);
  },

  /**
   * Last logged dose timestamp per medication — used by the registry
   * surface to show "last dose · 9:14am" next to each name.
   */
  async lastDoseMap(): Promise<Record<string, number>> {
    const rows = await sql.select<{ med_id: string; max_logged: number; [col: string]: unknown }>(
      `SELECT med_id, MAX(logged_at) AS max_logged
       FROM medications_events
       WHERE kind = 'dose'
       GROUP BY med_id`,
    );
    const map: Record<string, number> = {};
    for (const r of rows) map[r.med_id] = r.max_logged;
    return map;
  },
};

// ─── events ───────────────────────────────────────────────────────────────

export const events = {
  /**
   * Log a dose. Creates the medication row if it doesn't exist yet.
   * `dose` is a free-form string ("20mg", "1 tab") — router gives us
   * whatever the user said.
   */
  async logDose(input: { medName: string; dose?: string }): Promise<MedicationEvent> {
    const med = await medications.ensure(input.medName);
    return writeEvent(med.id, 'dose', { dose: input.dose ?? null });
  },

  async logMissed(input: { medName: string }): Promise<MedicationEvent> {
    const med = await medications.ensure(input.medName);
    return writeEvent(med.id, 'missed', {});
  },

  async logSideEffect(input: { medName: string; note: string }): Promise<MedicationEvent> {
    const med = await medications.ensure(input.medName);
    return writeEvent(med.id, 'side_effect', { note: input.note });
  },

  /** Events of a given kind since `sinceMs`, newest first, joined with name. */
  async listByKindSince(
    kind: EventKind,
    sinceMs: number,
  ): Promise<MedicationEventWithName[]> {
    const rows = await sql.select<EventJoinRow>(
      `SELECT e.id, e.med_id, e.kind, e.data, e.logged_at, r.name AS med_name
       FROM medications_events e
       JOIN medications_registry r ON r.id = e.med_id
       WHERE e.kind = ? AND e.logged_at >= ?
       ORDER BY e.logged_at DESC`,
      [kind, sinceMs],
    );
    return rows.map(rowToEventWithName);
  },

  /** Most recent N events of a given kind, joined with name. */
  async recentByKind(kind: EventKind, limit: number): Promise<MedicationEventWithName[]> {
    const rows = await sql.select<EventJoinRow>(
      `SELECT e.id, e.med_id, e.kind, e.data, e.logged_at, r.name AS med_name
       FROM medications_events e
       JOIN medications_registry r ON r.id = e.med_id
       WHERE e.kind = ?
       ORDER BY e.logged_at DESC
       LIMIT ?`,
      [kind, limit],
    );
    return rows.map(rowToEventWithName);
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM medications_events WHERE id = ?`, [id]);
  },
};

// ─── helpers ──────────────────────────────────────────────────────────────

async function writeEvent(
  medId: string,
  kind: EventKind,
  payload: Record<string, unknown>,
): Promise<MedicationEvent> {
  const id = newId();
  const now = Date.now();
  const data = JSON.stringify(payload);
  await sql.execute(
    `INSERT INTO medications_events (id, med_id, kind, data, logged_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, medId, kind, data, now],
  );
  return {
    id,
    medId,
    kind,
    dose: typeof payload.dose === 'string' ? payload.dose : null,
    note: typeof payload.note === 'string' ? payload.note : null,
    loggedAt: now,
  };
}

function rowToMedication(r: RegistryRow): Medication {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    kind: coerceKind(r.kind),
    schedule: parseSchedule(r.schedule),
  };
}

function rowToEvent(r: EventRow): MedicationEvent {
  const parsed = parseData(r.data);
  return {
    id: r.id,
    medId: r.med_id,
    kind: r.kind as EventKind,
    dose: typeof parsed.dose === 'string' ? parsed.dose : null,
    note: typeof parsed.note === 'string' ? parsed.note : null,
    loggedAt: r.logged_at,
  };
}

function rowToEventWithName(r: EventJoinRow): MedicationEventWithName {
  return { ...rowToEvent(r), medName: r.med_name };
}

function parseData(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ─── cadence ──────────────────────────────────────────────────────────────
//
// Dose events are append-only with `logged_at` timestamps and a typed
// `kind='dose'` filter. Per-med adherence cadence reads straight off
// `medications_events` filtered by `med_id` + `kind='dose'`.
//
// Health data: tone stays calm — no streaks, no scoring. The cadence
// surface just observes "you usually take X every Y hours" once the
// stream stabilises. Silent until 'observed' confidence.

export const cadence = {
  /**
   * Cadence for one med's dose log, keyed by med id (the cheaper path —
   * registry lookup avoided).
   */
  async getDoseCadenceFor(medId: string): Promise<CadenceEstimate> {
    const rows = await sql.select<EventRow>(
      `SELECT id, med_id, kind, data, logged_at
       FROM medications_events
       WHERE med_id = ? AND kind = 'dose'
       ORDER BY logged_at ASC`,
      [medId],
    );
    return computeCadence(
      rows.map((r) => ({ ts: r.logged_at, label: r.med_id })),
    );
  },

  /**
   * Same as `getDoseCadenceFor` but keyed by medication name. Looks up
   * the registry; returns a 'low-data' estimate when the med isn't
   * registered yet.
   */
  async getDoseCadenceForName(medName: string): Promise<CadenceEstimate> {
    const med = await medications.findByName(medName);
    if (!med) return computeCadence([]);
    return cadence.getDoseCadenceFor(med.id);
  },
};
