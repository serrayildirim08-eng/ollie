/**
 * @ollie/consent — single source of truth for user consent state.
 *
 * Pivot 2026-05-14: zero-knowledge dogma abandoned; consent state is the
 * load-bearing piece that gates every research-data path. Every write/upload
 * path imports `hasResearchConsent` from here.
 *
 * Two toggles per Serra's spec (`feedback_ollie_opt_in_default.md`):
 *   - `necessary` — must be true; app does not run without it. Bundles
 *      crash analytics + Sentry replay (UX bug repro).
 *   - `marketing` — default false. Emails + product analytics.
 *
 * Plus the research opt-in (`feedback_ollie_opt_in_default.md` + B2B pivot):
 *   - `research_optin` — default null for legacy users (re-prompt), default
 *     false for new sign-ups; opt-in routes scrubbed text → ai-proxy /label
 *     → research_corpus.
 *
 * Reads:
 *   - in-memory cache (sync)
 *   - falls back to local store (sync, persisted via @ollie/store key)
 *   - Supabase user_consent table is the durable source of truth (async)
 *
 * Writes:
 *   - update in-memory cache, write through to local store immediately
 *   - debounced sync to Supabase user_consent via ai-proxy /ingest-event
 *     (table: consent_audit) — non-blocking, fire-and-forget
 *
 * NEVER block UI on the network sync.
 */

export const CONSENT_STORE_MODULE = 'consent';
export const CONSENT_STORE_KEY = 'state';

/** Pivot date — users created before this need a re-prompt. */
export const CONSENT_PIVOT_TS = Date.UTC(2026, 4, 14); // 2026-05-14 UTC midnight

/** Current consent payload shape (versioned). */
export type ConsentState = {
  /** Must be true — required for the app to boot. Bundles Sentry replay. */
  necessary: true;
  /** Marketing emails + product analytics. Default false. */
  marketing: boolean;
  /**
   * Research / data-collection opt-in.
   * - `null`  → never prompted (legacy pre-pivot user); UI must prompt again
   * - `true`  → opt-in: scrubbable rows are sent to ai-proxy /label
   * - `false` → opt-out: rows stay user-row-scoped, never leave device unless
   *             encrypted (future ZK path)
   */
  research_optin: boolean | null;
  /** ms epoch — when state was last set. */
  set_at: number;
  /** Shape version. Bump on breaking change. */
  v: 1;
};

/** Minimal store contract — matches @ollie/store's Store interface for the
 *  two methods we use. Decoupled so this package has no dep on @ollie/store
 *  and can be tested with an in-memory mock. */
export interface ConsentStoreAdapter {
  get<T = unknown>(mod: string, key: string, defaultValue?: T): T;
  set<T = unknown>(mod: string, key: string, value: T): void;
}

/** Sink that durably persists consent to Supabase. Implementation lives
 *  in the app layer (POSTs to ai-proxy /ingest-event with table=consent_audit).
 *  Pass a noop in tests / offline modes. */
export type ConsentSync = (state: ConsentState, userId: string) => Promise<void>;

const cache = new Map<string, ConsentState>();
let storeRef: ConsentStoreAdapter | null = null;
let syncRef: ConsentSync = async () => {};

/**
 * Wire the consent package to a store + remote sync.
 * Call once on app boot (before any orchestrator init).
 */
export function configureConsent(opts: {
  store: ConsentStoreAdapter;
  sync?: ConsentSync;
}): void {
  storeRef = opts.store;
  if (opts.sync) syncRef = opts.sync;
}

/** Test-only: reset module state. */
export function _resetConsent(): void {
  cache.clear();
  storeRef = null;
  syncRef = async () => {};
}

/** Default consent for a brand-new user (signed up post-pivot). */
export function defaultConsent(now: number = Date.now()): ConsentState {
  return {
    necessary: true,
    marketing: false,
    research_optin: false,
    set_at: now,
    v: 1,
  };
}

/**
 * Read consent for a user. Reads the in-memory cache first, then the local
 * store, then returns a "needs re-prompt" sentinel state (`research_optin: null`)
 * if nothing is persisted.
 *
 * IMPORTANT: pre-pivot users (set_at < CONSENT_PIVOT_TS) get `research_optin`
 * forced to `null` on the next read so the UI re-prompts before any data
 * leaves the device.
 */
export async function getConsent(userId: string): Promise<ConsentState> {
  if (cache.has(userId)) return cache.get(userId)!;

  if (!storeRef) {
    // Unconfigured — return the legacy-prompt sentinel rather than throwing.
    // Callers (orchestrator + UI) should treat null research_optin as "ask".
    return {
      necessary: true,
      marketing: false,
      research_optin: null,
      set_at: 0,
      v: 1,
    };
  }

  const persisted = storeRef.get<ConsentState | null>(
    CONSENT_STORE_MODULE,
    CONSENT_STORE_KEY,
    null,
  );

  if (!persisted) {
    // No prior state — caller must prompt.
    const sentinel: ConsentState = {
      necessary: true,
      marketing: false,
      research_optin: null,
      set_at: 0,
      v: 1,
    };
    cache.set(userId, sentinel);
    return sentinel;
  }

  // Pre-pivot migration: if state was set before the pivot date and the user
  // never explicitly set research_optin, force it to null so UI re-prompts.
  let migrated: ConsentState = persisted;
  if (persisted.set_at > 0 && persisted.set_at < CONSENT_PIVOT_TS) {
    migrated = { ...persisted, research_optin: null };
  }

  cache.set(userId, migrated);
  return migrated;
}

/**
 * Patch consent. Writes through to in-memory cache + local store immediately,
 * then fire-and-forget syncs to Supabase via the configured sink.
 *
 * `necessary` cannot be set to false — app cannot run without it. We silently
 * coerce to true.
 */
export async function setConsent(
  userId: string,
  patch: Partial<Omit<ConsentState, 'v' | 'necessary'>> & { necessary?: boolean },
): Promise<void> {
  const current = await getConsent(userId);
  const next: ConsentState = {
    necessary: true, // never accept false
    marketing: patch.marketing ?? current.marketing,
    research_optin:
      patch.research_optin === undefined ? current.research_optin : patch.research_optin,
    set_at: patch.set_at ?? Date.now(),
    v: 1,
  };

  cache.set(userId, next);

  if (storeRef) {
    storeRef.set<ConsentState>(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, next);
  }

  // Non-blocking sync — never await failures.
  void syncRef(next, userId).catch(() => {
    /* silent fail; consent_audit is best-effort durable, local store is source of truth */
  });
}

/**
 * Has the user opted in to research data collection?
 *
 * Returns false for:
 *   - never-prompted users (`research_optin: null`)
 *   - explicit opt-outs
 *
 * Returns true ONLY for explicit opt-ins. This is the gate every research
 * data path checks. Default-deny by design.
 */
export async function hasResearchConsent(userId: string): Promise<boolean> {
  const state = await getConsent(userId);
  return state.research_optin === true;
}

/** Does the user need to be (re-)prompted for research consent? */
export async function needsResearchPrompt(userId: string): Promise<boolean> {
  const state = await getConsent(userId);
  return state.research_optin === null;
}
