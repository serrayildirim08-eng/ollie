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

/**
 * Module namespaces that are bookkeeping-only and must NOT trigger a
 * cross-tab cache invalidation. Today this is just `_sync` (the sync
 * package's cursor/queue/watermark bookkeeping, moved here in iter-3 for
 * #120). Previously this was a broad `startsWith('_')` filter, which would
 * also have silently dropped any legitimate module whose name began with an
 * underscore — an invisible footgun. The deny-list is explicit instead (#123).
 */
const CROSS_TAB_DENY = new Set<string>(['_sync']);

export function installCrossTabSync(store: Store, adapter: StorageAdapter): () => void {
  if (!adapter.onChange) return () => {};
  const prefix = 'void.state.';
  const suffix = `.v${STORE_VERSION}`;
  return adapter.onChange((change) => {
    const key = change.key;
    if (!key || !key.startsWith(prefix) || !key.endsWith(suffix)) return;
    const mod = key.slice(prefix.length, -suffix.length);
    if (!mod || CROSS_TAB_DENY.has(mod)) return;
    store._invalidateModule(mod);
  });
}
