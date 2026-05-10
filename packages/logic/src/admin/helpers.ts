/**
 * @ollie/logic · admin helpers
 *
 * Shared internal utilities. Not part of public API.
 */

import type { AdminHistory, AdminOpts } from './types';

/**
 * Resolve `now` from opts > history.now > caller must supply.
 * In TypeScript land we don't fall back to Date.now() — callers must always
 * pass `now` explicitly. If neither source has it we throw so tests catch
 * it early.
 */
export function resolveNow(history: AdminHistory | null | undefined, opts: AdminOpts): number {
  if (typeof opts.now === 'number') return opts.now;
  if (history && typeof history.now === 'number') return history.now;
  // Fallback: callers that pass neither will fail loudly in tests.
  throw new Error('admin: `now` must be passed via opts.now or history.now');
}

/** Default-on consent gate — mirrors the void-app IIFE's _consentOnAdmin. */
export function consentOnAdmin(opts: AdminOpts): boolean {
  if (typeof opts.consent === 'boolean') return opts.consent;
  return true; // default-on when consent layer absent
}
