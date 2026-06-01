/**
 * apps/native · patterns/usePatterns.ts
 *
 * The "bulletin board" reader. Every Layer-2 watcher computes its findings
 * and writes them to `store.get('<module>', 'patterns', [])` (and the
 * cross-module rules write `shared.patterns` / `shared.signals`). Nothing in
 * the native app rendered any of it — this hook is the read side.
 *
 * `usePatterns('body')` reactively returns the merged, normalised list of
 * pattern cards for that module: the module's own `<module>.patterns` plus
 * the slice of `shared.patterns` whose `module` field matches. Re-renders
 * when either store key changes (subscribeKey, mirroring useStoreSlice).
 *
 * Drop `<PatternCards module="body" />` (see PatternCards.tsx) into a Box to
 * surface these — that component is the only consumer module agents touch.
 *
 * NOTE ON KEYS: the dump module's detector writes to the `journal` namespace
 * (`store.set('journal','patterns', …)`), NOT `dump`. usePatterns maps the
 * module id `'dump'` → store namespace `'journal'` so callers stay uniform.
 */

import { useEffect, useState } from 'react';
import { store } from '../store';

/**
 * Tolerant pattern-card shape. Detector outputs across packages/logic vary
 * (finance/body/work/admin/etc each have their own interface) but they
 * overlap on these fields. We keep every field optional so a card from ANY
 * detector renders without a per-module adapter. The two load-bearing
 * fields are `pattern` (stable id, used for dedupe + dismissal) and `copy`
 * (the editorial sentence shown to the user). `title` is shown when present.
 */
export interface PatternCard {
  /** Stable detector id, e.g. 'hyperfocus_dehydration'. Used as dismissal key. */
  pattern?: string;
  /** Optional short heading. Most detectors omit this and lead with `copy`. */
  title?: string;
  /** The primary editorial sentence (English). The body of the card. */
  copy?: string;
  /** Some detectors use `body`/`message` instead of `copy`. */
  body?: string;
  message?: string;
  /** Spanish copy, when the detector supplied it. */
  copy_es?: string;
  /**
   * Provenance. Detectors emit either a `{ citation, url }` object or, in a
   * few cases, a bare string. Both tolerated.
   */
  source?: { citation?: string; url?: string } | string;
  /** Direct citation/url some detectors attach at the top level. */
  citation?: string;
  url?: string;
  /** Detector confidence, when supplied ('low' | 'medium' | 'high' | number). */
  confidence?: string | number;
  /** Detection timestamp (ms epoch), when supplied. Used for ordering. */
  ts?: number;
  /** Everything else a detector may attach — kept so nothing is dropped. */
  [extra: string]: unknown;
}

/** A `shared.patterns` entry — same card shape, plus the owning module id. */
interface SharedPatternEntry extends PatternCard {
  module?: string;
}

/** Map a module id to the store namespace its detector writes patterns under. */
function patternsNamespace(module: string): string {
  return module === 'dump' ? 'journal' : module;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Read the merged pattern list for a module from the store (non-reactive). */
function readPatterns(module: string): PatternCard[] {
  const ns = patternsNamespace(module);
  const own = asArray<PatternCard>(store.get(ns, 'patterns', []));
  const shared = asArray<SharedPatternEntry>(store.get('shared', 'patterns', []))
    .filter((p) => p && p.module === module);
  return [...own, ...shared];
}

/**
 * Reactively read `<module>.patterns` + the module's slice of
 * `shared.patterns`. Re-renders when either key changes. Subscriptions
 * mirror @ollie/store's useStoreSlice (subscribeKey + cleanup).
 */
export function usePatterns(module: string): PatternCard[] {
  const ns = patternsNamespace(module);
  const [cards, setCards] = useState<PatternCard[]>(() => readPatterns(module));

  useEffect(() => {
    const refresh = (): void => setCards(readPatterns(module));
    const unsubOwn = store.subscribeKey(ns, 'patterns', refresh);
    const unsubShared = store.subscribeKey('shared', 'patterns', refresh);
    // Re-read once on (re)subscribe in case the store changed between the
    // initial useState and the effect attaching (StrictMode double-invoke).
    refresh();
    return () => {
      unsubOwn();
      unsubShared();
    };
  }, [module, ns]);

  return cards;
}
