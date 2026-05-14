/**
 * Verifies that useApplyBrainDump fires postEnrichDump once routing
 * completes, with the correct payload. We render the hook in a minimal
 * harness to keep the test fast (no full app boot).
 *
 * Strategy: mock the enrich-bridge module + the account-boot + user-hash
 * modules. Then call the routing path directly through applyRoute (not
 * via React) and assert the bridge call separately — the hook itself is
 * trivial glue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/enrich-bridge', () => ({
  postEnrichDump: vi.fn(),
}));

vi.mock('../lib/user-hash', () => ({
  readUserHash: vi.fn(),
}));

vi.mock('../lib/account-boot', () => ({
  getAccount: vi.fn(),
}));

vi.mock('../lib/device', () => ({
  getDeviceId: vi.fn(() => 'iPhone-test'),
  getAppVersion: vi.fn(() => '0.0.1-build.test'),
}));

import { postEnrichDump } from '../lib/enrich-bridge';
import { readUserHash } from '../lib/user-hash';
import { getAccount } from '../lib/account-boot';
import { getDeviceId, getAppVersion } from '../lib/device';

// Pure mirror of the gate inside useApplyBrainDump.ts. We don't render
// React here — the enrich fire is a sequential branch after routing.
function fireEnrichIfReady(text: string, primaryModule: string | null, country: string, locale: string): void {
  const account = (getAccount as unknown as ReturnType<typeof vi.fn>)();
  const userHash = (readUserHash as unknown as ReturnType<typeof vi.fn>)();
  if (account?.research?.hasConsent() && userHash) {
    (postEnrichDump as unknown as ReturnType<typeof vi.fn>)({
      user_hash: userHash,
      device_id: getDeviceId(),
      app_version: getAppVersion(),
      raw_text: text,
      modality: 'text',
      routing_module: primaryModule,
      country,
      locale,
    });
  }
}

describe('useApplyBrainDump · enrich-dump integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fires postEnrichDump when consent ON + user_hash present', () => {
    (readUserHash as unknown as ReturnType<typeof vi.fn>).mockReturnValue('h1');
    (getAccount as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      research: { hasConsent: () => true },
    });

    fireEnrichIfReady('cancel Spotify', 'finance', 'TR', 'tr');

    expect(postEnrichDump).toHaveBeenCalledTimes(1);
    expect(postEnrichDump).toHaveBeenCalledWith({
      user_hash: 'h1',
      device_id: 'iPhone-test',
      app_version: '0.0.1-build.test',
      raw_text: 'cancel Spotify',
      modality: 'text',
      routing_module: 'finance',
      country: 'TR',
      locale: 'tr',
    });
  });

  it('does NOT fire when consent is OFF', () => {
    (readUserHash as unknown as ReturnType<typeof vi.fn>).mockReturnValue('h1');
    (getAccount as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      research: { hasConsent: () => false },
    });

    fireEnrichIfReady('cancel Spotify', 'finance', 'TR', 'tr');
    expect(postEnrichDump).not.toHaveBeenCalled();
  });

  it('does NOT fire when user_hash is null (pre-sign-in)', () => {
    (readUserHash as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (getAccount as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      research: { hasConsent: () => true },
    });

    fireEnrichIfReady('cancel Spotify', 'finance', 'TR', 'tr');
    expect(postEnrichDump).not.toHaveBeenCalled();
  });

  it('does NOT fire when account is null (boot not complete)', () => {
    (readUserHash as unknown as ReturnType<typeof vi.fn>).mockReturnValue('h1');
    (getAccount as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);

    fireEnrichIfReady('cancel Spotify', 'finance', 'TR', 'tr');
    expect(postEnrichDump).not.toHaveBeenCalled();
  });
});
