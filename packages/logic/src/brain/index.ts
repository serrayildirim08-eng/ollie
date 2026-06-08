/**
 * @ollie/logic · brain public API
 *
 * The silent-observer brain's pure computations: deferral tracking, harm-of-
 * deferral detection, and the daily capacity read. All pure — no I/O, no DOM,
 * no wall-clock reads (callers pass `now`). Native modules own the capture +
 * persistence; this package owns only the math.
 */

export { computeDeferral } from './deferral';
export type { DeferralTask, DeferralSignal } from './deferral';

export { detectHarm } from './harm';
export type {
  HarmKind,
  HarmEvent,
  HarmInputs,
  HarmPantryItem,
  HarmBill,
  HarmDeadlineItem,
} from './harm';

export { computeCapacity } from './capacity';
export type { CapacityLevel, CapacityInputs, CapacityRead } from './capacity';

export {
  selectNoticings,
  scoreNoticing,
  deferabilityOf,
  thresholdFor,
  MAX_NOTICINGS,
  TARGET_NOTICINGS,
} from './select';
export type {
  NoticingCandidate,
  ScoredNoticing,
  SelectOptions,
  Deferability,
} from './select';

// Sprint 3 — "speak in your words": AI-generated calm copy + trilingual
// fallbacks + the offers-really-act action framework. All pure here; the
// native side owns the AI fetch, the per-(noticing, day) cache, and execute().
export {
  buildCopyPrompt,
  fallbackCopy,
  copyKindOf,
  resolveLang,
  APP_LANGS,
  DEFAULT_LANG,
} from './copy';
export type { AppLang, CopyKind, CopyFacts, CopyActionKind } from './copy';

export {
  actionLabel,
  buildAddToGroceryListAction,
} from './actions';
export type {
  ActionKind,
  ActionPayload,
  AddToGroceryListPayload,
  NoticingAction,
} from './actions';
