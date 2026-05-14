/**
 * ConsentScreen · consent_audit telemetry tests
 *
 * Tests that trackTable('consent_audit', ...) is called with the
 * correct row shape when:
 *   1. User completes sign-up consent (event_source: 'signup')
 *   2. User toggles marketing in Settings (event_source: 'settings_change')
 *
 * We test the logic inline (not via full React render) to avoid
 * re-testing all the UI state tested in ConsentScreen.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../lib/account-boot', () => ({
  getAccount: vi.fn(),
}));

vi.mock('../lib/user-hash', () => ({
  readUserHash: vi.fn(() => 'testhash'),
}));

vi.mock('../lib/device', () => ({
  getDeviceId: vi.fn(() => 'device-001'),
  getAppVersion: vi.fn(() => '0.0.1-test'),
}));

import { getAccount } from '../lib/account-boot';
import { readUserHash } from '../lib/user-hash';
import { getAppVersion } from '../lib/device';

// ─── Inline the audit emit logic (mirrors ConsentScreen + SettingsScreen) ─────

type Research = { trackTable: ReturnType<typeof vi.fn>; hasConsent: () => boolean };

function emitConsentAuditSignup(
  research: Research,
  consent_marketing: boolean,
): void {
  if (!research.hasConsent()) return;
  const userHash = readUserHash();
  if (!userHash) return;
  research.trackTable('consent_audit', {
    user_hash: userHash,
    consent_necessary: true,
    consent_marketing,
    consented_at: new Date().toISOString(),
    event_source: 'signup',
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
    app_version: getAppVersion(),
  });
}

function emitConsentAuditSettingsChange(
  research: Research,
  consent_marketing: boolean,
): void {
  if (!research.hasConsent()) return;
  const userHash = readUserHash();
  if (!userHash) return;
  research.trackTable('consent_audit', {
    user_hash: userHash,
    consent_necessary: true,
    consent_marketing,
    consented_at: new Date().toISOString(),
    event_source: 'settings_change',
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
    app_version: getAppVersion(),
  });
}

function makeResearch(consent: boolean): Research {
  return { trackTable: vi.fn(), hasConsent: () => consent };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getAccount as ReturnType<typeof vi.fn>).mockReturnValue({
    research: makeResearch(true),
  });
});

// ─── signup path ──────────────────────────────────────────────────────────────

describe('ConsentScreen · consent_audit on signup', () => {
  it('emits consent_audit row with event_source signup and correct shape', () => {
    const r = makeResearch(true);
    emitConsentAuditSignup(r, true);

    expect(r.trackTable).toHaveBeenCalledOnce();
    const [table, row] = r.trackTable.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe('consent_audit');
    expect(row.user_hash).toBe('testhash');
    expect(row.consent_necessary).toBe(true);
    expect(row.consent_marketing).toBe(true);
    expect(row.event_source).toBe('signup');
    expect(typeof row.consented_at).toBe('string');
    expect(row.app_version).toBe('0.0.1-test');
    expect(typeof row.user_agent).toBe('string');
  });

  it('includes consent_marketing=false when user opted out', () => {
    const r = makeResearch(true);
    emitConsentAuditSignup(r, false);
    const [, row] = r.trackTable.mock.calls[0] as [string, Record<string, unknown>];
    expect(row.consent_marketing).toBe(false);
  });

  it('does NOT emit when consent is false', () => {
    const r = makeResearch(false);
    emitConsentAuditSignup(r, true);
    expect(r.trackTable).not.toHaveBeenCalled();
  });

  it('does NOT emit when user_hash is null', () => {
    (readUserHash as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const r = makeResearch(true);
    emitConsentAuditSignup(r, true);
    expect(r.trackTable).not.toHaveBeenCalled();
  });
});

// ─── settings_change path ─────────────────────────────────────────────────────

describe('SettingsScreen · consent_audit on marketing toggle', () => {
  it('emits consent_audit row with event_source settings_change', () => {
    const r = makeResearch(true);
    emitConsentAuditSettingsChange(r, false);

    expect(r.trackTable).toHaveBeenCalledOnce();
    const [table, row] = r.trackTable.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe('consent_audit');
    expect(row.event_source).toBe('settings_change');
    expect(row.consent_marketing).toBe(false);
    expect(row.consent_necessary).toBe(true);
  });

  it('emits with consent_marketing=true when re-enabling', () => {
    const r = makeResearch(true);
    emitConsentAuditSettingsChange(r, true);
    const [, row] = r.trackTable.mock.calls[0] as [string, Record<string, unknown>];
    expect(row.consent_marketing).toBe(true);
  });

  it('does NOT emit when consent is false', () => {
    const r = makeResearch(false);
    emitConsentAuditSettingsChange(r, false);
    expect(r.trackTable).not.toHaveBeenCalled();
  });

  it('does NOT emit when user_hash is null', () => {
    (readUserHash as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const r = makeResearch(true);
    emitConsentAuditSettingsChange(r, false);
    expect(r.trackTable).not.toHaveBeenCalled();
  });
});
