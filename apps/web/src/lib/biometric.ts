/**
 * apps/web · biometric unlock
 *
 * Single-purpose gate for the Money module's privacy mode. Locks all $
 * figures behind a platform-biometric prompt when the user opts in.
 *
 *   Web         → WebAuthn (`navigator.credentials.get`) with a discoverable
 *                 credential. On first unlock we silently register a resident
 *                 key so subsequent unlocks need no username/UI chrome.
 *   Capacitor   → TODO: `@capacitor-community/native-biometric` is not yet
 *                 in `apps/web/package.json`. Until it ships, Capacitor
 *                 builds fall through to the WebAuthn path (most modern iOS
 *                 Safari + Android Chrome WebViews speak it). To wire native:
 *                 add the dep, then replace `unlock()` below with:
 *                   import { NativeBiometric } from '@capacitor-community/native-biometric';
 *                   await NativeBiometric.verifyIdentity({ reason: 'unlock money' });
 *
 * Returns a discriminated result instead of throwing — the caller renders a
 * quiet inline error rather than a runtime crash.
 *
 * Persistence is handled by the caller: store `privacy.unlockedUntil` and
 * compare against `Date.now()` to decide whether a re-prompt is needed.
 */

export type BiometricResult =
  | { ok: true; method: 'webauthn' | 'capacitor' | 'dev-bypass' }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'error'; detail?: string };

const RP_NAME = 'ollie';
const CREDENTIAL_STORAGE_KEY = 'ollie:biometric:credentialId';

function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials
  );
}

function getRpId(): string {
  // WebAuthn rpId must be a registrable domain suffix of the page's origin.
  // For localhost dev, the host string ('localhost') works directly.
  return typeof window !== 'undefined' ? window.location.hostname : 'localhost';
}

function randomBytes(len: number): ArrayBuffer {
  const b = new Uint8Array(new ArrayBuffer(len));
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(b);
  }
  return b.buffer;
}

function b64urlEncode(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): ArrayBuffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out.buffer;
}

function loadStoredCredentialId(): ArrayBuffer | null {
  try {
    const raw = localStorage.getItem(CREDENTIAL_STORAGE_KEY);
    return raw ? b64urlDecode(raw) : null;
  } catch {
    return null;
  }
}

function saveCredentialId(id: ArrayBuffer): void {
  try {
    localStorage.setItem(CREDENTIAL_STORAGE_KEY, b64urlEncode(id));
  } catch {
    /* private mode, fail-open */
  }
}

/**
 * Register a resident credential on first use. Pulls up the platform
 * authenticator (Touch ID / Face ID / Windows Hello / Android biometric).
 */
async function registerCredential(): Promise<ArrayBuffer | null> {
  if (!isWebAuthnAvailable()) return null;
  try {
    const userId = randomBytes(16);
    const opts: PublicKeyCredentialCreationOptions = {
      challenge: randomBytes(32),
      rp: { name: RP_NAME, id: getRpId() },
      user: {
        id: userId,
        name: 'ollie-local-user',
        displayName: 'ollie',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 30_000,
      attestation: 'none',
    };
    const cred = await navigator.credentials.create({ publicKey: opts });
    if (!cred) return null;
    const id = (cred as PublicKeyCredential).rawId;
    saveCredentialId(id);
    return id;
  } catch {
    return null;
  }
}

/**
 * Prompt for biometric unlock. Registers a credential on first run, then
 * uses it for every subsequent call.
 */
export async function unlock(): Promise<BiometricResult> {
  // Dev bypass — Vite exposes `import.meta.env.DEV`. Lets test fixtures and
  // local development skip the prompt; production builds (`vite build`) get
  // the real path.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    if (env?.DEV && env?.VITE_BYPASS_BIOMETRIC === '1') {
      return { ok: true, method: 'dev-bypass' };
    }
  } catch { /* no import.meta — fall through */ }

  if (!isWebAuthnAvailable()) {
    return { ok: false, reason: 'unsupported', detail: 'webauthn not available' };
  }

  // First-run registration — silent, surfaces a native biometric prompt once.
  let credentialId = loadStoredCredentialId();
  if (!credentialId) {
    credentialId = await registerCredential();
    if (credentialId) {
      // Registration itself satisfies user verification; treat as unlocked.
      return { ok: true, method: 'webauthn' };
    }
    return { ok: false, reason: 'error', detail: 'failed to register credential' };
  }

  try {
    const opts: PublicKeyCredentialRequestOptions = {
      challenge: randomBytes(32),
      rpId: getRpId(),
      allowCredentials: [{ id: credentialId, type: 'public-key' }],
      userVerification: 'required',
      timeout: 30_000,
    };
    const assertion = await navigator.credentials.get({ publicKey: opts });
    if (!assertion) return { ok: false, reason: 'cancelled' };
    return { ok: true, method: 'webauthn' };
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name ?? 'error';
    if (name === 'NotAllowedError' || name === 'AbortError') {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: 'error', detail: name };
  }
}

export function isBiometricSupported(): boolean {
  return isWebAuthnAvailable();
}

/** Test-only: reset stored credential. */
export function _resetForTests(): void {
  try { localStorage.removeItem(CREDENTIAL_STORAGE_KEY); } catch { /* ignore */ }
}
