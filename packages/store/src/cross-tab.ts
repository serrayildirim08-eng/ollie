/**
 * @ollie/store · cross-tab sync
 *
 * When another tab/window writes to the same localStorage key, the browser
 * fires a `storage` event. We listen for our prefixed keys and invalidate
 * the affected module's cache so the next read picks up the fresh value
 * and subscribers fire.
 *
 * No-op when the adapter doesn't implement onChange (e.g. memory adapter
 * in tests).
 */

import type { StorageAdapter } from './adapter';
import { type Store, STORE_VERSION } from './store';

export function installCrossTabSync(store: Store, adapter: StorageAdapter): () => void {
  if (!adapter.onChange) return () => {};
  const prefix = 'void.state.';
  const suffix = `.v${STORE_VERSION}`;
  return adapter.onChange((change) => {
    const key = change.key;
    if (!key || !key.startsWith(prefix) || !key.endsWith(suffix)) return;
    const mod = key.slice(prefix.length, -suffix.length);
    if (!mod || mod.startsWith('_')) return;
    store._invalidateModule(mod);
  });
}
