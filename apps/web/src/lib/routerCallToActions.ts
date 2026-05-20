/**
 * routerCallToActions — adapts the hybrid router's `{tool, input}` calls
 * into the codebase's `Action` shape so the existing canonical dispatcher
 * (`@ollie/orchestrator` dispatchAction) can write them to the store
 * unchanged.
 *
 * The hybrid worker router speaks 13 tool names; the store dispatcher speaks
 * `{module, action, data}`. This is the one translation layer between them.
 *
 * `data` carries a human-readable phrase for the module surface — the slot
 * the dispatcher's per-module classifiers key on (e.g. finance sub-slice,
 * body sub-slice). When the router extracted a clean `item`/`title`/`text`
 * we use it; otherwise we fall back to the original `raw` phrase.
 */

import type { Action, ModuleName } from '@ollie/logic/dissection';
import type { RouterCall } from './aiRoute';

/** The action verb — derived from Action so no extra export is needed. */
type ActionKind = Action['action'];

/** tool name → store module key. */
const TOOL_MODULE: Record<string, ModuleName> = {
  add_to_grocery: 'grocery',
  log_pet_event: 'pets',
  log_finance_event: 'finance',
  log_habit: 'habits',
  log_sleep: 'sleep',
  log_cycle_event: 'cycle',
  add_work_task: 'work',
  add_goal: 'goals',
  add_admin_task: 'admin',
  query_astrology: 'astrology',
  log_body: 'body',
  log_medication: 'health',
  log_to_dump: 'dump',
};

/**
 * store module key → tool name — the inverse of TOOL_MODULE.
 *
 * Used by callers that have a module classification (e.g. the on-device
 * router's `{module, confidence}`) and need to synthesise a RouterCall so
 * they can reuse `routerCallToAction`. Derived from TOOL_MODULE so the two
 * never drift.
 */
export const MODULE_TOOL: Record<ModuleName, string> = Object.fromEntries(
  Object.entries(TOOL_MODULE).map(([tool, module]) => [module, tool]),
) as Record<ModuleName, string>;

/** Modules the dispatcher treats as a 'log' action rather than 'add'. */
const LOG_MODULES = new Set<ModuleName>([
  'sleep',
  'astrology',
  'dump',
  'cycle',
  'pets',
  'body',
  'habits',
  'health',
]);

/** Pick the best display string from a tool call's input. */
function pickData(input: Record<string, unknown>): string {
  for (const key of ['item', 'title', 'text', 'med_name', 'habit', 'raw']) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** True when the grocery action is a past-tense purchase (→ 'log'/pantry). */
function isGroceryLog(input: Record<string, unknown>): boolean {
  return input.action === 'log_purchase';
}

/**
 * Convert a single RouterCall into one Action.
 *
 * @returns the Action, or null when the call carries nothing usable.
 */
export function routerCallToAction(call: RouterCall): Action | null {
  const module = TOOL_MODULE[call.tool];
  if (!module) return null;

  const data = pickData(call.input);
  if (!data) return null;

  let kind: ActionKind;
  if (module === 'grocery') {
    kind = isGroceryLog(call.input) ? 'log' : 'add';
  } else {
    kind = LOG_MODULES.has(module) ? 'log' : 'add';
  }

  return { module, action: kind, data };
}

/**
 * Convert a list of RouterCalls into a flat list of Actions. Calls that
 * carry nothing usable are dropped. Multi-intent dumps (multiple calls)
 * naturally yield multiple actions — one chip per action downstream.
 */
export function routerCallsToActions(calls: RouterCall[]): Action[] {
  const actions: Action[] = [];
  for (const call of calls) {
    const a = routerCallToAction(call);
    if (a) actions.push(a);
  }
  return actions;
}
