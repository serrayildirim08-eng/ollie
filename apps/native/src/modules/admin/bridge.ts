/**
 * apps/native · modules/admin/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The admin Layer-2 watcher (packages/orchestrator/src/admin.ts — Phase 1/2
 * A1–A12 + the now-wired Phase-3 A7/A11/A13/A14/A15) reads these store keys;
 * native captures tasks / phone tasks into SQLite (admin/repo.ts). This bridge
 * mirrors those rows so the detectors run on live data.
 *
 * Store keys the admin watcher reads (we write these):
 *   admin.tasks      — admin to-do tasks (the load-bearing one; logic
 *                      AdminTask shape: id/label/state/kind/done_at + the
 *                      Phase-3 fields ef_cost / cost_of_delay / doc_refs
 *                      when the row carries them)
 *   admin.phoneTasks — the "handle by phone" cluster (PhoneTaskItem[]); we
 *                      seed it from native phone-kind rows. The orchestrator's
 *                      A2 sink also appends here (deduped by id), so we
 *                      read-merge rather than overwrite.
 *
 * Fields native SQLite does NOT capture today (flagged, not fabricated):
 *   - ball_state / last_transition_at / due_date: NOW captured (#7) and
 *     mirrored below, so A9 stale-ball (v1 resurfacing) runs on live data.
 *   - ef_cost / cost_of_delay / scheduled_at / doc_refs: native admin_tasks
 *     has no columns for these, so A7/A11/A14/A15 detectors get whatever the
 *     dump/JSON envelope happens to carry (usually nothing) — they are wired
 *     in the orchestrator but starved of inputs until a capture UI lands.
 *   - decision_rules / scheduled_log (admin.state): no native source → A13
 *     recall + A15 drift read empty state. Wired, awaiting capture.
 *
 * (admin.patterns / admin._* are OUTPUT keys — do NOT touch.
 *  admin.ts also reads dump.items cross-module — owned by the dump bridge.)
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import type { AdminTask as LogicAdminTask, TaskState } from '@ollie/logic/admin';
import { tasks as tasksRepo } from './repo';
import type { AdminTask, AdminTaskKind } from './types';

/**
 * Shape of one `admin.phoneTasks` entry — mirrors the orchestrator's
 * `PhoneTaskItem` (packages/orchestrator/src/admin.ts), which isn't exported
 * from the package barrel. Kept structurally identical so the orchestrator's
 * A2 sink and this bridge write the same slice without drift.
 */
interface PhoneTaskItem {
  id: string;
  verb: string;
  ts: number;
}

/** Map a native admin task kind → the logic-layer `kind` string. */
function logicKind(kind: AdminTaskKind): string {
  // The logic detectors treat kind as free text; native's enum maps 1:1.
  return kind;
}

/**
 * Mirror SQLite admin_tasks → admin.tasks (logic shape) and seed
 * admin.phoneTasks from phone-kind rows. admin.tasks is wholly owned by this
 * bridge (clean overwrite from the source of truth). admin.phoneTasks is
 * shared with the orchestrator's A2 sink, so we read-merge-append by id.
 */
export async function syncToStore(store: Store): Promise<void> {
  const rows = await tasksRepo.list();

  // ── admin.tasks ──────────────────────────────────────────────────────────
  const tasks: LogicAdminTask[] = rows.map((r) => toLogicTask(r));
  store.set<LogicAdminTask[]>('admin', 'tasks', tasks);

  // ── admin.phoneTasks (read-merge-append by id) ─────────────────────────────
  // Seed the "handle by phone" cluster from native phone-kind rows so the UI
  // surface isn't empty before the A2 detector has fired. Merge — never clobber
  // — the orchestrator-appended entries.
  const existing = store.get<PhoneTaskItem[]>('admin', 'phoneTasks', []) ?? [];
  const byId = new Map<string, PhoneTaskItem>();
  for (const item of existing) {
    if (item && typeof item.id === 'string') byId.set(item.id, item);
  }
  for (const r of rows) {
    if (r.kind !== 'phone') continue;
    const id = `${r.text}:${r.createdAt}`;
    if (!byId.has(id)) {
      byId.set(id, { id, verb: r.text, ts: r.createdAt });
    }
  }
  const merged = [...byId.values()].sort((a, b) => a.ts - b.ts);
  store.set<PhoneTaskItem[]>('admin', 'phoneTasks', merged);
}

/**
 * Native AdminTask (id/kind/text/done/createdAt + JSON `data`) → the logic
 * AdminTask the detectors read. `done` → state + done_at so A12 last-5%
 * + the appointment-completed transition can see closed rows. Phase-3 fields
 * (ef_cost / cost_of_delay / scheduled_at / doc_refs) aren't captured natively,
 * so they're left undefined — the detectors degrade to no-op on absence.
 */
function toLogicTask(r: AdminTask): LogicAdminTask {
  const state: TaskState = r.done ? 'done' : 'active';
  return {
    id: r.id,
    label: r.text,
    title: r.text,
    kind: logicKind(r.kind),
    state,
    done_at: r.done ? r.createdAt : undefined,
    // v1 resurfacing inputs (#7/#8): the detector keys off these.
    ball_state: r.ballState,
    last_transition_at: r.lastTransitionAt,
    due_date: r.dueDate ?? undefined,
  };
}
