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
    expect(sync.mock.calls[0][1]).toBe('u1');
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
    expect(sync.mock.calls[0][1]).toBe('u1');
  });
});
