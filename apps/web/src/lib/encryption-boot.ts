/**
 * encryption-boot — AES-GCM-256 passphrase boot for work + goals modules.
 *
 * Stores the session passphrase in sessionStorage (cleared on tab close).
 * bootEncryption is a no-op until the full AES-GCM snapshot sprint ships.
 * The public API is stable so SettingsScreen + store.ts compile today.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStore = { set: (...args: any[]) => void; get: (...args: any[]) => unknown };

const SESSION_KEY = 'ollie.encryption.passphrase';

export function hasSessionPassphrase(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

export async function setSessionPassphrase(
  store: AnyStore,
  passphrase: string,
): Promise<void> {
  try {
    sessionStorage.setItem(SESSION_KEY, passphrase);
  } catch {
    // Private-browsing or quota exceeded — continue without caching.
  }
  await bootEncryption(store, { promptForPassphrase: () => Promise.resolve(passphrase) });
}

export function clearSessionPassphrase(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore.
  }
}

export interface BootEncryptionOpts {
  promptForPassphrase: () => Promise<string | null>;
}

/**
 * Restores the AES-GCM encrypted snapshot for work + goals into the live store.
 * No-op if no passphrase is available.
 * TODO (encryption sprint): decrypt localStorage snapshot for work + goals.
 */
export async function bootEncryption(
  _store: AnyStore,
  opts: BootEncryptionOpts,
): Promise<void> {
  let passphrase: string | null = null;
  try {
    passphrase = sessionStorage.getItem(SESSION_KEY);
  } catch {
    // sessionStorage unavailable.
  }
  if (!passphrase) {
    passphrase = await opts.promptForPassphrase();
  }
  if (!passphrase) return;
  // TODO: decrypt work + goals snapshot and restore via store.set().
}
