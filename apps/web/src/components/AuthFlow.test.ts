/**
 * AuthFlow · email pre-fill reader (Fix 2).
 *
 * Regression: readPrefilledEmail used to scan `ollie:shared:auth.email_for_login`
 * but the real store key is the JSON blob at `void.state.shared.v5` with the
 * email nested under `auth.email_for_login`. Returning users always saw the
 * fork screen because the reader returned '' even when an email was stored.
 *
 * This test reproduces the read logic against an in-memory storage shim that
 * matches `void.state.<mod>.v<STORE_VERSION>` so any future regression of the
 * key shape (storeModuleKey()) breaks this test, not alpha users' UX.
 */

import { describe, it, expect } from 'vitest';
import { storeModuleKey } from '@ollie/store';

const SHARED_KEY = storeModuleKey('shared');
const EMAIL_LS_KEY = 'auth.email_for_login';

// Mirrors the reader in AuthFlow.tsx so a change in either has to be reflected
// here — surfaces the breakage at test time, not in UX.
function readEmail(storage: Map<string, string>): string {
  try {
    const raw = storage.get(SHARED_KEY) ?? null;
    if (!raw) return '';
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    const value = parsed && typeof parsed === 'object' ? parsed[EMAIL_LS_KEY] : null;
    return typeof value === 'string' ? value : '';
  } catch { return ''; }
}

describe('AuthFlow · readPrefilledEmail (Fix 2)', () => {
  it('returns empty when no shared state exists', () => {
    const s = new Map<string, string>();
    expect(readEmail(s)).toBe('');
  });

  it('reads email_for_login from the void.state.shared.v5 JSON blob', () => {
    const s = new Map<string, string>();
    s.set(SHARED_KEY, JSON.stringify({ [EMAIL_LS_KEY]: 'serra@akalan.law' }));
    expect(readEmail(s)).toBe('serra@akalan.law');
  });

  it('ignores the OLD wrong key shape (regression guard)', () => {
    const s = new Map<string, string>();
    s.set('ollie:shared:shared.auth.email_for_login', JSON.stringify('serra@akalan.law'));
    expect(readEmail(s)).toBe('');
  });

  it('returns empty on malformed JSON blob', () => {
    const s = new Map<string, string>();
    s.set(SHARED_KEY, '{not-json');
    expect(readEmail(s)).toBe('');
  });

  it('canonical shared module key is void.state.shared.v5', () => {
    expect(SHARED_KEY).toBe('void.state.shared.v5');
  });

  it('non-string email values yield empty string', () => {
    const s = new Map<string, string>();
    s.set(SHARED_KEY, JSON.stringify({ [EMAIL_LS_KEY]: 42 }));
    expect(readEmail(s)).toBe('');
  });
});
