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
import { newId } from '../../storage/id';
import {
  coerceKind,
  normaliseName,
  parseSchedule,
  type CabinetItem,
  type EventKind,
  type Medication,
  type MedicationEvent,
  type MedicationEventWithName,
  type MedicationKind,
} from './types';
import {
  coercePurpose,
  purposeFor,
  type MedPurpose,
} from './purposeMap';
import { decrementQty } from './lowStock';

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

interface CabinetRow {
  id: string;
  name: string;
  purpose: string;
  dose_label: string | null;
  qty: number | null;
  low_flag: number;
  created_at: number;
  [col: string]: unknown;
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
    const id = newId('m_');
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

  /**
   * Merge "HH:MM" slots into a med's daily schedule, deduped + sorted. Ensures
   * the med is registered first ("started magnesium at night" → adds the med +
   * its evening slot so it shows on the today tab). Idempotent: re-adding the
   * same slot is a no-op. Returns the updated medication.
   */
  async addScheduleSlots(name: string, slots: string[]): Promise<Medication> {
    const med = await this.ensure(name);
    const merged = parseSchedule([...med.schedule, ...slots]);
    if (merged.length === med.schedule.length && merged.every((s, i) => s === med.schedule[i])) {
      return med; // nothing new
    }
    await sql.execute(
      `UPDATE medications_registry SET schedule = ? WHERE id = ?`,
      [JSON.stringify(merged), med.id],
    );
    return { ...med, schedule: merged };
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

// ─── cabinet inventory ──────────────────────────────────────────────────────
//
// Stock view, deduped by normalised name (UNIQUE index). Every write path
// goes through `upsert`, so a second "started magnesium" refreshes the row
// rather than creating a duplicate — the same idempotency the registry uses.

export const cabinet = {
  async list(): Promise<CabinetItem[]> {
    const rows = await sql.select<CabinetRow>(
      `SELECT id, name, purpose, dose_label, qty, low_flag, created_at
       FROM medication_cabinet
       ORDER BY created_at DESC`,
    );
    return rows.map(rowToCabinetItem);
  },

  async findByName(name: string): Promise<CabinetItem | null> {
    const n = normaliseName(name);
    const rows = await sql.select<CabinetRow>(
      `SELECT id, name, purpose, dose_label, qty, low_flag, created_at
       FROM medication_cabinet WHERE name = ? LIMIT 1`,
      [n],
    );
    return rows.length > 0 ? rowToCabinetItem(rows[0]!) : null;
  },

  /**
   * Add / refresh a cabinet item, deduped by normalised name. Purpose is
   * derived from the name (purposeMap) when the caller doesn't pass one;
   * an explicit purpose (router Layer-2) wins. On an existing row we only
   * OVERWRITE fields the caller actually supplied — a later bare "have
   * magnesium" must not wipe a previously-entered dose or qty. Idempotent:
   * the same add twice leaves one row.
   */
  async upsert(input: {
    name: string;
    purpose?: MedPurpose | null;
    doseLabel?: string | null;
    qty?: number | null;
  }): Promise<CabinetItem> {
    const name = normaliseName(input.name);
    const purpose = input.purpose ? coercePurpose(input.purpose) : purposeFor(name);
    const existing = await cabinet.findByName(name);

    if (existing) {
      const nextPurpose = input.purpose ? coercePurpose(input.purpose) : existing.purpose;
      const nextDose =
        input.doseLabel !== undefined ? input.doseLabel ?? null : existing.doseLabel;
      const nextQty = input.qty !== undefined ? normQty(input.qty) : existing.qty;
      await sql.execute(
        `UPDATE medication_cabinet SET purpose = ?, dose_label = ?, qty = ? WHERE id = ?`,
        [nextPurpose, nextDose, nextQty, existing.id],
      );
      return { ...existing, purpose: nextPurpose, doseLabel: nextDose, qty: nextQty };
    }

    const id = newId('mc_');
    const now = Date.now();
    const doseLabel = input.doseLabel ?? null;
    const qty = input.qty !== undefined ? normQty(input.qty) : null;
    await sql.execute(
      `INSERT INTO medication_cabinet (id, name, purpose, dose_label, qty, low_flag, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [id, name, purpose, doseLabel, qty, now],
    );
    return { id, name, purpose, doseLabel, qty, lowFlag: false, createdAt: now };
  },

  /**
   * Set the manual low-flag for a med by name (the override). Creates the
   * cabinet row first when the med isn't stocked yet ("running low on vitamin
   * d" before it was ever added). Idempotent — flagging low twice is one flag.
   */
  async setLowByName(name: string, low: boolean): Promise<CabinetItem> {
    const item = (await cabinet.findByName(name)) ?? (await cabinet.upsert({ name }));
    await sql.execute(
      `UPDATE medication_cabinet SET low_flag = ? WHERE id = ?`,
      [low ? 1 : 0, item.id],
    );
    return { ...item, lowFlag: low };
  },

  /** Set the low-flag by id (cabinet UI tap). */
  async setLow(id: string, low: boolean): Promise<void> {
    await sql.execute(
      `UPDATE medication_cabinet SET low_flag = ? WHERE id = ?`,
      [low ? 1 : 0, id],
    );
  },

  /**
   * Auto count-down: decrement a med's qty by one on a "taken" event, keyed
   * by name. No-op when the med isn't in the cabinet or has no qty entered
   * (manual-only items don't auto-count). Returns the new qty, or null.
   */
  async decrementOnTaken(name: string): Promise<number | null> {
    const item = await cabinet.findByName(name);
    if (!item || item.qty == null) return null;
    const next = decrementQty(item.qty);
    await sql.execute(`UPDATE medication_cabinet SET qty = ? WHERE id = ?`, [next, item.id]);
    return next;
  },

  /** Update purpose / dose / qty from the cabinet UI editor. */
  async update(
    id: string,
    patch: { purpose?: MedPurpose; doseLabel?: string | null; qty?: number | null },
  ): Promise<void> {
    const rows = await sql.select<CabinetRow>(
      `SELECT id, name, purpose, dose_label, qty, low_flag, created_at
       FROM medication_cabinet WHERE id = ? LIMIT 1`,
      [id],
    );
    if (rows.length === 0) return;
    const cur = rowToCabinetItem(rows[0]!);
    const purpose = patch.purpose ? coercePurpose(patch.purpose) : cur.purpose;
    const doseLabel = patch.doseLabel !== undefined ? patch.doseLabel ?? null : cur.doseLabel;
    const qty = patch.qty !== undefined ? normQty(patch.qty) : cur.qty;
    await sql.execute(
      `UPDATE medication_cabinet SET purpose = ?, dose_label = ?, qty = ? WHERE id = ?`,
      [purpose, doseLabel, qty, id],
    );
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM medication_cabinet WHERE id = ?`, [id]);
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

  /** "later" — the user pushed a scheduled dose off for now (no cabinet
   *  count-down; it's not taken, just set aside). */
  async logLater(input: { medName: string }): Promise<MedicationEvent> {
    const med = await medications.ensure(input.medName);
    return writeEvent(med.id, 'later', {});
  },

  /** "skip today" — the user is intentionally skipping this dose. Calm, no
   *  shame; does not decrement the cabinet. */
  async logSkipped(input: { medName: string }): Promise<MedicationEvent> {
    const med = await medications.ensure(input.medName);
    return writeEvent(med.id, 'skipped', {});
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
  const id = newId('m_');
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

function rowToCabinetItem(r: CabinetRow): CabinetItem {
  return {
    id: r.id,
    name: r.name,
    purpose: coercePurpose(r.purpose),
    doseLabel: r.dose_label ?? null,
    qty: r.qty == null ? null : Number(r.qty),
    lowFlag: r.low_flag === 1,
    createdAt: r.created_at,
  };
}

/** Coerce a qty into a stored non-negative integer, or null when absent. */
function normQty(raw: number | null | undefined): number | null {
  if (raw == null || typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.floor(raw));
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
