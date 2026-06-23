/**
 * @ollie/logic · brain · noticing ACTIONS (pure descriptors)
 *
 * Sprint 3 · DECISION 2 — "offers really act". A noticing may carry a suggested
 * action: when she accepts it, the assistant ACTUALLY does the thing (e.g. the
 * milk noticing → really inserts milk into the grocery shopping list).
 *
 * This module owns only the PURE descriptor: WHAT the action is + the data it
 * needs (the trilingual accept label + a serialisable payload). The native side
 * (apps/native/src/modules/brain) owns EXECUTE — it reads `action.kind` and
 * runs the real repo call (grocery.shopping.add). Keeping execute() out of the
 * pure layer keeps it unit-testable and free of any I/O dep, while the native
 * dispatcher stays a thin, generic switch so other noticings can attach actions
 * later by adding a kind + a case.
 */

import type { AppLang } from './copy';
import { DEFAULT_LANG } from './copy';

// ─── action kinds (extensible) ───────────────────────────────────────────────

/** The set of actions a noticing can offer. Add a kind to grow the framework. */
export type ActionKind =
  | 'add_to_grocery_list'
  | 'defer_tasks'
  | 'add_admin_task'
  | 'surface_decision'
  // ── wave 2 (richer admin offers) ──
  | 'surface_tasks' // paperwork piling → bring N stalled admin tasks to today.
  | 'break_down_task' // chronic deferral → create one smaller first-step task.
  | 'batch_block' // renewal cluster → block one day + schedule a reminder.
  // ── dateless escalation ladder (final tier) ──
  | 'archive_task'; // a date-less task survived the full ladder → archive/remove it.

/** Payload for `add_to_grocery_list`: the item names to put on the list. */
export interface AddToGroceryListPayload {
  /** Canonical-ish item names to add (e.g. ['milk']). */
  names: string[];
}

/**
 * Payload for `defer_tasks`: the sleep-debt offer to "keep today lighter".
 * Carries NO per-task data — the native executor resolves the set itself
 * (open work/admin tasks due today that aren't urgent/overdue/harmed), so the
 * pure descriptor stays serialisable and free of any repo coupling.
 */
export interface DeferTasksPayload {
  /** Optional hint for the executor's scope. Reserved; executor defaults to
   *  "non-urgent tasks due today across work + admin". */
  scope?: 'today';
}

/**
 * Payload for `add_admin_task`: the renewal → create-task offer. The executor
 * inserts an admin task so it surfaces in /todo.
 */
export interface AddAdminTaskPayload {
  /** The task text to add (e.g. "renew passport"). */
  text: string;
  /** Optional ISO yyyy-mm-dd due date carried onto the new task. */
  dueDate?: string | null;
}

/**
 * Payload for `surface_decision`: the stale recurring-decision offer. The
 * executor un-snoozes the decision so it leads /todo today.
 */
export interface SurfaceDecisionPayload {
  /** The admin_recurring_decisions row id to bring back to today. */
  decisionId: string;
  /** The thing being decided (e.g. "gym membership") — for copy only. */
  what?: string;
}

/**
 * Payload for `surface_tasks` (paperwork piling): the set of stalled admin task
 * ids to bring to today. The executor sets each task's due date to today so it
 * leads /todo (the same date-bucketing mechanism `defer_tasks` already relies
 * on). Distinct from `surface_decision`, which acts on a recurring-decision row.
 */
export interface SurfaceTasksPayload {
  /** The admin_tasks row ids to surface (set due date → today). */
  taskIds: string[];
}

/**
 * Payload for `break_down_task` (chronic deferral): the text of the task she's
 * put off repeatedly. The executor creates ONE small "first step" admin task
 * dated today — deterministic, no AI call (mirrors goals' heuristic
 * smallest-next-step, which also asks the question without a network call).
 */
export interface BreakDownTaskPayload {
  /** The repeatedly-deferred task's text (e.g. "file the visa renewal"). */
  taskText: string;
  /** Optional id of the source task the breakdown came from (for traceability). */
  sourceTaskId?: string;
}

/**
 * Payload for `batch_block` (renewal cluster): batch 2+ renewals landing the
 * same month into one blocked day plus an app-closed reminder. The executor
 * creates a dated admin task AND schedules a local notification via the EVENT
 * path (`scheduleAt` → `emit('ollie-schedule-notif')`), never invoke().
 */
export interface BatchBlockPayload {
  /** Human label for the block + reminder (e.g. "renewals: passport, license"). */
  label: string;
  /** Absolute wall-clock ms the reminder should fire at. */
  fireAtMs: number;
  /** Optional renewal ids the block covers (for traceability / dedupe). */
  renewalIds?: string[];
}

/**
 * Payload for `archive_task` (dateless ladder final tier): the task that
 * survived the full escalating reminder ladder still open. The executor REMOVES
 * it from its module repo (admin or work) so it stops haunting /todo. The
 * module + id are carried so the generic dispatcher knows which repo to call.
 */
export interface ArchiveTaskPayload {
  /** Which task repo the row lives in. */
  module: 'admin' | 'work';
  /** The task row id to archive/remove. */
  taskId: string;
}

/** Discriminated payload union, keyed by {@link ActionKind}. */
export type ActionPayload =
  | ({ kind: 'add_to_grocery_list' } & AddToGroceryListPayload)
  | ({ kind: 'defer_tasks' } & DeferTasksPayload)
  | ({ kind: 'add_admin_task' } & AddAdminTaskPayload)
  | ({ kind: 'surface_decision' } & SurfaceDecisionPayload)
  | ({ kind: 'surface_tasks' } & SurfaceTasksPayload)
  | ({ kind: 'break_down_task' } & BreakDownTaskPayload)
  | ({ kind: 'batch_block' } & BatchBlockPayload)
  | ({ kind: 'archive_task' } & ArchiveTaskPayload);

/**
 * A suggested action attached to a noticing. PURE + serialisable: the native
 * dispatcher turns it into a real `execute()`. `label` is the localised accept
 * affordance text; `payload` carries everything the executor needs.
 */
export interface NoticingAction {
  kind: ActionKind;
  /** The localised accept-button text (e.g. "add to list" / "listeye ekle"). */
  label: string;
  payload: ActionPayload;
}

// ─── trilingual accept labels ────────────────────────────────────────────────

const ACCEPT_LABEL: Record<ActionKind, Record<AppLang, string>> = {
  add_to_grocery_list: {
    en: 'add to list',
    es: 'añadir a la lista',
    tr: 'listeye ekle',
  },
  defer_tasks: {
    en: 'push to tomorrow',
    es: 'pasar a mañana',
    tr: 'yarına ertele',
  },
  add_admin_task: {
    en: 'add to to-do',
    es: 'añadir a la lista',
    tr: 'yapılacaklara ekle',
  },
  surface_decision: {
    en: 'bring to today',
    es: 'traer a hoy',
    tr: 'bugüne getir',
  },
  surface_tasks: {
    en: 'bring to today',
    es: 'traer a hoy',
    tr: 'bugüne getir',
  },
  break_down_task: {
    en: 'break it down',
    es: 'divídelo',
    tr: 'küçült',
  },
  batch_block: {
    en: 'block a day',
    es: 'aparta un día',
    tr: 'bir gün ayır',
  },
  archive_task: {
    en: 'archive it',
    es: 'archívalo',
    tr: 'arşivle',
  },
};

/** The localised accept-button label for an action kind. Always non-empty. */
export function actionLabel(kind: ActionKind, lang: AppLang): string {
  const byLang = ACCEPT_LABEL[kind];
  return (byLang && (byLang[lang] ?? byLang[DEFAULT_LANG])) || 'do it';
}

/**
 * Build the grocery-list action descriptor for the replenish (milk) noticing.
 * Returns null when there are no names to add (no action to offer).
 */
export function buildAddToGroceryListAction(names: string[], lang: AppLang): NoticingAction | null {
  const clean = (Array.isArray(names) ? names : [])
    .map((n) => (n ?? '').toString().trim())
    .filter(Boolean);
  if (clean.length === 0) return null;
  return {
    kind: 'add_to_grocery_list',
    label: actionLabel('add_to_grocery_list', lang),
    payload: { kind: 'add_to_grocery_list', names: clean },
  };
}

/**
 * Build the defer-tasks action descriptor for the sleep-debt noticing. Carries
 * no per-task data — the native executor decides which non-urgent, due-today
 * tasks to push to tomorrow (reusing the deferral/harm discipline). Always
 * returns a descriptor (there is nothing to validate up front).
 */
export function buildDeferTasksAction(lang: AppLang): NoticingAction {
  return {
    kind: 'defer_tasks',
    label: actionLabel('defer_tasks', lang),
    payload: { kind: 'defer_tasks', scope: 'today' },
  };
}

/**
 * Build the add-admin-task action descriptor for the renewal-approaching
 * noticing. Returns null when `text` is blank (no task to create).
 */
export function buildAddAdminTaskAction(
  text: string,
  dueDate: string | null,
  lang: AppLang,
): NoticingAction | null {
  const clean = (text ?? '').toString().trim();
  if (!clean) return null;
  return {
    kind: 'add_admin_task',
    label: actionLabel('add_admin_task', lang),
    payload: { kind: 'add_admin_task', text: clean, dueDate: dueDate ?? null },
  };
}

/**
 * Build the surface-decision action descriptor for the stale-decision
 * noticing. Returns null when `decisionId` is blank (nothing to surface).
 */
export function buildSurfaceDecisionAction(
  decisionId: string,
  what: string,
  lang: AppLang,
): NoticingAction | null {
  const id = (decisionId ?? '').toString().trim();
  if (!id) return null;
  return {
    kind: 'surface_decision',
    label: actionLabel('surface_decision', lang),
    payload: { kind: 'surface_decision', decisionId: id, what: (what ?? '').toString().trim() },
  };
}

/**
 * Build the surface-tasks action descriptor for the paperwork-piling noticing.
 * Returns null when there are no task ids (nothing to surface). Cleans + dedupes
 * the id list so re-accepting is harmless.
 */
export function buildSurfaceTasksAction(taskIds: string[], lang: AppLang): NoticingAction | null {
  const clean = Array.from(
    new Set(
      (Array.isArray(taskIds) ? taskIds : [])
        .map((id) => (id ?? '').toString().trim())
        .filter(Boolean),
    ),
  );
  if (clean.length === 0) return null;
  return {
    kind: 'surface_tasks',
    label: actionLabel('surface_tasks', lang),
    payload: { kind: 'surface_tasks', taskIds: clean },
  };
}

/**
 * Build the break-down-task action descriptor for the chronic-deferral
 * noticing. Returns null when `taskText` is blank (nothing to break down).
 */
export function buildBreakDownTaskAction(
  taskText: string,
  sourceTaskId: string,
  lang: AppLang,
): NoticingAction | null {
  const text = (taskText ?? '').toString().trim();
  if (!text) return null;
  const src = (sourceTaskId ?? '').toString().trim();
  return {
    kind: 'break_down_task',
    label: actionLabel('break_down_task', lang),
    payload: {
      kind: 'break_down_task',
      taskText: text,
      ...(src ? { sourceTaskId: src } : {}),
    },
  };
}

/**
 * Build the batch-block action descriptor for the renewal-cluster noticing.
 * Returns null when `fireAtMs` isn't a finite number or `label` is blank (the
 * reminder would have nothing to fire / show).
 */
export function buildBatchBlockAction(
  label: string,
  fireAtMs: number,
  renewalIds: string[],
  lang: AppLang,
): NoticingAction | null {
  const clean = (label ?? '').toString().trim();
  if (!clean) return null;
  if (typeof fireAtMs !== 'number' || !Number.isFinite(fireAtMs)) return null;
  const ids = Array.from(
    new Set(
      (Array.isArray(renewalIds) ? renewalIds : [])
        .map((id) => (id ?? '').toString().trim())
        .filter(Boolean),
    ),
  );
  return {
    kind: 'batch_block',
    label: actionLabel('batch_block', lang),
    payload: {
      kind: 'batch_block',
      label: clean,
      fireAtMs,
      ...(ids.length > 0 ? { renewalIds: ids } : {}),
    },
  };
}

/**
 * Build the archive-task action descriptor for the dateless-ladder final tier.
 * Returns null when `module`/`taskId` are missing (nothing concrete to remove).
 */
export function buildArchiveTaskAction(
  module: 'admin' | 'work',
  taskId: string,
  lang: AppLang,
): NoticingAction | null {
  const id = (taskId ?? '').toString().trim();
  if (!id || (module !== 'admin' && module !== 'work')) return null;
  return {
    kind: 'archive_task',
    label: actionLabel('archive_task', lang),
    payload: { kind: 'archive_task', module, taskId: id },
  };
}
