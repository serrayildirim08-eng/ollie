/**
 * seed.ts · unit tests
 *
 * Covers:
 *   - parseSeedFromString accepts hash + query + bare formats
 *   - parseSeedFromDeeplink accepts ollie://seed?payload=...
 *   - applySeed for append / replace / merge modes
 *   - gate (isSeedEnabled) blocks when flag absent
 *   - dedupe prevents re-applying same payload
 *   - malformed payloads are rejected
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '@ollie/store';
import {
  parseSeedFromString,
  parseSeedFromDeeplink,
  applySeed,
  applySeedFromString,
  isSeedEnabled,
  type SeedPayload,
} from './seed';

function memoryAdapter() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

function encode(payload: SeedPayload): string {
  return btoa(JSON.stringify(payload));
}

beforeEach(() => {
  // clear localStorage between tests (vitest jsdom env shares it)
  globalThis.localStorage?.clear?.();
});

describe('parseSeedFromString', () => {
  const sample: SeedPayload = {
    writes: [{ module: 'work', key: 'focus_log', mode: 'append', data: { ts: 1 } }],
    note: 'test',
  };

  it('parses #seed=<b64> hash format', () => {
    const hash = `#seed=${encode(sample)}`;
    expect(parseSeedFromString(hash)).toEqual(sample);
  });

  it('parses ?seed=<b64> query format', () => {
    expect(parseSeedFromString(`?seed=${encode(sample)}`)).toEqual(sample);
  });

  it('parses &seed=<b64> when mid-string', () => {
    expect(parseSeedFromString(`?foo=1&seed=${encode(sample)}`)).toEqual(sample);
  });

  it('parses bare seed=<b64>', () => {
    expect(parseSeedFromString(`seed=${encode(sample)}`)).toEqual(sample);
  });

  it('returns null on missing seed param', () => {
    expect(parseSeedFromString('#foo=bar')).toBeNull();
  });

  it('returns null on malformed base64', () => {
    expect(parseSeedFromString('#seed=not!valid!')).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    expect(parseSeedFromString(`#seed=${btoa('{ broken')}`)).toBeNull();
  });

  it('rejects payload missing writes array', () => {
    const bad = btoa(JSON.stringify({ note: 'no writes' }));
    expect(parseSeedFromString(`#seed=${bad}`)).toBeNull();
  });

  it('rejects payload with invalid mode', () => {
    const bad = btoa(JSON.stringify({
      writes: [{ module: 'work', key: 'x', mode: 'delete', data: 1 }],
    }));
    expect(parseSeedFromString(`#seed=${bad}`)).toBeNull();
  });

  it('tolerates URL-safe base64', () => {
    const raw = JSON.stringify(sample);
    const urlSafe = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(parseSeedFromString(`#seed=${urlSafe}`)).toEqual(sample);
  });
});

describe('parseSeedFromDeeplink', () => {
  const sample: SeedPayload = {
    writes: [{ module: 'work', key: 'focus_log', mode: 'append', data: { ts: 1 } }],
  };

  it('parses ollie://seed?payload=<b64>', () => {
    expect(parseSeedFromDeeplink(`ollie://seed?payload=${encode(sample)}`)).toEqual(sample);
  });

  it('rejects non-ollie scheme', () => {
    expect(parseSeedFromDeeplink(`https://example.com/?payload=${encode(sample)}`)).toBeNull();
  });

  it('rejects ollie:// with wrong path', () => {
    expect(parseSeedFromDeeplink(`ollie://capture?payload=${encode(sample)}`)).toBeNull();
  });

  it('rejects ollie://seed without payload', () => {
    expect(parseSeedFromDeeplink('ollie://seed')).toBeNull();
  });
});

describe('applySeed', () => {
  it('appends single item to array slice', () => {
    const store = createStore(memoryAdapter());
    const result = applySeed({
      writes: [{ module: 'work', key: 'focus_log', mode: 'append', data: { ts: 42 } }],
    }, store);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(store.get('work', 'focus_log')).toEqual([{ ts: 42 }]);
  });

  it('appends array of items', () => {
    const store = createStore(memoryAdapter());
    applySeed({
      writes: [{ module: 'work', key: 'focus_log', mode: 'append', data: [{ ts: 1 }, { ts: 2 }] }],
    }, store);
    expect(store.get('work', 'focus_log')).toEqual([{ ts: 1 }, { ts: 2 }]);
  });

  it('preserves existing array when appending', () => {
    const store = createStore(memoryAdapter());
    store.set('work', 'focus_log', [{ ts: 0 }]);
    applySeed({
      writes: [{ module: 'work', key: 'focus_log', mode: 'append', data: { ts: 1 } }],
    }, store);
    expect(store.get('work', 'focus_log')).toEqual([{ ts: 0 }, { ts: 1 }]);
  });

  it('replaces value entirely', () => {
    const store = createStore(memoryAdapter());
    store.set('work', 'projects', ['old']);
    applySeed({
      writes: [{ module: 'work', key: 'projects', mode: 'replace', data: ['new'] }],
    }, store);
    expect(store.get('work', 'projects')).toEqual(['new']);
  });

  it('merges into existing object', () => {
    const store = createStore(memoryAdapter());
    store.set('work', 'config', { a: 1, b: 2 });
    applySeed({
      writes: [{ module: 'work', key: 'config', mode: 'merge', data: { b: 99, c: 3 } }],
    }, store);
    expect(store.get('work', 'config')).toEqual({ a: 1, b: 99, c: 3 });
  });

  it('writes to multiple slices in one payload', () => {
    const store = createStore(memoryAdapter());
    const result = applySeed({
      writes: [
        { module: 'work', key: 'focus_log', mode: 'append', data: { ts: 1 } },
        { module: 'work', key: 'sessions', mode: 'append', data: { id: 's1' } },
      ],
    }, store);
    expect(result.applied).toBe(2);
    expect(store.get('work', 'focus_log')).toEqual([{ ts: 1 }]);
    expect(store.get('work', 'sessions')).toEqual([{ id: 's1' }]);
  });
});

describe('isSeedEnabled gate', () => {
  it('returns false when flag absent', () => {
    expect(isSeedEnabled()).toBe(false);
  });

  it('returns true when flag set to "1"', () => {
    globalThis.localStorage.setItem('ollie.debug.seed_enabled', '1');
    expect(isSeedEnabled()).toBe(true);
  });

  it('returns false when flag is some other value', () => {
    globalThis.localStorage.setItem('ollie.debug.seed_enabled', 'yes');
    expect(isSeedEnabled()).toBe(false);
  });
});

describe('applySeedFromString end-to-end', () => {
  const sample: SeedPayload = {
    writes: [{ module: 'work', key: 'focus_log', mode: 'append', data: { ts: 1 } }],
    note: 'one session',
  };

  it('calls onDisabled when gate off', () => {
    const store = createStore(memoryAdapter());
    let disabledFired = false;
    applySeedFromString(`#seed=${encode(sample)}`, {
      store,
      onDisabled: () => { disabledFired = true; },
    });
    expect(disabledFired).toBe(true);
    expect(store.get('work', 'focus_log')).toBeUndefined();
  });

  it('applies and reports success when gate on', () => {
    globalThis.localStorage.setItem('ollie.debug.seed_enabled', '1');
    const store = createStore(memoryAdapter());
    let appliedN = -1;
    let note: string | undefined;
    applySeedFromString(`#seed=${encode(sample)}`, {
      store,
      onSuccess: (n, c) => { note = n; appliedN = c; },
    });
    expect(appliedN).toBe(1);
    expect(note).toBe('one session');
    expect(store.get('work', 'focus_log')).toEqual([{ ts: 1 }]);
  });

  it('dedupes on second call with same payload', () => {
    globalThis.localStorage.setItem('ollie.debug.seed_enabled', '1');
    const store = createStore(memoryAdapter());
    let successCount = 0;
    let dedupedFired = false;
    const input = `#seed=${encode(sample)}`;

    applySeedFromString(input, { store, onSuccess: () => { successCount++; } });
    applySeedFromString(input, {
      store,
      onSuccess: () => { successCount++; },
      onDeduped: () => { dedupedFired = true; },
    });

    expect(successCount).toBe(1);
    expect(dedupedFired).toBe(true);
    expect((store.get('work', 'focus_log') as unknown[]).length).toBe(1);
  });

  it('returns found=false when no seed in string', () => {
    const store = createStore(memoryAdapter());
    const result = applySeedFromString('#nothing-here', { store });
    expect(result).toEqual({ found: false, applied: false });
  });
});
