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
  hasResearchConsent,
  needsResearchPrompt,
  setConsent,
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

    // @ts-expect-error — necessary:false is not a valid patch
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
