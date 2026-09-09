/**
 * Worker mirror of apps/native/src/router/schema.ts · RouterOutput v1.0
 *
 * Kept in sync by hand for now. Dedup via packages/router-schema/ later
 * if the schema stabilizes and both surfaces want to drift-check.
 */

import type { CrisisSignal } from '@ollie/crisis-lexicon';

/**
 * SINGLE SOURCE OF TRUTH for the set of routable module names (S2 · fix 2).
 *
 * The `Module` type is DERIVED from this array (`typeof MODULES[number]`), and
 * `dump-classify.ts` imports MODULES for BOTH the Layer-1 router prompt's
 * module enum AND its runtime `VALID_MODULES` coercion guard. Adding or
 * removing a module is therefore a ONE-LINE change here — the type, the prompt,
 * and the coercion guard all follow automatically, and they can no longer
 * drift. (Pre-consolidation the list lived hand-synced in two places — the
 * `Module` union here and a `const MODULES: Module[]` in dump-classify.ts — and
 * had already started to drift; S2 audit.)
 *
 * One registry still lives OUTSIDE this file and must be kept in sync by hand:
 *   - The `routing_cache.module` CHECK constraint in supabase/migrations/.
 *     There is no compile-time link to a SQL string, so a drift test
 *     (tests/module-registry.test.ts) asserts the CHECK lists every value in
 *     MODULES. Adding a module here without updating the migration fails CI.
 *
 * The native router mirror (apps/native/src/router/schema.ts) is across the
 * worker/native package boundary and is intentionally NOT consolidated here.
 *
 * Order is load-bearing only for the prompt's readability, not for correctness.
 */
export const MODULES = [
  'crisis',
  'work',
  'admin',
  'pets',
  'cycle',
  'finance',
  'sleep',
  'body',
  'mood',
  'habits',
  'goals',
  'grocery',
  'medication',
  'chores',
  'dump_only',
] as const;

export type Module = (typeof MODULES)[number];

export type FragmentLanguage = 'tr' | 'en' | 'es' | 'mixed' | 'unknown';

export interface RouterOutput {
  schemaVersion: '1.0';
  originalDump: string;
  dumpId: string;
  timestamp: number;
  language: FragmentLanguage;
  crisis?: CrisisSignal;
  fragments: Fragment[];
  summary: RoutingSummary;
  /** True when the dump was augmented by Gemini Flash 2.5 vision extraction.
   *  Client surfaces a subtle "from photo" badge on the resulting cards. */
  visionUsed?: boolean;
}

export interface Fragment {
  text: string;
  language: FragmentLanguage;
  module: Module;
  payload: Record<string, unknown>;
  confidence: number;
  /** Server-side tier enforcement output flag. */
  needsConfirm: boolean;
  source: 'cache' | 'ai' | 'fast_path';
}

export interface RoutingSummary {
  moduleCount: Partial<Record<Module, number>>;
  cacheHitRate: number;
  aiCalls: number;
  durationMs: number;
  pass2Triggered: number;
}

/**
 * Confidence tier policy — Decision #5 (server-side enforcement).
 *  ≥0.80  → silent route,     needsConfirm = false
 *  0.60-  → silent route,     needsConfirm = true   (small edit affordance on the card)
 *  <0.60  → demote to dump_only, originalGuess stashed in payload
 */
export function applyConfidencePolicy(
  module: Module,
  payload: Record<string, unknown>,
  confidence: number,
): { module: Module; payload: Record<string, unknown>; needsConfirm: boolean } {
  if (confidence >= 0.8) {
    return { module, payload, needsConfirm: false };
  }
  if (confidence >= 0.6) {
    return { module, payload, needsConfirm: true };
  }
  // < 0.60 — demote.
  const demotedPayload: Record<string, unknown> = {
    module: 'dump_only',
    action: 'archive_only',
    reason: 'low_confidence',
    originalGuess: { module, payload },
  };
  // Preserve a time-deferred reminder across demotion (audit #5b). Without this,
  // injectScheduledAt looks for `payload.remindIn` at the top level — which the
  // demotion buried inside originalGuess — and the reminder was silently lost,
  // contradicting the classifier rule "never dump_only when remindIn present".
  if (payload && typeof payload === 'object' && 'remindIn' in payload) {
    demotedPayload.remindIn = (payload as Record<string, unknown>).remindIn;
  }
  return { module: 'dump_only', payload: demotedPayload, needsConfirm: false };
}
