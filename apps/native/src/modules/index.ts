/**
 * apps/native · modules/index.ts — barrel
 *
 * Public surface for the module-dispatch layer. The router (router/schema.ts)
 * stays the source of truth for the Fragment + ModuleHandler contracts;
 * this barrel only exports the runtime pieces a screen needs to wire up.
 */

export { dispatchRouterOutput, applyFragment } from './dispatch';
export type { DispatchOptions } from './dispatch';
export { stubHandlers } from './stubs';
export type { DispatchEntry, DispatchOutput, HandlerOutcome, ModuleName } from './types';
