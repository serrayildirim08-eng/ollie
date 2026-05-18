/**
 * apps/web · biometric unlock
 *
 * GENERAL-PURPOSE platform-biometric prompt. Two call sites today:
 *   - the Money module's privacy mode (mask all $ figures), and
 *   - the app-lock gate (re-entry screen on cold boot / resume).
 * The functions here are deliberately feature-agnostic — they only answer
 * "did the user just pass a platform-biometric check?". Callers decide
 * what that unlocks.
 *
 *   Web / SSR    → WebAuthn (`navigator.credentials.get`) with a discoverable
 *                  credential. On first unlock we silently register a resident
 *                  key so subsequent unlocks need no username/UI chrome.
 *   Capacitor    → `@capgo/capacitor-native-biometric` via dynamic import.
 *                  Dispatched when `Capacitor.isNativePlatform()` returns true.
 *                  If the module is not yet installed at runtime (workspace
 *                  install lag) we warn and fall back to WebAuthn.
 *
 * Returns a discriminated result instead of throwing — the caller renders a
 * quiet inline error rather than a runtime crash.
 *
 * IMPORTANT: this is NOT cryptographic. A successful unlock does not derive
 * or hold any encryption key — it is a UI-level "the device owner is here"
 * signal. The passphrase remains the only thing that decrypts data.
 *
 * Persistence is handled by the caller (e.g. store `privacy.unlockedUntil`
 * or the app-lock `locked` flag) and compared against `Date.now()`.
 */

export type BiometricResult =
  | { ok: true; method: 'webauthn' | 'capacitor' | 'dev-bypass' }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'error'; detail?: string };

const RP_NAME = 'ollie';
const CREDENTIAL_STORAGE_KEY = 'ollie:biometric:credentialId';

// ─── runtime detection ────────────────────────────────────────────────────

interface CapacitorGlobal {
  Capacitor?: { isNativePlatform?: () => boolean };
}

function isCapacitorNative(): boolean {
  const g = globalThis as unknown as CapacitorGlobal;
  return g.Capacitor?.isNativePlatform?.() === true;
}

// ─── WebAuthn helpers ─────────────────────────────────────────────────────

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

// ─── WebAuthn path (kept as named export for tests + internal use) ────────

/**
 * Prompt for biometric unlock via WebAuthn. Registers a credential on first
 * run, then uses it for every subsequent call.
 */
export async function unlockViaWebAuthn(): Promise<BiometricResult> {
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

// ─── Capacitor native path ─────────────────────────────────────────────────

/**
 * What the unlock is FOR — drives the native prompt's reason string so the
 * OS dialog reads honestly ("unlock ollie" vs "unlock finance privacy
 * mode"). WebAuthn shows no caller-supplied copy, so this only affects the
 * Capacitor path.
 */
export type UnlockPurpose = 'app' | 'finance-privacy';

const NATIVE_STRINGS: Record<
  UnlockPurpose,
  Record<'en' | 'es', { reason: string; title: string }>
> = {
  app: {
    en: { reason: 'unlock ollie', title: 'unlock' },
    es: { reason: 'desbloquear ollie', title: 'desbloquear' },
  },
  'finance-privacy': {
    en: { reason: 'unlock finance privacy mode', title: 'unlock' },
    es: { reason: 'desbloquear modo privado de finanzas', title: 'desbloquear' },
  },
};

async function unlockViaNative(
  locale: 'en' | 'es' = 'en',
  purpose: UnlockPurpose = 'finance-privacy',
): Promise<BiometricResult> {
  // Dynamic import so the web bundle doesn't choke when the dep is absent.
  let NativeBiometric: { isAvailable: () => Promise<{ isAvailable: boolean }>; verifyIdentity: (opts: Record<string, unknown>) => Promise<void> };
  try {
    const mod = await import('@capgo/capacitor-native-biometric');
    NativeBiometric = mod.NativeBiometric as typeof NativeBiometric;
  } catch (importErr) {
    console.warn('[biometric] @capgo/capacitor-native-biometric not installed; falling back to WebAuthn', importErr);
    return unlockViaWebAuthn();
  }

  // Check availability (no biometry enrolled, hardware absent, etc.)
  let available: boolean;
  try {
    const check = await NativeBiometric.isAvailable();
    available = check.isAvailable;
  } catch {
    available = false;
  }
  if (!available) {
    return { ok: false, reason: 'unsupported', detail: 'native biometry not available' };
  }

  try {
    const byLocale = NATIVE_STRINGS[purpose] ?? NATIVE_STRINGS['finance-privacy'];
    const { reason, title } = byLocale[locale] ?? byLocale.en;
    await NativeBiometric.verifyIdentity({
      reason,
      title,
      subtitle: '',
      description: '',
    });
    return { ok: true, method: 'capacitor' };
  } catch (err: unknown) {
    // Plugin rejects on cancel or failure; no standardised error code across
    // iOS + Android, so we inspect the message string conservatively.
    const msg = (err as { message?: string })?.message ?? '';
    const isCancel =
      msg.toLowerCase().includes('cancel') ||
      msg.toLowerCase().includes('user cancel') ||
      msg.toLowerCase().includes('dismissed');
    if (isCancel) {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: 'unsupported', detail: msg };
  }
}

// ─── public API ───────────────────────────────────────────────────────────

/**
 * Prompt for biometric unlock. Dispatches to the native Capacitor plugin
 * when running inside a Capacitor native shell, and falls back to WebAuthn
 * everywhere else (web, SSR, Node test environments).
 *
 * `purpose` only colours the native OS prompt copy; defaults to the
 * finance-privacy call site for backward compatibility.
 */
export async function unlock(
  locale: 'en' | 'es' = 'en',
  purpose: UnlockPurpose = 'finance-privacy',
): Promise<BiometricResult> {
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

  if (isCapacitorNative()) {
    return unlockViaNative(locale, purpose);
  }
  return unlockViaWebAuthn();
}

export function isBiometricSupported(): boolean {
  return isCapacitorNative() || isWebAuthnAvailable();
}

/** Test-only: reset stored credential. */
export function _resetForTests(): void {
  try { localStorage.removeItem(CREDENTIAL_STORAGE_KEY); } catch { /* ignore */ }
}
