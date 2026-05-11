/**
 * applyRoute — pure store-write function, dependency-injected.
 *
 * No top-level side-effects. Takes a store explicitly so it is
 * testable without the browser adapter.
 */

import type { Action } from '@ollie/logic/dissection';
import type { Store } from '@ollie/store';
import { parseFinanceDump } from '@ollie/logic/finance';

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Sub-slice keywords not covered by parseFinanceDump (subscription / bill / savings).
// parseFinanceDump already handles is_adhd_tax and direction=in/out.
const SUBSCRIPTION_RE = /\b(subscription|subscri(?:be|bed)|monthly\s+plan|annual\s+plan|canva|spotify|netflix|apple\s+one|notion|figma|slack)\b/i;
const BILL_RE = /\b(rent|electric(?:ity)?|gas\s+bill|internet\s+bill|phone\s+bill|every\s+(?:month|week|year|quarter)|monthly|weekly|yearly|quarterly|recurring)\b/i;
const SAVINGS_RE = /\b(save|saving|savings|put\s+aside|set\s+aside|goal|toward|for\s+(?:a\s+)?\w+\s+(?:fund|goal))\b/i;

/** Classify a finance text into a store sub-slice key. */
function classifyFinanceSlice(
  text: string,
  now: number,
): 'records' | 'bills' | 'subscriptions' | 'goals' | 'adhd_tax' | 'transactions' {
  const parsed = parseFinanceDump(text, now);
  const rec = parsed.record;

  if (rec?.is_adhd_tax) return 'adhd_tax';

  const lower = text.toLowerCase();

  if (SAVINGS_RE.test(lower)) return 'goals';

  // Check subscription before bill — "canva monthly $20" is a subscription
  if (SUBSCRIPTION_RE.test(lower)) return 'subscriptions';

  if (BILL_RE.test(lower)) return 'bills';

  // One-off income or expense
  if (rec && (rec.direction === 'in' || rec.direction === 'out')) return 'records';

  return 'transactions';
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

  if (module === 'grocery' && action === 'log') {
    // 'bought' intent from dissection — route to pantry
    store.update<Array<{ id: string; name: string; ts: number; boughtTs: number }>>(
      'grocery',
      'pantry',
      (cur) => [...(cur ?? []), { id: newId(), name: data, ts, boughtTs: ts }],
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

  if (module === 'finance') {
    const slice = classifyFinanceSlice(data, ts);
    store.update<Array<{ id: string; text: string; ts: number }>>(
      'finance',
      slice,
      (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
    );
    return;
  }

  if (module === 'body') {
    const lower = data.toLowerCase();
    if (/glass|water|içtim|drank|drunk|hydrat/i.test(lower)) {
      store.update<Array<{ ts: number }>>(
        'body',
        'water_log',
        (cur) => [...(cur ?? []), { ts }],
      );
      return;
    }
    if (/vitamin|supplement|d3|magnesium|omega|zinc|iron|b12|probiotic|tablet|capsule/i.test(lower)) {
      store.update<Array<{ id: string; text: string; ts: number }>>(
        'body',
        'supplements',
        (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
      );
      return;
    }
    if (/migraine|migren|episode|severe|crash|flare/i.test(lower)) {
      store.update<Array<{ id: string; text: string; ts: number }>>(
        'body',
        'episodes',
        (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
      );
      return;
    }
    // Fallthrough to body.items
    store.update<Array<{ id: string; text: string; ts: number }>>(
      'body',
      'items',
      (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
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

  // All remaining modules: dump, sleep, work, habits, goals, admin, pets, health, reminders
  store.update<Array<{ id: string; text: string; ts: number }>>(
    module,
    'items',
    (cur) => [...(cur ?? []), { id: newId(), text: data, ts }],
  );
}
