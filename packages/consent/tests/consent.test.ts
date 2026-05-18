import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_PIVOT_TS,
  CONSENT_STORE_KEY,
  CONSENT_STORE_MODULE,
  type ConsentState,
  type ConsentStoreAdapter,
  configureConsent,
  defaultConsent,
  getConsent,
  getConsentSync,
  hasMarketingConsent,
  hasNecessaryConsent,
  hasResearchConsent,
  needsResearchPrompt,
  setConsent,
  setMarketingConsentSync,
  setNecessaryConsentSync,
  _resetConsent,
} from '../src/index';

function memoryStore(): ConsentStoreAdapter & { dump(): Record<string, unknown> } {
  const data = new Map<string, unknown>();
  const key = (m: string, k: string) => `${m}.${k}`;
  return {
    get<T>(m: string, k: string, defaultValue?: T): T {
      const v = data.get(key(m, k));
      return (v === undefined ? (defaultValue as T) : (v as T));
    },
    set<T>(m: string, k: string, value: T): void {
      data.set(key(m, k), value);
    },
    dump() {
      return Object.fromEntries(data.entries());
    },
  };
}

describe('@ollie/consent', () => {
  beforeEach(() => {
    _resetConsent();
  });

  afterEach(() => {
    _resetConsent();
  });

  it('returns null sentinel when unconfigured', async () => {
    const state = await getConsent('u1');
    expect(state.necessary).toBe(true);
    expect(state.research_optin).toBeNull();
  });

  it('defaultConsent ships with research opt-out + marketing opt-out + set_at now', () => {
    const c = defaultConsent(1234567890);
    expect(c).toEqual({
      necessary: true,
      marketing: false,
      research_optin: false,
      set_at: 1234567890,
      v: 1,
    });
  });

  it('returns sentinel when nothing persisted', async () => {
    const store = memoryStore();
    configureConsent({ store });
    const state = await getConsent('u1');
    expect(state.research_optin).toBeNull();
    expect(state.set_at).toBe(0);
  });

  it('persists set + reads back from store', async () => {
    const store = memoryStore();
    configureConsent({ store });

    await setConsent('u1', { research_optin: true, marketing: true });
    _resetConsent(); // drop in-memory cache; force re-hydrate from store
    configureConsent({ store });

    const state = await getConsent('u1');
    expect(state.research_optin).toBe(true);
    expect(state.marketing).toBe(true);
    expect(state.necessary).toBe(true);
  });

  it('forces research_optin to null for pre-pivot users (re-prompt)', async () => {
    const store = memoryStore();
    const prePivot: ConsentState = {
      necessary: true,
      marketing: true,
      research_optin: true, // pre-pivot users were implicitly opted in
      set_at: CONSENT_PIVOT_TS - 1000,
      v: 1,
    };
    store.set(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, prePivot);
    configureConsent({ store });

    const state = await getConsent('u1');
    expect(state.research_optin).toBeNull();
    expect(state.marketing).toBe(true); // other fields preserved
  });

  it('post-pivot persisted state is not migrated', async () => {
    const store = memoryStore();
    const postPivot: ConsentState = {
      necessary: true,
      marketing: false,
      research_optin: true,
      set_at: CONSENT_PIVOT_TS + 1000,
      v: 1,
    };
    store.set(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, postPivot);
    configureConsent({ store });

    const state = await getConsent('u1');
    expect(state.research_optin).toBe(true);
  });

  it('never accepts necessary=false', async () => {
    const store = memoryStore();
    configureConsent({ store });

    // necessary is silently coerced to true regardless of input
    await setConsent('u1', { necessary: false });
    const state = await getConsent('u1');
    expect(state.necessary).toBe(true);
  });

  it('hasResearchConsent returns true only on explicit opt-in', async () => {
    const store = memoryStore();
    configureConsent({ store });

    expect(await hasResearchConsent('u1')).toBe(false); // null sentinel
    await setConsent('u1', { research_optin: false });
    expect(await hasResearchConsent('u1')).toBe(false);
    await setConsent('u1', { research_optin: true });
    expect(await hasResearchConsent('u1')).toBe(true);
  });

  it('needsResearchPrompt is true only for null state', async () => {
    const store = memoryStore();
    configureConsent({ store });

    expect(await needsResearchPrompt('u1')).toBe(true); // sentinel
    await setConsent('u1', { research_optin: false });
    expect(await needsResearchPrompt('u1')).toBe(false);
    await setConsent('u1', { research_optin: true });
    expect(await needsResearchPrompt('u1')).toBe(false);
  });

  it('fires async sync when setConsent is called', async () => {
    const store = memoryStore();
    const sync = vi.fn().mockResolvedValue(undefined);
    configureConsent({ store, sync });

    await setConsent('u1', { research_optin: true });
    // sync is fire-and-forget; tick microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0]?.[1]).toBe('u1');
  });

  it('sync failure does not throw or corrupt local state', async () => {
    const store = memoryStore();
    const sync = vi.fn().mockRejectedValue(new Error('network down'));
    configureConsent({ store, sync });

    await expect(setConsent('u1', { research_optin: true })).resolves.toBeUndefined();
    // local state must still update
    const state = await getConsent('u1');
    expect(state.research_optin).toBe(true);
  });
});

// ─── Görev 1: synchronous canonical helpers + legacy-key bridge ───────────────

describe('@ollie/consent · sync helpers (Görev 1)', () => {
  beforeEach(() => _resetConsent());
  afterEach(() => _resetConsent());

  it('getConsentSync returns the re-prompt sentinel on a brand-new install', () => {
    const store = memoryStore();
    const state = getConsentSync(store);
    expect(state.necessary).toBe(true);
    expect(state.research_optin).toBeNull();
    expect(state.set_at).toBe(0);
  });

  it('hasNecessaryConsent is false on a brand-new install (boot gate shows ConsentScreen)', () => {
    const store = memoryStore();
    expect(hasNecessaryConsent(store)).toBe(false);
  });

  it('hasMarketingConsent defaults to false (default-deny)', () => {
    const store = memoryStore();
    expect(hasMarketingConsent(store)).toBe(false);
  });

  it('reads back a post-pivot canonical row written directly', () => {
    const store = memoryStore();
    const row: ConsentState = {
      necessary: true,
      marketing: true,
      research_optin: true,
      set_at: CONSENT_PIVOT_TS + 5000,
      v: 1,
    };
    store.set(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, row);
    expect(hasNecessaryConsent(store)).toBe(true);
    expect(hasMarketingConsent(store)).toBe(true);
    expect(getConsentSync(store).research_optin).toBe(true);
  });

  it('legacy bridge: a returning System-A user with shared.consent.necessary keeps necessary', () => {
    const store = memoryStore();
    // System A wrote only the raw keys, no canonical consent.state row.
    store.set('shared', 'consent.necessary', true);
    store.set('shared', 'consent.marketing', true);

    // Boot gate must see necessary === true (user is NOT bounced to ConsentScreen).
    expect(hasNecessaryConsent(store)).toBe(true);

    // First canonical read seeds consent.state from the legacy keys.
    const seeded = getConsentSync(store);
    expect(seeded.necessary).toBe(true);
    expect(seeded.marketing).toBe(true);
    // research_optin is conservatively null → ConsentStep re-prompts.
    expect(seeded.research_optin).toBeNull();

    // The seed is persisted — a second read comes straight off consent.state.
    const persisted = store.get<ConsentState | null>(
      CONSENT_STORE_MODULE,
      CONSENT_STORE_KEY,
      null,
    );
    expect(persisted?.necessary).toBe(true);
    expect(persisted?.marketing).toBe(true);
  });

  it('legacy bridge: no legacy key + no canonical row → necessary stays false', () => {
    const store = memoryStore();
    store.set('shared', 'consent.necessary', false);
    expect(hasNecessaryConsent(store)).toBe(false);
    expect(getConsentSync(store).necessary).toBe(true); // type-level invariant
    expect(getConsentSync(store).set_at).toBe(0); // sentinel — nothing persisted
  });

  it('canonical row wins over a stale legacy key', () => {
    const store = memoryStore();
    // Stale legacy key says marketing-off; canonical row says marketing-on.
    store.set('shared', 'consent.marketing', false);
    store.set(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, {
      necessary: true,
      marketing: true,
      research_optin: false,
      set_at: CONSENT_PIVOT_TS + 1000,
      v: 1,
    } satisfies ConsentState);
    expect(hasMarketingConsent(store)).toBe(true);
  });

  it('setNecessaryConsentSync persists necessary=true to the canonical row', () => {
    const store = memoryStore();
    setNecessaryConsentSync(store);
    const row = store.get<ConsentState | null>(
      CONSENT_STORE_MODULE,
      CONSENT_STORE_KEY,
      null,
    );
    expect(row?.necessary).toBe(true);
    expect(hasNecessaryConsent(store)).toBe(true);
  });

  it('setMarketingConsentSync writes marketing through; necessary stays true', () => {
    const store = memoryStore();
    setMarketingConsentSync(store, false);
    expect(hasMarketingConsent(store)).toBe(false);
    expect(hasNecessaryConsent(store)).toBe(true);
    setMarketingConsentSync(store, true);
    expect(hasMarketingConsent(store)).toBe(true);
  });

  it('sync writers preserve research_optin (default-deny: never flips it on)', () => {
    const store = memoryStore();
    // Start from an explicit research opt-out.
    store.set(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, {
      necessary: true,
      marketing: false,
      research_optin: false,
      set_at: CONSENT_PIVOT_TS + 1000,
      v: 1,
    } satisfies ConsentState);
    setMarketingConsentSync(store, true);
    setNecessaryConsentSync(store);
    expect(getConsentSync(store).research_optin).toBe(false);
  });

  it('pre-pivot canonical row is migrated to research_optin null on sync read', () => {
    const store = memoryStore();
    store.set(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, {
      necessary: true,
      marketing: true,
      research_optin: true, // pre-pivot users were implicitly opted in
      set_at: CONSENT_PIVOT_TS - 1000,
      v: 1,
    } satisfies ConsentState);
    expect(getConsentSync(store).research_optin).toBeNull();
    expect(getConsentSync(store).marketing).toBe(true);
  });

  it('sync writers fire the configured durable sync sink', () => {
    const store = memoryStore();
    const sync = vi.fn().mockResolvedValue(undefined);
    configureConsent({ store, sync });
    setNecessaryConsentSync(store, 'u1');
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0]?.[1]).toBe('u1');
  });
});

// ─── S5 · stale consent cache must never mask an opt-out ──────────────────────

describe('@ollie/consent · S5 · opt-out is authoritative across all readers', () => {
  beforeEach(() => _resetConsent());
  afterEach(() => _resetConsent());

  it('after opt-OUT every reader (getConsent / getConsentSync / hasResearchConsent) sees false', async () => {
    const store = memoryStore();
    configureConsent({ store });

    // User opts IN — the research pipeline is open.
    await setConsent('u1', { research_optin: true });
    expect(await hasResearchConsent('u1')).toBe(true);

    // User opts OUT.
    await setConsent('u1', { research_optin: false });

    // EVERY reader must immediately reflect the opt-out — no stale cache.
    expect(await hasResearchConsent('u1')).toBe(false);
    expect((await getConsent('u1')).research_optin).toBe(false);
    expect(getConsentSync(store).research_optin).toBe(false);
    expect(await needsResearchPrompt('u1')).toBe(false);
  });

  it('opt-out under a real userId is seen even after a *Sync write under `_local`', async () => {
    // This is the exact desync the audit flagged: setConsent writes under
    // a real userId, the *Sync setters write under `_local`. A per-key
    // cache.set would leave one stale. cache.clear() in every setter fixes it.
    const store = memoryStore();
    configureConsent({ store });

    // Opt in under a real userId — caches { 'u1': optin:true }.
    await setConsent('u1', { research_optin: true });
    expect(await hasResearchConsent('u1')).toBe(true);

    // A *Sync setter writes the canonical row under the `_local` key.
    // Pre-fix this left the stale `u1 → optin:true` cache entry untouched.
    setMarketingConsentSync(store, true); // userId defaults to '_local'

    // The store row still says research opt-IN here (marketing-sync
    // preserves research_optin) — so flip research OFF directly in the
    // store, simulating a research opt-out written by another path.
    store.set(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, {
      necessary: true,
      marketing: true,
      research_optin: false,
      set_at: CONSENT_PIVOT_TS + 5000,
      v: 1,
    });

    // Now a *Sync write happens again. Pre-fix, the stale `u1` cache
    // entry would still mask this. Post-fix, every setter clears the
    // cache so the reader re-hydrates the opt-OUT row.
    setNecessaryConsentSync(store);
    expect(await hasResearchConsent('u1')).toBe(false);
    expect((await getConsent('u1')).research_optin).toBe(false);
  });

  it('setConsent opt-out clears the cache so a different userId also re-reads the store', async () => {
    const store = memoryStore();
    configureConsent({ store });

    // Two users read consent — both get cached.
    await setConsent('alice', { research_optin: true });
    expect(await hasResearchConsent('alice')).toBe(true);

    // alice opts out — setConsent clears the WHOLE cache.
    await setConsent('alice', { research_optin: false });
    expect(await hasResearchConsent('alice')).toBe(false);

    // The store row is canonical; a fresh read for alice is the opt-out.
    expect(getConsentSync(store).research_optin).toBe(false);
  });

  it('the *Sync setters never silently re-open research after an opt-out', () => {
    const store = memoryStore();
    configureConsent({ store });

    // Explicit research opt-out persisted.
    store.set(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, {
      necessary: true,
      marketing: false,
      research_optin: false,
      set_at: CONSENT_PIVOT_TS + 1000,
      v: 1,
    });

    // Toggling the OTHER consent flags must not flip research back on,
    // and must not leave a stale cached opt-in behind.
    setMarketingConsentSync(store, true);
    setNecessaryConsentSync(store);
    expect(getConsentSync(store).research_optin).toBe(false);
  });
});

// ─── B3-8 · expanded coverage — privacy-critical consent gate ─────────────────

describe('@ollie/consent · cache + unconfigured behaviour (B3-8)', () => {
  beforeEach(() => _resetConsent());
  afterEach(() => _resetConsent());

  it('getConsent caches the first read — a later store mutation is NOT seen until reset', async () => {
    const store = memoryStore();
    configureConsent({ store });

    // First read for u1 caches the sentinel.
    expect((await getConsent('u1')).research_optin).toBeNull();

    // Mutate the store directly, behind the cache's back.
    store.set(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, {
      necessary: true,
      marketing: false,
      research_optin: true,
      set_at: CONSENT_PIVOT_TS + 1000,
      v: 1,
    });

    // The cached read still wins (documented behaviour — setters clear it).
    expect((await getConsent('u1')).research_optin).toBeNull();

    // After a reset the next read re-hydrates from the store.
    _resetConsent();
    configureConsent({ store });
    expect((await getConsent('u1')).research_optin).toBe(true);
  });

  it('setConsent on an UNCONFIGURED package keeps the write in the cache', async () => {
    // No store wired — the cache is the source of truth in this mode.
    await setConsent('u1', { research_optin: true, marketing: true });
    const state = await getConsent('u1');
    expect(state.research_optin).toBe(true);
    expect(state.marketing).toBe(true);
    expect(state.necessary).toBe(true);
  });

  it('hasResearchConsent / needsResearchPrompt are sane while unconfigured', async () => {
    // Unconfigured + nothing cached → re-prompt sentinel (default-deny).
    expect(await hasResearchConsent('nobody')).toBe(false);
    expect(await needsResearchPrompt('nobody')).toBe(true);
  });

  it('setConsent honours an explicit set_at in the patch', async () => {
    const store = memoryStore();
    configureConsent({ store });
    await setConsent('u1', { research_optin: false, set_at: 4242 });
    const row = store.get<ConsentState | null>(
      CONSENT_STORE_MODULE,
      CONSENT_STORE_KEY,
      null,
    );
    expect(row?.set_at).toBe(4242);
  });

  it('setConsent leaves an un-patched field untouched', async () => {
    const store = memoryStore();
    configureConsent({ store });
    await setConsent('u1', { marketing: true });
    // research_optin was never patched — stays at the sentinel null.
    expect((await getConsent('u1')).research_optin).toBeNull();
    // Patch only research — marketing must survive.
    await setConsent('u1', { research_optin: true });
    expect((await getConsent('u1')).marketing).toBe(true);
  });

  it('defaultConsent with no argument stamps a near-now set_at', () => {
    const before = Date.now();
    const c = defaultConsent();
    const after = Date.now();
    expect(c.set_at).toBeGreaterThanOrEqual(before);
    expect(c.set_at).toBeLessThanOrEqual(after);
    expect(c.necessary).toBe(true);
    expect(c.research_optin).toBe(false);
  });

  it('configureConsent without a sink does not throw when a setter runs', async () => {
    const store = memoryStore();
    configureConsent({ store }); // no `sync`
    await expect(setConsent('u1', { research_optin: true })).resolves.toBeUndefined();
    expect(() => setNecessaryConsentSync(store)).not.toThrow();
  });

  it('re-configuring with a fresh store re-hydrates the canonical row', async () => {
    const storeA = memoryStore();
    configureConsent({ store: storeA });
    await setConsent('u1', { research_optin: true });

    // Swap in a brand-new empty store — the cache is cleared by the setter,
    // so the next read comes off storeB (empty) → sentinel.
    const storeB = memoryStore();
    _resetConsent();
    configureConsent({ store: storeB });
    expect((await getConsent('u1')).research_optin).toBeNull();
  });

  it('the pivot timestamp boundary is exclusive — set_at === pivot is NOT migrated', async () => {
    const store = memoryStore();
    store.set(CONSENT_STORE_MODULE, CONSENT_STORE_KEY, {
      necessary: true,
      marketing: false,
      research_optin: true,
      set_at: CONSENT_PIVOT_TS, // exactly on the pivot
      v: 1,
    });
    configureConsent({ store });
    // Migration condition is `set_at < CONSENT_PIVOT_TS` — equal is post-pivot.
    expect((await getConsent('u1')).research_optin).toBe(true);
    expect(getConsentSync(store).research_optin).toBe(true);
  });

  it('a sync-setter durable-sink rejection is swallowed (best-effort audit)', async () => {
    const store = memoryStore();
    const sync = vi.fn().mockRejectedValue(new Error('audit endpoint down'));
    configureConsent({ store, sync });
    // Fire-and-forget — must not throw synchronously.
    expect(() => setNecessaryConsentSync(store, 'u1')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    // Local store is still correctly written despite the sink failure.
    expect(hasNecessaryConsent(store)).toBe(true);
  });
});
