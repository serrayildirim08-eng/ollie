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
  | 'surface_decision';

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

/** Discriminated payload union, keyed by {@link ActionKind}. */
export type ActionPayload =
  | ({ kind: 'add_to_grocery_list' } & AddToGroceryListPayload)
  | ({ kind: 'defer_tasks' } & DeferTasksPayload)
  | ({ kind: 'add_admin_task' } & AddAdminTaskPayload)
  | ({ kind: 'surface_decision' } & SurfaceDecisionPayload);

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
