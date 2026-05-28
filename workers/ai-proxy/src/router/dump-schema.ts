/**
 * Worker mirror of apps/native/src/router/schema.ts · RouterOutput v1.0
 *
 * Kept in sync by hand for now. Dedup via packages/router-schema/ later
 * if the schema stabilizes and both surfaces want to drift-check.
 */

import type { CrisisSignal } from '@ollie/crisis-lexicon';

export type Module =
  | 'crisis'
  | 'work'
  | 'admin'
  | 'pets'
  | 'cycle'
  | 'finance'
  | 'sleep'
  | 'body'
  | 'habits'
  | 'goals'
  | 'grocery'
  | 'medication'
  | 'dump_only';

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
  return {
    module: 'dump_only',
    payload: {
      module: 'dump_only',
      action: 'archive_only',
      reason: 'low_confidence',
      originalGuess: { module, payload },
    },
    needsConfirm: false,
  };
}
