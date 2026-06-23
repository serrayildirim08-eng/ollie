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
  DeferabilityResolver,
} from './select';

// Sprint 4 — "learn YOU": the pure per-person procrastination-map learner. The
// native side reads the deferral + harm tables, groups by bucket, computes a
// LearnedMap, and feeds resolveDeferability into selectNoticings. Pins (user
// corrections) win over learned, which wins over the cold-start defaults.
export {
  learnBucket,
  resolveDeferability,
  verdictToDeferability,
  MIN_SAMPLE,
  HARM_RATE_PROTECT,
} from './learn';
export type {
  LearnedDeferability,
  BucketObservations,
  LearnedVerdict,
  Pin,
  LearnedMap,
  ResolvedDeferability,
} from './learn';

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
  buildDeferTasksAction,
  buildAddAdminTaskAction,
  buildSurfaceDecisionAction,
  buildSurfaceTasksAction,
  buildBreakDownTaskAction,
  buildBatchBlockAction,
  buildArchiveTaskAction,
} from './actions';
export type {
  ActionKind,
  ActionPayload,
  AddToGroceryListPayload,
  DeferTasksPayload,
  AddAdminTaskPayload,
  SurfaceDecisionPayload,
  SurfaceTasksPayload,
  BreakDownTaskPayload,
  BatchBlockPayload,
  ArchiveTaskPayload,
  NoticingAction,
} from './actions';
