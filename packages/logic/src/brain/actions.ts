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
export type ActionKind = 'add_to_grocery_list';

/** Payload for `add_to_grocery_list`: the item names to put on the list. */
export interface AddToGroceryListPayload {
  /** Canonical-ish item names to add (e.g. ['milk']). */
  names: string[];
}

/** Discriminated payload union, keyed by {@link ActionKind}. */
export type ActionPayload = { kind: 'add_to_grocery_list' } & AddToGroceryListPayload;

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
