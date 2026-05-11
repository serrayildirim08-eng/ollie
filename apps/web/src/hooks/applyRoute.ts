/**
 * applyRoute — pure store-write function, dependency-injected.
 *
 * No top-level side-effects. Takes a store explicitly so it is
 * testable without the browser adapter.
 */

import type { Action } from '@ollie/logic/dissection';
import type { Store } from '@ollie/store';

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function applyRoute(route: Action, store: Store): void {
  const ts = Date.now();
  const { module, action, data } = route;

  if (module === 'grocery' && action === 'add') {
    store.update<Array<{ id: string; name: string; ts: number; checked: boolean }>>(
      'grocery',
      'items',
      (cur) => [...(cur ?? []), { id: newId(), name: data, ts, checked: false }],
    );
    return;
  }

  if (module === 'cycle') {
    store.update<Array<{ ts: number; action: string; text: string }>>(
      'cycle',
      'items',
      (cur) => [...(cur ?? []), { ts, action, text: data }],
    );
    return;
  }

  if (module === 'astrology') {
    // Astrology has no log — route to dump instead.
    store.update<Array<{ id: string; text: string; ts: number }>>(
      'dump',
      'items',
      (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
    );
    return;
  }

  // All remaining modules: dump, sleep, work, habits, goals, admin, pets, body, finance, health, reminders
  store.update<Array<{ id: string; text: string; ts: number }>>(
    module,
    'items',
    (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
  );
}
