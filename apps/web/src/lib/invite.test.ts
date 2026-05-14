/**
 * invite · deep-link parser tests
 *
 * Covers the three URL surfaces the parser supports:
 *   - ?invite=xxx  (web query string)
 *   - #invite=xxx  (web hash)
 *   - ollie://invite/xxx (Capacitor deep-link)
 *
 * sessionStorage / window are jsdom-provided per vitest.config.ts.
 * fetch-backed calls (generateInvite/validateInvite/claimInvite) are
 * intentionally NOT exercised here — they belong in a worker integration
 * test once the backend ships.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureInviteFromUrl,
  captureInviteFromDeeplink,
  readPendingInviteCode,
  clearPendingInviteCode,
} from './invite';

function resetState() {
  try { sessionStorage.clear(); } catch { /* noop */ }
  // Reset URL — jsdom keeps state across tests.
  window.history.replaceState({}, '', '/');
}

describe('captureInviteFromUrl', () => {
  beforeEach(resetState);

  it('returns null when no invite param is present', () => {
    expect(captureInviteFromUrl()).toBeNull();
    expect(readPendingInviteCode()).toBeNull();
  });

  it('captures from ?invite=abc123 and stores normalized', () => {
    window.history.replaceState({}, '', '/?invite=Olli-ABCD-1234');
    const code = captureInviteFromUrl();
    expect(code).toBe('olli-abcd-1234');
    expect(readPendingInviteCode()).toBe('olli-abcd-1234');
    // URL stripped
    expect(window.location.search).not.toContain('invite');
  });

  it('captures from #invite=abc', () => {
    window.history.replaceState({}, '', '/#invite=olli-zzzz-9999');
    const code = captureInviteFromUrl();
    expect(code).toBe('olli-zzzz-9999');
    expect(readPendingInviteCode()).toBe('olli-zzzz-9999');
  });

  it('clearPendingInviteCode wipes the value', () => {
    window.history.replaceState({}, '', '/?invite=olli-aaaa-bbbb');
    captureInviteFromUrl();
    expect(readPendingInviteCode()).toBe('olli-aaaa-bbbb');
    clearPendingInviteCode();
    expect(readPendingInviteCode()).toBeNull();
  });
});

describe('captureInviteFromDeeplink', () => {
  beforeEach(resetState);

  it('handles ollie://invite/<code>', () => {
    const code = captureInviteFromDeeplink('ollie://invite/olli-deep-1234');
    expect(code).toBe('olli-deep-1234');
    expect(readPendingInviteCode()).toBe('olli-deep-1234');
  });

  it('handles ollie://invite?code=<code>', () => {
    const code = captureInviteFromDeeplink('ollie://invite?code=olli-qs-9999');
    expect(code).toBe('olli-qs-9999');
  });

  it('rejects non-invite scheme', () => {
    expect(captureInviteFromDeeplink('ollie://capture')).toBeNull();
    expect(captureInviteFromDeeplink('https://example.com/?invite=x')).toBeNull();
    expect(readPendingInviteCode()).toBeNull();
  });
});
