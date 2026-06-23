/**
 * apps/native · modules/brain/actions.ts  —  offers really act (Sprint 3)
 *
 * DECISION 2 — when a noticing offers an action and she accepts it, the
 * assistant ACTUALLY does the thing. The pure layer (@ollie/logic/brain
 * actions) owns the serialisable descriptor (kind + label + payload); THIS is
 * the generic dispatcher that turns a descriptor into a real side effect.
 *
 * Wired actions (each = a `kind` in the pure layer + a `case` here):
 *   - add_to_grocery_list — the milk/replenish noticing → inserts each item
 *     into the grocery shopping list (the same call an "add milk" dump takes).
 *   - defer_tasks         — the sleep-debt noticing → pushes today's NON-URGENT
 *     work + admin tasks to tomorrow (urgency decided by the shared deferral +
 *     harm signals, never reinvented here).
 *   - add_admin_task      — the renewal noticing → creates an admin task so it
 *     surfaces in /todo.
 *   - surface_decision    — the stale-decision noticing → un-snoozes a recurring
 *     decision so it leads /todo today.
 *
 * Returns whether the action succeeded so the caller can clear the noticing
 * only on success. Best-effort: a thrown repo error is caught + reported false.
 */

import type { NoticingAction } from '@ollie/logic/brain';
import { computeDeferral } from '@ollie/logic/brain';
import { shopping } from '../grocery/repo';
import { migrateGrocery } from '../grocery/migrate';
import { tasks as workTasks } from '../work/repo';
import { migrateWork } from '../work/migrate';
import { syncToStore as syncWorkToStore } from '../work/bridge';
import { tasks as adminTasks, recurringDecisions } from '../admin/repo';
import { migrateAdmin } from '../admin/migrate';
import { syncToStore as syncAdminToStore } from '../admin/bridge';
import { listHarmEvents } from './harm';

/**
 * Lazily resolve the app store singleton. Imported on demand (not at module
 * top) so merely importing this module never triggers the store's boot
 * migrations — that keeps executeAction unit-testable in a bare environment
 * (the pure milk path needs no store at all).
 */
async function getStore() {
  const mod = await import('../../store');
  return mod.store;
}

/** Re-run the work + admin bridges so module stores + the brain surface
 *  recompute off freshly-mutated rows. Best-effort: a mirror failure never
 *  undoes the underlying write. */
async function refreshBridges(opts: { work?: boolean; admin?: boolean }): Promise<void> {
  try {
    const store = await getStore();
    if (opts.work) {
      try { await syncWorkToStore(store); } catch { /* non-fatal */ }
    }
    if (opts.admin) {
      try { await syncAdminToStore(store); } catch { /* non-fatal */ }
    }
  } catch {
    // store unavailable (e.g. unit test) — the DB write already landed.
  }
}

/** Local ISO yyyy-mm-dd `daysAhead` days from `now` (0 = today, 1 = tomorrow). */
function isoLocalDay(daysAhead: number, now: number = Date.now()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + daysAhead);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Defer every NON-URGENT task due TODAY to tomorrow, across work + admin.
 *
 * "non-urgent + due today" is decided with the SAME shared signals the brain
 * learns from, never reinvented:
 *   - computeDeferral(task) → skip anything already `overdue` (past-due is
 *     protected; we never auto-push something that's already late).
 *   - listHarmEvents()      → skip any task already flagged as a `missed` harm.
 *   - only rows whose `dueDate` is exactly today move (future-dated + no-date
 *     rows stay put — we lighten TODAY, not the calendar).
 *
 * Returns the count of tasks moved (0 when nothing qualified).
 */
async function deferTodaysTasks(now: number): Promise<number> {
  const today = isoLocalDay(0, now);
  const tomorrow = isoLocalDay(1, now);

  // Tasks already flagged missed (harm) are protected — never auto-defer them.
  const harmed = new Set<string>();
  try {
    for (const ev of await listHarmEvents()) {
      if (ev.harm_kind === 'missed') harmed.add(ev.ref_id);
    }
  } catch {
    // best-effort: an unreadable harm log just means no extra protection.
  }

  let moved = 0;

  // ── work tasks ──
  await migrateWork();
  const work = await workTasks.listOpen();
  for (const t of work) {
    if (t.dueDate !== today) continue; // only move what's due TODAY
    if (harmed.has(t.id)) continue;
    const signal = computeDeferral(
      { createdAt: t.createdAt, dueDate: t.dueDate, done: t.done },
      now,
    );
    if (signal.overdue) continue; // already past due = protected
    await workTasks.setDueDate(t.id, tomorrow);
    moved += 1;
  }

  // ── admin tasks ──
  await migrateAdmin();
  const admin = await adminTasks.listOpen();
  for (const t of admin) {
    if (t.dueDate !== today) continue;
    if (harmed.has(t.id)) continue;
    const signal = computeDeferral(
      { createdAt: t.createdAt, dueDate: t.dueDate, done: t.done },
      now,
    );
    if (signal.overdue) continue;
    await adminTasks.setDueDate(t.id, tomorrow);
    moved += 1;
  }

  // Re-run the bridges so the module stores + the brain surface recompute off
  // the new dates. Best-effort — a mirror failure doesn't undo the move.
  if (moved > 0) await refreshBridges({ work: true, admin: true });

  return moved;
}

/** Run a noticing's suggested action for real. Returns true on success. */
export async function executeAction(action: NoticingAction): Promise<boolean> {
  try {
    switch (action.payload.kind) {
      case 'add_to_grocery_list': {
        await migrateGrocery();
        const names = action.payload.names.filter(Boolean);
        if (names.length === 0) return false;
        // Insert each item onto the shopping list. shopping.add dedupes by
        // name, so re-accepting is harmless (just refreshes the timestamp).
        for (const name of names) {
          await shopping.add({ name });
        }
        return true;
      }

      case 'defer_tasks': {
        // Sleep-debt offer: lighten today by pushing non-urgent, due-today
        // tasks to tomorrow. Clears the noticing only if ≥1 task moved — if
        // nothing qualified, leave the offer so it isn't a silent no-op.
        const moved = await deferTodaysTasks(Date.now());
        return moved > 0;
      }

      case 'add_admin_task': {
        // Renewal offer: create an admin task so it surfaces in /todo.
        const text = (action.payload.text ?? '').toString().trim();
        if (!text) return false;
        await migrateAdmin();
        await adminTasks.add({
          kind: 'task',
          text,
          data: { kind: 'task' },
          dueDate: action.payload.dueDate ?? null,
          ballState: 'mine',
        });
        await refreshBridges({ admin: true });
        return true;
      }

      case 'surface_decision': {
        // Stale-decision offer: un-snooze the decision so it re-enters
        // listOpen and leads /todo today.
        const id = (action.payload.decisionId ?? '').toString().trim();
        if (!id) return false;
        await migrateAdmin();
        await recurringDecisions.unsnooze(id);
        await refreshBridges({ admin: true });
        return true;
      }

      default:
        return false;
    }
  } catch (err) {
    console.error('[brain] executeAction failed (non-fatal):', err);
    return false;
  }
}
