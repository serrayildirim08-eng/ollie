/**
 * apps/native · modules/brain/harm.ts  —  harm-of-deferral gatherer + writer
 *
 * Deliverable 3 of the silent-observer brain. Gathers world-facts from the
 * existing module repos (grocery pantry, finance bills, admin renewals, goals),
 * runs the PURE detector (@ollie/logic/brain · detectHarm), and persists the
 * emitted events into `brain_harm_events`.
 *
 * Harm kinds:
 *   - 'spoiled': pantry item past predicted run-out, still unarchived.
 *   - 'late':    recurring finance bill past its expected cadence cycle.
 *   - 'missed':  a renewal or goal whose deadline passed while still open.
 *
 * Persistence is idempotent: the detector's stable id is the PRIMARY KEY, so
 * INSERT OR IGNORE means re-detecting the same lapse never double-counts. This
 * is OBSERVATION, not blame — nothing here surfaces to the user as shame.
 *
 * Best-effort: each repo read is isolated, and a write failure never throws
 * into the caller (boot / dump path). Mirrors the new harm-event count into
 * the store (`brain.harmEvents`) for any future quiet surface; that mirror is
 * additive and optional.
 */

import { detectHarm } from '@ollie/logic/brain';
import type { HarmInputs } from '@ollie/logic/brain';
import type { Store } from '@ollie/store';

import { sql } from '../../storage';
import { migrateBrain } from './migrate';
import { pantry as groceryPantry } from '../grocery/repo';
import { migrateGrocery } from '../grocery/migrate';
import { bills as financeBills } from '../finance/repo';
import { migrateFinance } from '../finance/migrate';
import { renewals as adminRenewals } from '../admin/repo';
import { migrateAdmin } from '../admin/migrate';
import { goals as goalsRepo } from '../goals/repo';
import { migrateGoals } from '../goals/migrate';

interface HarmRow {
  id: string;
  ref_kind: string;
  ref_id: string;
  harm_kind: string;
  detected_at: number;
  [col: string]: unknown;
}

/** Read world-facts from the module repos, each isolated so one empty/missing
 *  table can't starve the others. Returns the detector's input shape. */
async function gatherInputs(): Promise<HarmInputs> {
  const [pantry, bills, renewals, goals] = await Promise.all([
    (async () => {
      try {
        await migrateGrocery();
        const rows = await groceryPantry.listActive();
        return rows.map((p) => ({
          id: p.id,
          name: p.name,
          predictedOutAtMs: p.predictedOutAtMs ?? null,
          archived: false, // listActive() already excludes archived rows
        }));
      } catch { return []; }
    })(),
    (async () => {
      try {
        await migrateFinance();
        const rows = await financeBills.list();
        return rows.map((b) => ({
          id: b.id,
          merchant: b.merchant,
          addedAt: b.addedAt,
          cadence: b.cadence,
        }));
      } catch { return []; }
    })(),
    (async () => {
      try {
        await migrateAdmin();
        const rows = await adminRenewals.list();
        return rows.map((r) => ({
          id: r.id,
          refKind: 'renewal',
          dueDate: r.dueDate,
          done: false, // renewals have no done flag — an open reminder
        }));
      } catch { return []; }
    })(),
    (async () => {
      try {
        await migrateGoals();
        const rows = await goalsRepo.list();
        return rows.map((g) => ({
          id: g.id,
          refKind: 'goal',
          dueDate: g.targetDate ?? null,
          done: false, // a still-listed goal is open
        }));
      } catch { return []; }
    })(),
  ]);

  return {
    pantry,
    bills,
    deadlines: [...renewals, ...goals],
  };
}

/**
 * Detect harm-of-deferral across the current world and persist new events.
 * Returns the number of NEW (not-previously-recorded) harm events written.
 * Never throws — best-effort, safe to fire-and-forget on boot / after dumps.
 */
export async function scanAndRecordHarm(
  store: Store | null,
  now: number = Date.now(),
): Promise<number> {
  try {
    await migrateBrain();
    const inputs = await gatherInputs();
    const events = detectHarm(inputs, now);
    if (events.length === 0) {
      if (store) store.set('brain', 'harmEventsLastScanAt', now);
      return 0;
    }

    let written = 0;
    for (const ev of events) {
      // INSERT OR IGNORE on the stable PK → idempotent; only the first
      // detection of a given lapse counts. rowsAffected tells us if it landed.
      const res = await sql.execute(
        `INSERT OR IGNORE INTO brain_harm_events
           (id, ref_kind, ref_id, harm_kind, detected_at)
         VALUES (?, ?, ?, ?, ?)`,
        [ev.id, ev.refKind, ev.refId, ev.harmKind, ev.detectedAt],
      );
      if (res.rowsAffected > 0) written += 1;
    }

    if (store) {
      store.set('brain', 'harmEventCount', await countHarmEvents());
      store.set('brain', 'harmEventsLastScanAt', now);
    }
    return written;
  } catch (err) {
    console.error('[brain] scanAndRecordHarm failed (non-fatal):', err);
    return 0;
  }
}

/** Total persisted harm events. Best-effort; 0 on any read failure. */
export async function countHarmEvents(): Promise<number> {
  try {
    await migrateBrain();
    const rows = await sql.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM brain_harm_events`,
    );
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** All persisted harm events, newest-first. Best-effort; [] on failure. */
export async function listHarmEvents(): Promise<HarmRow[]> {
  try {
    await migrateBrain();
    return await sql.select<HarmRow>(
      `SELECT id, ref_kind, ref_id, harm_kind, detected_at
       FROM brain_harm_events
       ORDER BY detected_at DESC`,
    );
  } catch {
    return [];
  }
}
