/**
 * @ollie/events · runtime
 *
 * Typed event bus with a registry-declared payload contract.
 *
 *   - `emit(name, payload)` warns on unregistered names, validates the
 *     payload against SHAPES, dispatches to subscribers.
 *   - `on(name, handler)` returns an unsubscribe function.
 *   - `once(name, handler)` fires the handler once then unsubscribes.
 *
 * Unlike the legacy window.VOID.events bus, this implementation does NOT
 * use window.dispatchEvent — subscribers are kept in an in-memory Map so
 * the package runs in Node (tests, server-side preprocessing) without a DOM.
 */

import { REGISTRY } from './registry';
import { validatePayload } from './shapes';

export { REGISTRY } from './registry';
export type { Registry, RegistryEntry } from './registry';
export { SHAPES, validatePayload } from './shapes';
export type { ValidationResult } from './shapes';

export type EventHandler<P = unknown> = (payload: P) => void;
export type Unsubscribe = () => void;

const handlers = new Map<string, Set<EventHandler<unknown>>>();

export function emit(name: string, payload: unknown): void {
  if (!REGISTRY[name]) {
    console.warn(
      `[@ollie/events] unregistered event "${name}". add it to REGISTRY with a payload shape.`,
    );
  }
  const result = validatePayload(name, payload);
  if (!result.ok) {
    console.warn(
      `[@ollie/events] payload shape mismatch for "${name}": ${result.reason}. dropping emit.`,
    );
    return;
  }
  const set = handlers.get(name);
  if (!set) return;
  for (const handler of set) {
    try {
      handler(payload);
    } catch (err) {
      console.error('[@ollie/events]', name, 'handler threw:', err);
    }
  }
}

export function on<P = unknown>(name: string, handler: EventHandler<P>): Unsubscribe {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  const cast = handler as EventHandler<unknown>;
  set.add(cast);
  return () => {
    const s = handlers.get(name);
    if (!s) return;
    s.delete(cast);
    if (s.size === 0) handlers.delete(name);
  };
}

export function once<P = unknown>(name: string, handler: EventHandler<P>): Unsubscribe {
  const unsub = on<P>(name, (payload) => {
    unsub();
    handler(payload);
  });
  return unsub;
}

/** Test-only: drop every subscriber. Not exported for production code paths. */
export function _clearAllHandlers(): void {
  handlers.clear();
}
