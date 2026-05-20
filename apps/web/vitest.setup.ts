/**
 * vitest setup — global test environment polyfills.
 *
 * jsdom (as configured here) exposes a `localStorage` object whose
 * getItem/setItem/removeItem are undefined, so any module that boots the real
 * `browserAdapter` (e.g. apps/web/src/store.ts via runMigrations) throws
 * "globalThis.localStorage.getItem is not a function" at import time.
 *
 * Most tests use `createMemoryAdapter()` and never hit this. Tests that
 * transitively import the app boot chain (account-boot → store) need a
 * working Storage. This installs a spec-compliant in-memory localStorage on
 * both `globalThis` and `window` so those imports succeed.
 */
import { beforeEach } from 'vitest';

function createLocalStorage(): Storage {
  let store = new Map<string, string>();
  const ls: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store = new Map();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };
  return ls;
}

const ls = createLocalStorage();
Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: ls, configurable: true });
}

/**
 * Pin a PHONE-width viewport as the test default.
 *
 * jsdom reports a 1024px `window.innerWidth`, which is above the 900px
 * `DESKTOP_MIN_WIDTH` floor — so `useIsWideViewport()` would default every
 * component tree to the desktop layout. The v2 module + primitive suites
 * (e.g. the `<Screen>` tests asserting the phone Find/Safe corner dots)
 * are written against the phone layout, which is the right default: the
 * app is phone-first. Tests that must exercise the desktop layout set a
 * wide `innerWidth` + dispatch a `resize` event themselves.
 */
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'innerWidth', {
    value: 390,
    writable: true,
    configurable: true,
  });
}

// Each test starts with a clean storage so boot side-effects don't leak.
beforeEach(() => {
  ls.clear();
});
