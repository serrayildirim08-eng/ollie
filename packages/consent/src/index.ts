/**
 * @ollie/consent — single source of truth for user consent state.
 *
 * Pivot 2026-05-14: server-blind dogma abandoned; consent state is the
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

// ─── legacy-key bridge (Görev 1 · 2026-05-15) ─────────────────────────────────
//
// Before this consolidation two parallel systems existed:
//   System A — raw `shared.consent.necessary` + `shared.consent.marketing`
//              keys, written by ConsentScreen, read by App.tsx's boot gate.
//   System B — the `consent.state` canonical row owned by this package.
//
// `consent.state` is now the single source of truth. The helpers below
// read it synchronously (App.tsx boot gate, research-stream, sync, the
// HealthKit defense-in-depth gate are all synchronous) and lazily SEED it
// from the legacy System-A keys the first time a returning user is read,
// so an existing `necessary: true` is never lost during the cutover.

/** Legacy System-A store coordinates (pre-consolidation). */
const LEGACY_NECESSARY_MODULE = 'shared';
const LEGACY_NECESSARY_KEY = 'consent.necessary';
const LEGACY_MARKETING_MODULE = 'shared';
const LEGACY_MARKETING_KEY = 'consent.marketing';

/**
 * Read the canonical consent row directly from a store, synchronously.
 *
 * Resolution order:
 *   1. canonical `consent.state` row, if present (with pre-pivot migration);
 *   2. else, if a legacy `shared.consent.necessary` exists, build a
 *      ConsentState from the legacy keys and SEED `consent.state` so future
 *      reads are canonical (one-way migration, conservative);
 *   3. else, the "needs re-prompt" sentinel (necessary true, research null).
 *
 * Conservative by design: `research_optin` is never inferred from legacy
 * data — System A never carried a research flag, so a migrated user always
 * lands on `null` (re-prompt) and the app asks before any data leaves.
 */
export function getConsentSync(store: ConsentStoreAdapter): ConsentState {
  const persisted = store.get<ConsentState | null>(
    CONSENT_STORE_MODULE,
    CONSENT_STORE_KEY,
    null,
  );

  if (persisted) {
    // Pre-pivot migration mirrors getConsent(): force re-prompt for users
    // whose state predates the pivot and never explicitly chose research.
    if (persisted.set_at > 0 && persisted.set_at < CONSENT_PIVOT_TS) {
      return { ...persisted, research_optin: null };
    }
    return persisted;
  }

  // No canonical row — check the legacy System-A keys.
  const legacyNecessary = store.get<boolean>(
    LEGACY_NECESSARY_MODULE,
    LEGACY_NECESSARY_KEY,
    false,
  );

  if (legacyNecessary) {
    // Returning System-A user. Seed a canonical row from the legacy keys.
    // research_optin stays null on purpose → ConsentStep re-prompts.
    const legacyMarketing = Boolean(
      store.get<boolean>(LEGACY_MARKETING_MODULE, LEGACY_MARKETING_KEY, false),
    );
    const seeded: ConsentState = {
      necessary: true,
      marketing: legacyMarketing,
      research_optin: null,
      // set_at: pre-pivot epoch so any later read still treats this as a
      // legacy user until research is explicitly chosen.
      set_at: CONSENT_PIVOT_TS - 1,
      v: 1,
    };
    store.set<ConsentState>(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, seeded);
    return seeded;
  }

  // Brand-new install — nothing persisted anywhere.
  return {
    necessary: true,
    marketing: false,
    research_optin: null,
    set_at: 0,
    v: 1,
  };
}

/**
 * Synchronous read of the `necessary` consent flag.
 *
 * This is the master app-boot gate. `necessary` is structurally `true` on
 * every persisted ConsentState (the type forbids `false`); a fresh install
 * with NOTHING persisted reads `false` so App.tsx still shows ConsentScreen.
 */
export function hasNecessaryConsent(store: ConsentStoreAdapter): boolean {
  const persisted = store.get<ConsentState | null>(
    CONSENT_STORE_MODULE,
    CONSENT_STORE_KEY,
    null,
  );
  if (persisted) return persisted.necessary === true;
  // No canonical row — fall back to the legacy key so a returning System-A
  // user is not bounced back to the consent screen mid-cutover.
  return Boolean(
    store.get<boolean>(LEGACY_NECESSARY_MODULE, LEGACY_NECESSARY_KEY, false),
  );
}

/** Synchronous read of the `marketing` consent flag. Default-deny: a brand
 *  new install with nothing persisted reads `false`. */
export function hasMarketingConsent(store: ConsentStoreAdapter): boolean {
  return getConsentSync(store).marketing === true;
}

/**
 * Persist the `necessary` flag to the canonical row, synchronously.
 *
 * `necessary` is one-way: once true it cannot be set false (the ConsentState
 * type forbids it). This is the writer ConsentScreen calls when the user
 * flips the master gate on. Also mirrors into the in-memory cache (if a user
 * is configured) so a subsequent async getConsent() agrees, and triggers the
 * durable Supabase sync for the audit trail.
 */
export function setNecessaryConsentSync(
  store: ConsentStoreAdapter,
  userId: string = '_local',
): void {
  const current = getConsentSync(store);
  const next: ConsentState = {
    necessary: true,
    marketing: current.marketing,
    research_optin: current.research_optin,
    set_at: Date.now(),
    v: 1,
  };
  store.set<ConsentState>(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, next);
  // SECURITY (S5): the store is the single source of truth. The in-memory
  // cache is only a perf shortcut and is keyed inconsistently across
  // setters (`_local` here vs a real userId in setConsent), so a stale
  // entry under a different key could keep a research opt-out from being
  // seen by getConsent/hasResearchConsent. Clear it so every reader
  // re-hydrates from the just-written store row.
  cache.clear();
  void syncRef(next, userId).catch(() => { /* best-effort audit */ });
}

/** Persist the `marketing` flag to the canonical row, synchronously. */
export function setMarketingConsentSync(
  store: ConsentStoreAdapter,
  value: boolean,
  userId: string = '_local',
): void {
  const current = getConsentSync(store);
  const next: ConsentState = {
    necessary: true,
    marketing: value,
    research_optin: current.research_optin,
    set_at: Date.now(),
    v: 1,
  };
  store.set<ConsentState>(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, next);
  // SECURITY (S5): see setNecessaryConsentSync — clear the cache so every
  // reader re-hydrates from the store (the single source of truth).
  cache.clear();
  void syncRef(next, userId).catch(() => { /* best-effort audit */ });
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

  if (storeRef) {
    storeRef.set<ConsentState>(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, next);
    // SECURITY (S5): store is the source of truth. Clear the whole cache
    // rather than writing `cache.set(userId, next)` — the *Sync setters
    // write under `_local`, so a per-userId cache.set here would leave a
    // stale `_local` entry (and vice-versa) and a research opt-OUT could
    // be masked by a cached opt-in. A subsequent getConsent re-hydrates.
    cache.clear();
  } else {
    // Unconfigured (tests / offline): no durable store to re-read from, so
    // the cache *is* the source of truth here — keep the write-through.
    cache.set(userId, next);
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
