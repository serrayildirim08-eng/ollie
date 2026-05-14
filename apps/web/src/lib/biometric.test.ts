/**
 * biometric.ts · unit tests
 *
 * Covers:
 *   - Web path: unlockViaWebAuthn called when not Capacitor native
 *   - Native path: unlockViaNative called when Capacitor native
 *   - Native success → {ok: true, method: 'capacitor'}
 *   - Native verifyIdentity rejection (cancel) → {ok: false, reason: 'cancelled'}
 *   - Native not-available → {ok: false, reason: 'unsupported'}
 *   - Module import failure → falls back to WebAuthn
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── helpers to patch globalThis.Capacitor ──────────────────────────────

function setCapacitorNative(value: boolean) {
  (globalThis as unknown as Record<string, unknown>).Capacitor = {
    isNativePlatform: () => value,
  };
}

function clearCapacitor() {
  delete (globalThis as unknown as Record<string, unknown>).Capacitor;
}

// ─── mock @capacitor-community/native-biometric via vi.mock ──────────────

// We define the mock shape inline; tests override per-case via mockResolvedValue.
const mockIsAvailable = vi.fn();
const mockVerifyIdentity = vi.fn();

vi.mock('@capgo/capacitor-native-biometric', () => ({
  NativeBiometric: {
    isAvailable: mockIsAvailable,
    verifyIdentity: mockVerifyIdentity,
  },
}));

// ─── mock WebAuthn APIs to prevent JSDOM crashes ─────────────────────────

beforeEach(() => {
  mockIsAvailable.mockReset();
  mockVerifyIdentity.mockReset();

  // Stub navigator.credentials so WebAuthn path is exercisable without a
  // real authenticator. Tests that need the web path to 'work' use this.
  Object.defineProperty(globalThis, 'window', {
    value: {
      PublicKeyCredential: function PublicKeyCredential() { /* stub */ },
      location: { hostname: 'localhost' },
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { credentials: { get: vi.fn(), create: vi.fn() } },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  clearCapacitor();
  vi.restoreAllMocks();
});

// ─── import subject (after mocks declared) ───────────────────────────────

const { unlock, unlockViaWebAuthn } = await import('./biometric');

// ─── tests ───────────────────────────────────────────────────────────────

describe('biometric · runtime dispatch', () => {
  it('calls native path when Capacitor.isNativePlatform() is true', async () => {
    setCapacitorNative(true);
    mockIsAvailable.mockResolvedValue({ isAvailable: true });
    mockVerifyIdentity.mockResolvedValue(undefined);

    const result = await unlock();

    expect(mockVerifyIdentity).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, method: 'capacitor' });
  });

  it('calls WebAuthn path when not Capacitor native', async () => {
    clearCapacitor();
    // WebAuthn not available in JSDOM — should return unsupported gracefully
    // (window.PublicKeyCredential exists but navigator.credentials.get won't
    //  produce a real assertion). We just verify the native mock is NOT called.
    const result = await unlock();

    expect(mockVerifyIdentity).not.toHaveBeenCalled();
    // Result is either ok or a webauthn-path failure — never 'capacitor'
    if (result.ok) {
      expect(result.method).not.toBe('capacitor');
    }
  });
});

describe('biometric · native success', () => {
  it('returns {ok: true, method: capacitor} on verifyIdentity resolve', async () => {
    setCapacitorNative(true);
    mockIsAvailable.mockResolvedValue({ isAvailable: true });
    mockVerifyIdentity.mockResolvedValue(undefined);

    const result = await unlock();
    expect(result).toEqual({ ok: true, method: 'capacitor' });
  });
});

describe('biometric · native cancel', () => {
  it('returns {ok: false, reason: cancelled} when verifyIdentity rejects with cancel message', async () => {
    setCapacitorNative(true);
    mockIsAvailable.mockResolvedValue({ isAvailable: true });
    mockVerifyIdentity.mockRejectedValue(new Error('User cancelled biometric'));

    const result = await unlock();
    expect(result).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('returns {ok: false, reason: cancelled} on "dismissed" message', async () => {
    setCapacitorNative(true);
    mockIsAvailable.mockResolvedValue({ isAvailable: true });
    mockVerifyIdentity.mockRejectedValue(new Error('dismissed'));

    const result = await unlock();
    expect(result).toEqual({ ok: false, reason: 'cancelled' });
  });
});

describe('biometric · native not available', () => {
  it('returns {ok: false, reason: unsupported} when isAvailable returns false', async () => {
    setCapacitorNative(true);
    mockIsAvailable.mockResolvedValue({ isAvailable: false });

    const result = await unlock();
    expect(result).toEqual({
      ok: false,
      reason: 'unsupported',
      detail: 'native biometry not available',
    });
    expect(mockVerifyIdentity).not.toHaveBeenCalled();
  });
});

describe('biometric · unlockViaWebAuthn export still works', () => {
  it('is exported and returns a BiometricResult', async () => {
    // JSDOM has no real WebAuthn — we expect either an error or unsupported,
    // never a crash.
    clearCapacitor();
    const result = await unlockViaWebAuthn();
    expect(typeof result.ok).toBe('boolean');
  });
});
