/**
 * apps/native · modules/types.ts
 *
 * Local types for the module-dispatch layer that sits between the router
 * (RouterOutput) and the per-module side-effects (persistence, cues,
 * downstream multi-routing).
 *
 * The handler contract itself lives in router/schema.ts (ModuleHandler<M>);
 * this file only adds local helpers for dispatch results.
 */

import type { Fragment, HandlerResult, Module } from '../router/schema';

/**
 * One row of a dispatch run — the original fragment paired with what the
 * module's handler produced. Stable order; the UI renders these into the
 * journal feed as "noticed" entries.
 */
export interface DispatchEntry {
  fragment: Fragment;
  result: HandlerResult;
}

/**
 * Whole-dump dispatch output. `crisisSkipped: true` means we deliberately
 * did NOT run any module handlers because the router flagged a crisis
 * (per the schema's "crisis short-circuits routing" guarantee).
 */
export interface DispatchOutput {
  entries: DispatchEntry[];
  crisisSkipped: boolean;
}

/**
 * Failure-soft handler invocation result. Every stub wraps user-facing
 * notes in this; the dispatcher catches throws and converts to ok:false
 * so one bad handler can never crash the dump.
 */
export type HandlerOutcome =
  | { ok: true; note: string; deepLink?: string; needsConfirm?: boolean }
  | { ok: false; note: string };

export type ModuleName = Module;
